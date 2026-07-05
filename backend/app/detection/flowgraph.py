"""Fund-flow graph construction.

Nodes are account identifiers:
- own accounts (statements uploaded to the case) — `account_ref`
- external counterparties — VPA / disclosed account, prefixed "ext:"

Edges are transfers with evidence tiers (plan.md §4.4, Research §4):
- confirmed: same reference_id seen as DEBIT in one account and CREDIT in
  another (UPI RRN / NEFT UTR is the same number in both statements)
- probable: opposite-direction amount match (±2% fee tolerance) within a
  30-minute window (same-day when only dates are available)
- external: transfer whose other leg is not in the case — edge to/from
  the counterparty node extracted from the narration
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from decimal import Decimal


@dataclass
class Edge:
    source: str
    target: str
    amount: Decimal
    when: datetime
    tier: str  # confirmed | probable | external
    reference: str | None
    txn_ids: list[str] = field(default_factory=list)
    channel: str = "UNKNOWN"


def _ts(t) -> datetime:
    tt = t.txn_time if isinstance(t.txn_time, time) else None
    return datetime.combine(t.txn_date, tt or time(0, 0))


def _ext_node(t) -> str | None:
    if t.counterparty_id:
        return f"ext:{t.counterparty_id}"
    if t.counterparty_name:
        return f"ext:{t.counterparty_name.lower()}"
    return None


def build_edges(txns: list) -> list[Edge]:
    """Pair legs across accounts into directed transfer edges."""
    rows = [t for t in txns if not getattr(t, "excluded", False)]
    used: set[str] = set()
    edges: list[Edge] = []

    # --- tier 1: reference match across different accounts
    by_ref: dict[str, list] = defaultdict(list)
    for t in rows:
        if t.reference_id:
            by_ref[t.reference_id].append(t)
    for ref, legs in by_ref.items():
        debits = [t for t in legs if t.direction == "DEBIT" and t.id not in used]
        credits = [t for t in legs if t.direction == "CREDIT" and t.id not in used]
        for d in debits:
            match = next((c for c in credits if c.id not in used
                          and c.account_ref != d.account_ref), None)
            if match is None:
                continue
            edges.append(Edge(d.account_ref, match.account_ref, d.amount_inr, _ts(d),
                              "confirmed", ref, [d.id, match.id], d.channel))
            used.update((d.id, match.id))

    # --- tier 2: temporal-amount match (no shared reference)
    # Candidates are bucketed by date so huge cases stay tractable: a match
    # must share the debit's date (date-only rows) or fall within 30 minutes
    # (timed rows — the next-day bucket covers midnight crossings). Semantics
    # are identical to scanning all credits in time order.
    debits = sorted((t for t in rows if t.direction == "DEBIT" and t.id not in used), key=_ts)
    credits = sorted((t for t in rows if t.direction == "CREDIT" and t.id not in used), key=_ts)
    credits_by_date: dict = defaultdict(list)
    for c in credits:
        credits_by_date[c.txn_date].append(c)
    for d in debits:
        if d.amount_inr == 0:
            continue
        candidates = credits_by_date.get(d.txn_date, [])
        if isinstance(d.txn_time, time):
            candidates = [*candidates,
                          *credits_by_date.get(d.txn_date + timedelta(days=1), [])]
        for c in candidates:
            if c.id in used or c.account_ref == d.account_ref:
                continue
            fee_ok = abs(c.amount_inr - d.amount_inr) <= d.amount_inr * Decimal("0.02")
            has_times = isinstance(d.txn_time, time) and isinstance(c.txn_time, time)
            if has_times:
                window_ok = timedelta(0) <= (_ts(c) - _ts(d)) <= timedelta(minutes=30)
            else:
                window_ok = c.txn_date == d.txn_date
            if fee_ok and window_ok:
                edges.append(Edge(d.account_ref, c.account_ref, d.amount_inr, _ts(d),
                                  "probable", None, [d.id, c.id], d.channel))
                used.add(d.id)
                used.add(c.id)
                break

    # --- tier 3: external counterparties (other leg outside the case)
    for t in rows:
        if t.id in used:
            continue
        ext = _ext_node(t)
        if ext is None or t.channel in ("ATM", "CASH", "POS", "INTERNAL"):
            continue
        if t.direction == "DEBIT":
            edges.append(Edge(t.account_ref, ext, t.amount_inr, _ts(t),
                              "external", t.reference_id, [t.id], t.channel))
        else:
            edges.append(Edge(ext, t.account_ref, t.amount_inr, _ts(t),
                              "external", t.reference_id, [t.id], t.channel))
    return edges


def graph_summary(txns: list, edges: list[Edge]) -> dict:
    """Node table with inflow/outflow/throughput for rendering + scoring."""
    nodes: dict[str, dict] = {}

    def node(nid: str, own: bool):
        return nodes.setdefault(nid, {
            "id": nid, "own_account": own,
            "inflow": Decimal(0), "outflow": Decimal(0), "txn_count": 0,
        })

    for t in txns:
        if getattr(t, "excluded", False):
            continue
        n = node(t.account_ref, True)
        n["txn_count"] += 1
        if t.direction == "CREDIT":
            n["inflow"] += t.amount_inr
        else:
            n["outflow"] += t.amount_inr
    for e in edges:
        for nid in (e.source, e.target):
            if nid.startswith("ext:"):
                n = node(nid, False)
                if nid == e.target:
                    n["inflow"] += e.amount
                else:
                    n["outflow"] += e.amount
    # accumulation badge: money pools here (plan.md §4.4)
    for n in nodes.values():
        total = n["inflow"] + n["outflow"]
        n["accumulator"] = bool(n["inflow"] > 0 and total > 0
                                and n["outflow"] < n["inflow"] * Decimal("0.25")
                                and n["inflow"] >= Decimal(50000))
    return nodes
