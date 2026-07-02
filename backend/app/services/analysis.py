"""Case analysis orchestrator: cleaning → rules → ML → graph → loops →
correlation → disposition. Idempotent; results stored in analysis_results
and flags merged onto transactions. Everything audit-logged.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..detection.anomaly import score_anomalies
from ..detection.correlation import common_identifiers
from ..detection.disposition import disposition
from ..detection.flowgraph import build_edges, graph_summary
from ..detection.roundtrip import find_round_trips
from ..detection.rules import run_rules
from ..models import AnalysisResult, AuditLog, Transaction
from .cleaning import run_cleaning

ANALYSIS_RULES = ("FD-01", "FD-02", "FD-03", "FD-04", "FD-05", "FD-06", "FD-08",
                  "ML-ANOMALY", "ROUND-TRIP", "_CONFIDENCE")


def _jsonable(x):
    if isinstance(x, Decimal):
        return str(x)
    if isinstance(x, datetime):
        return x.isoformat()
    if isinstance(x, dict):
        return {k: _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [_jsonable(v) for v in x]
    return x


def run_analysis(db: Session, case_id: str) -> dict:
    cleaning_summary = run_cleaning(db, case_id)  # idempotent, commits

    txns = list(db.scalars(select(Transaction).where(Transaction.case_id == case_id)))
    by_id = {t.id: t for t in txns}

    # clear previous analysis flags (re-run safe); cleaning flags stay
    for t in txns:
        t.flags = [f for f in (t.flags or [])
                   if not any(str(f.get("rule", "")).startswith(p) for p in ANALYSIS_RULES)]

    # 1. forensic rules
    rule_flags = run_rules(txns)
    for tid, fl in rule_flags.items():
        by_id[tid].flags = [*by_id[tid].flags, *fl]

    # 2. ML anomaly
    for tid, score in score_anomalies(txns).items():
        by_id[tid].flags = [*by_id[tid].flags, {
            "rule": "ML-ANOMALY", "score": score,
            "why": "statistical outlier vs this case's transaction patterns",
        }]

    # 3. flow graph + round trips
    edges = build_edges(txns)
    nodes = graph_summary(txns, edges)
    loops = find_round_trips(edges)
    for i, loop in enumerate(loops):
        loop_id = f"loop-{i+1}"
        for e in loop.edges:
            for tid in e.txn_ids:
                if tid in by_id:
                    by_id[tid].flags = [*by_id[tid].flags, {
                        "rule": "ROUND-TRIP", "loop_id": loop_id,
                        "path": " → ".join(loop.path),
                        "why": "part of a time-ordered loop returning funds toward origin",
                    }]

    # 4. evidence gate: HIGH confidence needs >= 2 independent signals
    high = 0
    for t in txns:
        distinct = {f["rule"] for f in (t.flags or [])
                    if not str(f.get("rule", "")).startswith("DUPLICATE")}
        if len(distinct) >= 2:
            t.flags = [*t.flags, {"rule": "_CONFIDENCE", "level": "HIGH",
                                  "why": f"{len(distinct)} independent signals"}]
            high += 1

    # 5. node suspicion for rendering
    loop_nodes = {n for lp in loops for n in lp.path}
    flag_count = {}
    for t in txns:
        flag_count[t.account_ref] = flag_count.get(t.account_ref, 0) + len(t.flags or [])
    cyto_nodes, cyto_edges = [], []
    for n in nodes.values():
        if n["id"] in loop_nodes or n["accumulator"]:
            suspicion = "high"
        elif flag_count.get(n["id"], 0) >= 3:
            suspicion = "medium"
        else:
            suspicion = "low"
        cyto_nodes.append({"data": {**_jsonable(n), "label": n["id"], "suspicion": suspicion}})
    for i, e in enumerate(edges):
        cyto_edges.append({"data": {
            "id": f"e{i}", "source": e.source, "target": e.target,
            "amount": str(e.amount), "tier": e.tier, "reference": e.reference,
            "channel": e.channel, "when": e.when.isoformat(), "txn_ids": e.txn_ids,
        }})

    artifacts = {
        "graph": {"nodes": cyto_nodes, "edges": cyto_edges},
        "round_trips": [_jsonable({
            "loop_id": f"loop-{i+1}", "path": lp.path, "hops": lp.hops,
            "amount_out": lp.amount_out, "amount_back": lp.amount_back,
            "pct_returned": lp.pct_returned, "elapsed_hours": lp.elapsed_hours,
            "score": lp.score,
            "edges": [{"source": e.source, "target": e.target, "amount": e.amount,
                       "tier": e.tier, "reference": e.reference, "when": e.when,
                       "txn_ids": e.txn_ids} for e in lp.edges],
        }) for i, lp in enumerate(loops)],
        "correlation": common_identifiers(txns),
        "disposition": disposition(txns),
    }

    db.execute(delete(AnalysisResult).where(AnalysisResult.case_id == case_id))
    for kind, payload in artifacts.items():
        db.add(AnalysisResult(case_id=case_id, kind=kind, payload=payload))

    summary = {
        "cleaning": cleaning_summary,
        "transactions": len(txns),
        "flagged": sum(1 for t in txns if t.flags),
        "high_confidence": high,
        "round_trips": len(loops),
        "graph_nodes": len(cyto_nodes),
        "graph_edges": len(cyto_edges),
        "common_identifiers": len(artifacts["correlation"]),
    }
    db.add(AnalysisResult(case_id=case_id, kind="summary", payload=summary))
    db.add(AuditLog(case_id=case_id, action="analysis_run", detail=summary))
    db.commit()
    return summary
