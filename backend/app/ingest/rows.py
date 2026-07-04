"""Shared row-normalization: raw grid (list of cell lists) → RawTxn records.

Used by every tabular source (Excel, CSV, PDF tables, HTML tables) so all
formats flow through identical logic.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from ..normalize.amounts import parse_amount
from ..normalize.channel import classify_channel
from ..normalize.dates import parse_date, parse_time
from ..normalize.reference import extract_counterparty, extract_reference
from .columns import is_usable_mapping, map_columns, score_header_row


@dataclass
class RawTxn:
    row_index: int
    txn_date: date
    narration: str
    amount: Decimal
    direction: str  # DEBIT | CREDIT
    balance: Decimal | None
    channel: str
    reference_id: str | None
    counterparty_id: str | None
    counterparty_name: str | None
    txn_time: str | None = None
    confidence: float = 1.0
    problems: list[str] = field(default_factory=list)


_TOL = Decimal("0.01")


def _delta_matches(rows: list[RawTxn]) -> int:
    """How many consecutive balance deltas equal the row amount (order sanity)."""
    ok, prev = 0, None
    for t in rows:
        if t.balance is None:
            prev = None
            continue
        if prev is not None and abs(abs(t.balance - prev) - t.amount) <= _TOL:
            ok += 1
        prev = t.balance
    return ok


def repair_directions(txns: list[RawTxn]) -> int:
    """Correct DEBIT/CREDIT using running-balance deltas (ground truth).

    The regex line fallback cannot know column order (debit-first vs
    credit-first) or the direction of single-amount lines. When a balance
    chain exists, `balance[i] - balance[i-1]` decides the direction
    authoritatively. Handles newest-first statements by picking the
    iteration order with more consistent deltas. Returns #corrections.
    """
    rows = sorted(txns, key=lambda t: t.row_index)
    if _delta_matches(list(reversed(rows))) > _delta_matches(rows):
        rows = list(reversed(rows))

    fixed, prev = 0, None
    for t in rows:
        if t.balance is None:
            prev = None
            continue
        if prev is not None:
            delta = t.balance - prev
            if delta != 0 and abs(abs(delta) - t.amount) <= _TOL:
                want = "CREDIT" if delta > 0 else "DEBIT"
                if t.direction != want:
                    t.direction = want
                    fixed += 1
                if "direction_assumed" in t.problems:
                    t.problems.remove("direction_assumed")
                    t.confidence = min(1.0, round(t.confidence + 0.15, 2))
        prev = t.balance
    return fixed


def find_header(grid: list[list], max_scan: int = 45) -> tuple[int | None, dict[str, int]]:
    """Locate the most header-like row in the first rows and map its columns."""
    best = (None, {}, 2)  # (row_idx, mapping, best_score) — need score >= 3
    for i, row in enumerate(grid[:max_scan]):
        s = score_header_row(row)
        if s > best[2]:
            mapping = map_columns(row)
            if is_usable_mapping(mapping):
                best = (i, mapping, s)
    return best[0], best[1]


def _cell(row: list, mapping: dict[str, int], f: str):
    idx = mapping.get(f)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _cell_at(row: list, idx: int):
    if idx < 0 or idx >= len(row):
        return None
    return row[idx]


def grid_to_txns(
    grid: list[list],
    base_confidence: float = 1.0,
    mapping_override: dict[str, int] | None = None,
    header_row_override: int | None = None,
) -> tuple[list[RawTxn], dict]:
    """Convert a raw cell grid to canonical raw transactions.

    `mapping_override` (canonical field -> column index) comes from an
    officer-saved bank template and bypasses header auto-detection.
    Returns (txns, info) where info reports header position, mapping and
    skipped-row counts for the audit trail.
    """
    if mapping_override is not None:
        header_idx, mapping = header_row_override, dict(mapping_override)
        if header_idx is None:
            header_idx, _ = find_header(grid)
            if header_idx is None:
                header_idx = -1  # no header row — data starts at 0
    else:
        header_idx, mapping = find_header(grid)
    info = {"header_row": header_idx, "mapping": mapping, "skipped": 0, "carried_narration": 0}
    if header_idx is None:
        return [], info

    txns: list[RawTxn] = []
    for i, row in enumerate(grid[header_idx + 1 :], start=1):
        raw_date = _cell(row, mapping, "date")
        d = parse_date(raw_date)
        narr = _cell(row, mapping, "narration")
        narr = "" if narr is None else str(narr).strip()
        if narr.lower() in ("nan", "none"):
            narr = ""

        if d is None:
            # Continuation line: dateless row whose narration extends the previous txn.
            if txns and narr and all(
                not str(_cell(row, mapping, f) or "").strip() for f in ("debit", "credit", "amount", "balance")
            ):
                txns[-1].narration += " " + narr
                info["carried_narration"] += 1
            else:
                info["skipped"] += 1
            continue

        debit, _ = parse_amount(_cell(row, mapping, "debit"))
        credit, _ = parse_amount(_cell(row, mapping, "credit"))
        amount_cell, amount_hint = parse_amount(_cell(row, mapping, "amount"))
        # A "Dr" suffix on the BALANCE itself (not the transaction amount)
        # means the account is overdrawn — the balance is negative, not a
        # direction hint to discard. Only crosses the zero boundary rarely
        # (current/business accounts), which is exactly when ignoring the
        # sign silently breaks the running-balance chain.
        balance, balance_hint = parse_amount(_cell(row, mapping, "balance"))
        if balance is not None and balance_hint == "DEBIT":
            balance = -balance

        problems: list[str] = []

        if not (debit and debit > 0) and not (credit and credit > 0) and mapping.get("credit") is not None:
            # A phantom extra cell (pdfplumber splitting a wrapped/spaced
            # value) shifts credit rows one column right of the mapped
            # position on some real statements — debit rows stay aligned,
            # only credit rows drift. Signature: mapped debit+credit are
            # both empty, but the cell ONE COLUMN PAST the mapped credit
            # position is a valid amount AND the cell after THAT is a
            # valid balance — i.e. the row silently grew by one cell.
            shifted_credit, _ = parse_amount(_cell_at(row, mapping["credit"] + 1))
            shifted_balance, shifted_bal_hint = (
                parse_amount(_cell_at(row, mapping["credit"] + 2)) if mapping.get("balance") is not None else (None, None)
            )
            if shifted_credit and shifted_credit > 0 and shifted_balance is not None:
                credit = shifted_credit
                balance = -shifted_balance if shifted_bal_hint == "DEBIT" else shifted_balance

        row_text = " ".join(str(c) for c in row if c is not None)
        if (
            not (debit and debit > 0) and not (credit and credit > 0)
            and not (amount_cell and amount_cell > 0)
            and re.search(r"\bWDR\b|\bWITHDRAW|\bATM\b|\bCASH\b", row_text, re.IGNORECASE)
        ):
            # A long narration/address value (e.g. a branch address after
            # "ATM WDR") pushes the amount out of its mapped column
            # entirely into an unmapped trailing cell (fixed-width TXT
            # column-boundary inference). Recover it ONLY when: exactly
            # one bare amount exists among the row's unmapped cells
            # (excluding the last cell, which typically carries the
            # running balance mixed with trailing report codes), AND the
            # narration itself is unambiguously a withdrawal — direction
            # is confirmed by content, never guessed. (A broader
            # "default to debit whenever ambiguous" version of this was
            # tried and reverted: it silently mis-assigned direction on
            # an unrelated file's already-known-corrupted rows.)
            used_idx = {v for v in mapping.values() if v is not None}
            orphan_amounts = [
                amt for j, c in enumerate(row[:-1]) if j not in used_idx
                for amt, _ in [parse_amount(c)] if amt and amt > 0
            ]
            if len(orphan_amounts) == 1:
                debit = orphan_amounts[0]

        if debit and debit > 0:
            amount, direction = debit, "DEBIT"
            if credit and credit > 0:
                problems.append("both_debit_and_credit")
        elif credit and credit > 0:
            amount, direction = credit, "CREDIT"
        elif amount_cell and amount_cell > 0:
            amount = amount_cell
            flag = str(_cell(row, mapping, "drcr_flag") or "").strip().upper()
            if flag.startswith("D"):
                direction = "DEBIT"
            elif flag.startswith("C"):
                direction = "CREDIT"
            elif amount_hint:
                direction = amount_hint
            else:
                direction = "DEBIT"
                problems.append("direction_assumed")
        else:
            info["skipped"] += 1  # zero-amount / summary row
            continue

        channel = classify_channel(narr)
        ref = extract_reference(narr, channel)
        if ref is None:
            ref_cell = _cell(row, mapping, "reference")
            if ref_cell is not None:
                rc = str(ref_cell).strip()
                if rc and rc.lower() not in ("nan", "none", "-", "0"):
                    ref = rc[:40]
        cp_id, cp_name = extract_counterparty(narr)

        confidence = base_confidence - (0.15 * len(problems))
        txns.append(
            RawTxn(
                row_index=i,
                txn_date=d,
                narration=narr,
                amount=amount,
                direction=direction,
                balance=balance,
                channel=channel,
                reference_id=ref,
                counterparty_id=cp_id,
                counterparty_name=cp_name,
                txn_time=parse_time(raw_date) or parse_time(narr),
                confidence=max(0.0, round(confidence, 2)),
                problems=problems,
            )
        )
    return txns, info
