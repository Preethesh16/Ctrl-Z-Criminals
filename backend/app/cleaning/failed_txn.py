"""Failed / reversed transaction pairing.

A debit followed by a credit of the identical amount on the same account
within REVERSAL_WINDOW_DAYS is a reversal candidate when either:
- the credit narration carries a reversal marker (REV/RET/FAILED/REFUND/
  REVERSAL/CHARGEBACK/DECLINED), or
- both legs share the same reference_id.

Paired legs are flagged REVERSED and excluded from flow analysis (the money
never actually moved) but stay visible to the officer.
"""

import re
from collections import defaultdict
from datetime import timedelta

REVERSAL_WINDOW_DAYS = 5
_MARKER = re.compile(
    r"\bREV\b|\bREVERSAL\b|\bREVERSED\b|\bRET\b|\bRETURN(ED)?\b|\bFAILED\b|\bREFUND\b|"
    r"\bCHARGEBACK\b|\bDECLINED\b|\bRRN\s?REV\b",
    re.IGNORECASE,
)


def pair_reversals(txns: list) -> list[tuple[str, str, str]]:
    """Return (debit_id, credit_id, reason) pairs. Each leg pairs at most once."""
    window = timedelta(days=REVERSAL_WINDOW_DAYS)
    by_account: dict[str, list] = defaultdict(list)
    for t in txns:
        by_account[t.account_ref].append(t)

    pairs: list[tuple[str, str, str]] = []
    for rows in by_account.values():
        rows.sort(key=lambda t: (t.txn_date, t.row_index))
        used: set[str] = set()
        debits = [t for t in rows if t.direction == "DEBIT"]
        credits = [t for t in rows if t.direction == "CREDIT"]
        for d in debits:
            if d.id in used:
                continue
            for c in credits:
                if c.id in used or c.amount_inr != d.amount_inr:
                    continue
                if not (timedelta(0) <= (c.txn_date - d.txn_date) <= window):
                    continue
                same_ref = bool(d.reference_id) and d.reference_id == c.reference_id
                marked = bool(_MARKER.search(c.narration_raw or ""))
                if same_ref or marked:
                    reason = "same_reference" if same_ref else "reversal_marker"
                    pairs.append((d.id, c.id, reason))
                    used.update((d.id, c.id))
                    break
    return pairs
