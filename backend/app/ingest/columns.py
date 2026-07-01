"""Canonical column mapping — maps any bank's header names onto our schema.

Built from reconnaissance of 14 distinct real layouts (Finacle CBS, iCore,
CASA reports, bank netbanking exports). Order within each list = priority.
"""

import re

# canonical_field -> list of header aliases (lowercased, punctuation-insensitive)
COLUMN_ALIASES: dict[str, list[str]] = {
    "date": [
        "txn dt", "tran date", "tran_date", "txn date", "txn_date", "transaction date",
        "trans date", "trans dt", "date", "value date", "post date", "pstd_dt",
        "dat_txn_processing",
    ],
    "narration": [
        "narration", "particulars", "tran particular", "tran_particular", "description",
        "transaction particulars", "txt_txn_narrative_to", "txt_tran_particular",
        "txt_txn_desc", "remarks", "rmks", "transaction details", "details",
    ],
    "debit": [
        "debit", "dr", "dr_amt", "debit amount", "withdrawals", "withdrawal", "withdrawal amt",
        "debit amt", "withdrawal (dr)",
    ],
    "credit": [
        "credit", "cr", "cr_amt", "credit amount", "deposits", "deposit", "deposit amt",
        "credit amt", "deposit (cr)",
    ],
    "amount": ["amt_txn_lcy", "tran amt", "amount", "transaction amount"],
    "drcr_flag": ["cod_drcr", "cr/dr", "dr/cr", "type", "txn type", "tran type", "balance indicator"],
    "balance": ["balance", "bal", "balance amount", "closing balance", "running balance", "balance amt"],
    "reference": [
        "ref chq no", "ref txn no", "ref_txn_no", "chqno", "chq no", "cheque no", "chq./ref.no.",
        "instrument no", "inst_num", "cheque details", "utr", "ref no", "reference no", "cheque_no",
    ],
    "txn_id": ["tran id", "tran_id", "txn id", "transaction id"],
    "account": ["account no.", "account no", "ac_no", "cod_acct_no", "account"],
    "time": ["time", "txn time", "tran time"],
}

_HEADER_KEYWORDS = (
    "date", "narration", "particular", "description", "debit", "credit",
    "withdraw", "deposit", "balance", "amount", "chq", "ref", "txn", "tran",
)


def _norm(cell) -> str:
    s = str(cell).strip().lower().replace("\n", " ").replace("-", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9/ _.]", "", s))


def score_header_row(cells: list) -> int:
    """How header-like is this row? Count keyword hits."""
    return sum(1 for c in cells for k in _HEADER_KEYWORDS if k in _norm(c))


def map_columns(header_cells: list) -> dict[str, int]:
    """Map canonical field -> column index for a detected header row."""
    normed = [_norm(c) for c in header_cells]
    mapping: dict[str, int] = {}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            for idx, cell in enumerate(normed):
                if idx in mapping.values():
                    continue
                if cell == alias or (len(alias) > 4 and alias in cell):
                    mapping[field] = idx
                    break
            if field in mapping:
                break
    return mapping


def is_usable_mapping(mapping: dict[str, int]) -> bool:
    """Minimum viable: a date column, a narration-ish column, and money."""
    has_money = ("debit" in mapping or "credit" in mapping or "amount" in mapping)
    return "date" in mapping and has_money
