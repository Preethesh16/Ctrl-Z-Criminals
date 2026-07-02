"""Digital-PDF extraction: pdfplumber tables first, text-line regex fallback.

Real-data recon: 88/103 police PDFs have extractable tables; 15 are digital
but table detection fails — those go through the line-regex fallback.
Scanned pages (no text layer) are routed to the OCR pipeline (Phase 2).
"""

import re
from pathlib import Path

import pdfplumber

from .headermeta import extract_header_meta

# Fallback line shape: date ... narration ... amount(s) [balance]
# \s* after date: some banks glue the reference straight onto the date
# ("06-05-2025S82656214 UPI/..."). Amounts may carry a glued or spaced
# Cr/Dr suffix ("1,50,391.44Cr", "500.00 Cr") — parse_amount strips it.
_AMT = r"-?[\d,]+\.\d{2}(?:\s?(?:CR|DR|Cr|Dr|cr|dr)\b\.?)?(?:\s*\((?:Dr|Cr)\))?"
_LINE = re.compile(
    r"^(?P<date>\d{1,2}[-/. ]\w{3}[-/. ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*"
    r"(?P<body>.+?)\s+"
    rf"(?P<amt1>{_AMT})"
    rf"(?:\s+(?P<amt2>{_AMT}))?"
    rf"(?:\s+(?P<amt3>{_AMT}))?\s*$"
)

# Second-chance shape, tried only when the strict regex matches NOTHING in a
# document: optional leading serial number (BoM), optional trailing
# non-amount tokens (PNB ledger user-ids "CDCI CDCI", channel words). The
# negative lookahead stops trailing tokens from swallowing real amounts.
_LINE_LOOSE = re.compile(
    r"^(?:\d{1,4}\s+)?"
    r"(?P<date>\d{1,2}[-/. ]\w{3}[-/. ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*"
    r"(?P<body>.+?)\s+"
    rf"(?P<amt1>{_AMT})"
    rf"(?:\s+(?P<amt2>{_AMT}))?"
    rf"(?:\s+(?P<amt3>{_AMT}))?"
    r"(?:\s+(?!\d[\d,]*\.\d{2})\S{1,12}){0,3}\s*$"
)


def pdf_has_text(path: str | Path, min_chars: int = 50) -> bool:
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:3]:
            if len((page.extract_text() or "").strip()) >= min_chars:
                return True
    return False


def explode_multiline_rows(grid: list[list]) -> list[list]:
    """Split rows whose cells pack several transactions separated by newlines.

    Two very different layouts produce "\n" inside cells:
    - HDFC-style packing: one table row per PAGE; every cell holds N
      newline-separated values, and the date cell holds N complete dates.
      → explode into N rows.
    - Bandhan-style wrapping: ONE value wrapped across lines inside its
      cell ("20-MAR-\n2025"). → unwrap (join), never explode.

    The date cell decides: explode only when some cell's newline parts are
    themselves ≥2 parseable dates.
    """
    from ..normalize.dates import parse_date

    out: list[list] = []
    for row in grid:
        counts = [len(str(c).split("\n")) for c in row if c is not None and str(c).strip()]
        n = max(counts, default=1)
        if n < 2:
            out.append(row)
            continue

        parts = [str(c).split("\n") if c is not None else [] for c in row]
        packed = any(
            sum(1 for part in p if parse_date(part.strip())) >= 2 for p in parts
        )
        if packed and sum(1 for c in counts if c == n) >= 2:
            for i in range(n):
                out.append([p[i] if i < len(p) else None for p in parts])
        else:
            out.append([" ".join(p).strip() if p else None for p in parts])
    return out


def _line_to_row(m: re.Match) -> list:
    """Regex match → [date, narration, debit-ish, credit-ish, balance].

    Column semantics are provisional — many bank layouts are
    (debit, credit, balance) but some are (credit, debit, balance) and
    two-amount lines are just (amount, balance). Directions are repaired
    afterwards from balance deltas (see rows.repair_directions).
    """
    amts = [a for a in (m.group("amt1"), m.group("amt2"), m.group("amt3")) if a]
    if len(amts) >= 3:
        a, b, balance = amts[0], amts[1], amts[2]
    elif len(amts) == 2:
        a, b, balance = amts[0], None, amts[1]
    else:
        a, b, balance = amts[0], None, None
    return [m.group("date"), m.group("body"), a, b, balance]


_NOISE_LINE = re.compile(
    r"^-{4,}|^={4,}|Page\s+\d+|^Transaction Details|^Statement of|^A/C |^Address|"
    r"^MICR|^IFSC|^HELPLINE|^BRANCH|^Note[:\s]|^Unless the|^Total[:\s]|^Page Total",
    re.IGNORECASE,
)
_HAS_AMOUNT = re.compile(r"\d[\d,]*\.\d{2}")


_LONE_AMOUNT = re.compile(rf"^{_AMT}$")


def collect_text_lines(text: str, grid: list[list], pattern: re.Pattern = _LINE) -> None:
    """Append transaction rows found in `text` to `grid`.

    Two follow-up-line conventions are handled:
    - narration continuation (no amounts): appended to the previous row's
      narration (BoB prints the full UPI/IMPS reference on the NEXT line —
      losing it would break cross-statement linking);
    - lone-amount line: the previous row's TRUE balance (AU Bank web
      exports print "amount rate lcy_amount" on the txn line and the
      balance alone on the next). When the captured balance was just the
      LCY duplicate of the amount, the middle "rate" column is noise too.
    """
    balance_pending = False
    for line in text.splitlines():
        stripped = line.strip()
        m = pattern.match(stripped)
        if m:
            grid.append(_line_to_row(m))
            balance_pending = True
        elif not (grid and len(grid[-1]) == 5 and stripped):
            continue
        elif balance_pending and _LONE_AMOUNT.match(stripped):
            row = grid[-1]
            if row[4] == row[2]:  # old "balance" was the LCY duplicate
                row[3] = None  # middle column was the exchange rate
            row[4] = stripped
            balance_pending = False
        elif (len(stripped) < 120 and not _NOISE_LINE.search(stripped)
              and not _HAS_AMOUNT.search(stripped)):
            # only extend rows created by this regex (5-col), never table rows
            grid[-1][1] = f"{grid[-1][1]} {stripped}"


def read_pdf_text_lines(path: str | Path, loose: bool = False) -> list[list]:
    """Regex line fallback over the raw text of every page."""
    pattern = _LINE_LOOSE if loose else _LINE
    grid: list[list] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            collect_text_lines(page.extract_text() or "", grid, pattern)
    return grid


def read_pdf_grid(path: str | Path) -> tuple[list[list], dict]:
    """Extract a unified cell grid from all pages; returns (grid, header_meta)."""
    grid: list[list] = []
    full_text_head = ""
    with pdfplumber.open(path) as pdf:
        for pageno, page in enumerate(pdf.pages):
            if pageno == 0:
                full_text_head = page.extract_text() or ""
            tables = page.extract_tables()
            if tables:
                for t in tables:
                    grid.extend([[c for c in row] for row in t])
            else:
                # regex fallback per text line → synthetic 5-col rows
                # (with continuation-line narration capture)
                collect_text_lines(page.extract_text() or "", grid)
    meta = extract_header_meta(full_text_head)
    return explode_multiline_rows(grid), meta


FALLBACK_HEADER = ["date", "narration", "debit", "credit", "balance"]


def looks_like_fallback_grid(grid: list[list]) -> bool:
    """True when the grid came from the regex fallback (uniform 5-col, no header)."""
    return bool(grid) and all(len(r) == 5 for r in grid[:10])
