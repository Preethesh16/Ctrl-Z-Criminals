"""Shared row-normalization: raw grid (list of cell lists) → RawTxn records.

Used by every tabular source (Excel, CSV, PDF tables, HTML tables) so all
formats flow through identical logic.
"""

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


def grid_to_txns(grid: list[list], base_confidence: float = 1.0) -> tuple[list[RawTxn], dict]:
    """Convert a raw cell grid to canonical raw transactions.

    Returns (txns, info) where info reports header position, mapping and
    skipped-row counts for the audit trail.
    """
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
        balance, _ = parse_amount(_cell(row, mapping, "balance"))

        problems: list[str] = []
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
