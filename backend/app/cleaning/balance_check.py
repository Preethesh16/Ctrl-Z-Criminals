"""Running-balance consistency validation (rule FD-07).

For each document's transactions in statement order:
    balance_after[i] == balance_after[i-1] + credit - debit   (±0.01)

Breaks indicate statement tampering, fabricated rows, or extraction gaps —
either way the officer must see them. Statements without a balance column
are skipped (nothing to verify).

Some banks print statements newest-first; we auto-detect direction by
trying both orders and keeping the one with fewer breaks.
"""

from dataclasses import dataclass
from decimal import Decimal

TOLERANCE = Decimal("0.01")


@dataclass
class BalanceBreak:
    row_index: int
    expected: Decimal
    actual: Decimal


def _breaks_for(rows: list) -> list[BalanceBreak]:
    breaks: list[BalanceBreak] = []
    prev: Decimal | None = None
    for t in rows:
        if t.balance_after is None:
            prev = None  # gap in balance data — restart the chain
            continue
        if prev is not None:
            delta = t.amount_inr if t.direction == "CREDIT" else -t.amount_inr
            expected = prev + delta
            if abs(expected - t.balance_after) > TOLERANCE:
                breaks.append(BalanceBreak(t.row_index, expected, t.balance_after))
        prev = t.balance_after
    return breaks


def check_balance_consistency(txns: list) -> tuple[list[BalanceBreak], str]:
    """Returns (breaks, order) where order is 'oldest_first' or 'newest_first'.

    `txns` must be one document's transactions sorted by row_index.
    """
    rows = sorted(txns, key=lambda t: t.row_index)
    with_balance = [t for t in rows if t.balance_after is not None]
    if len(with_balance) < 2:
        return [], "oldest_first"

    fwd = _breaks_for(rows)
    rev = _breaks_for(list(reversed(rows)))
    if len(rev) < len(fwd):
        return rev, "newest_first"
    return fwd, "oldest_first"
