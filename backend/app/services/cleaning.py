"""Case-level cleaning pass: balance validation, duplicates, reversals.

Idempotent — clears previous cleaning flags then reapplies, so re-running
after new uploads or officer corrections is safe. Everything lands in the
audit trail.
"""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..cleaning import check_balance_consistency, find_duplicates, pair_reversals
from ..models import AuditLog, Transaction

CLEANING_FLAGS = ("FD-07-BALANCE-BREAK", "DUPLICATE-SUSPECT", "REVERSED")


def run_cleaning(db: Session, case_id: str) -> dict:
    txns = list(db.scalars(select(Transaction).where(Transaction.case_id == case_id)))
    by_id = {t.id: t for t in txns}

    # Reset previous cleaning results (idempotent re-run).
    for t in txns:
        t.flags = [f for f in (t.flags or []) if f.get("rule") not in CLEANING_FLAGS]
        if t.excluded:
            t.excluded = False

    # 1. Balance consistency per document.
    balance_breaks = 0
    by_doc: dict[str, list[Transaction]] = defaultdict(list)
    for t in txns:
        by_doc[t.document_id].append(t)
    for doc_txns in by_doc.values():
        breaks, order = check_balance_consistency(doc_txns)
        balance_breaks += len(breaks)
        rows = {t.row_index: t for t in doc_txns}
        for b in breaks:
            t = rows[b.row_index]
            t.flags = [*t.flags, {
                "rule": "FD-07-BALANCE-BREAK",
                "expected": str(b.expected),
                "actual": str(b.actual),
                "order": order,
            }]
            t.needs_review = True

    # 2. Cross-document duplicates (flag the LATER occurrence).
    dup_pairs = find_duplicates(txns)
    for orig_id, dup_id, tier in dup_pairs:
        t = by_id[dup_id]
        t.flags = [*t.flags, {"rule": "DUPLICATE-SUSPECT", "of": orig_id, "tier": tier}]
        t.needs_review = True

    # 3. Reversal pairing — both legs flagged and excluded from analysis.
    rev_pairs = pair_reversals(txns)
    for debit_id, credit_id, reason in rev_pairs:
        for tid, other in ((debit_id, credit_id), (credit_id, debit_id)):
            t = by_id[tid]
            t.flags = [*t.flags, {"rule": "REVERSED", "paired_with": other, "reason": reason}]
            t.excluded = True

    summary = {
        "transactions": len(txns),
        "balance_breaks": balance_breaks,
        "duplicate_pairs": len(dup_pairs),
        "reversal_pairs": len(rev_pairs),
    }
    db.add(AuditLog(case_id=case_id, action="cleaning_run", detail=summary))
    db.commit()
    return summary
