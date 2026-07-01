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
# ("06-05-2025S82656214 UPI/...").
_LINE = re.compile(
    r"^(?P<date>\d{1,2}[-/. ]\w{3}[-/. ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*"
    r"(?P<body>.+?)\s+"
    r"(?P<amt1>-?[\d,]+\.\d{2})(?:\s*\((?:Dr|Cr)\))?"
    r"(?:\s+(?P<amt2>-?[\d,]+\.\d{2}))?"
    r"(?:\s+(?P<amt3>-?[\d,]+\.\d{2}))?\s*$"
)


def pdf_has_text(path: str | Path, min_chars: int = 50) -> bool:
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:3]:
            if len((page.extract_text() or "").strip()) >= min_chars:
                return True
    return False


def explode_multiline_rows(grid: list[list]) -> list[list]:
    """Split rows whose cells pack several transactions separated by newlines.

    pdfplumber sometimes returns one table row per PAGE for HDFC-style
    layouts: every cell holds N newline-separated values. Explode such rows
    into N rows, carrying single-value cells (e.g. narration fragments) into
    the first exploded row only.
    """
    out: list[list] = []
    for row in grid:
        counts = [len(str(c).split("\n")) for c in row if c is not None and str(c).strip()]
        n = max(counts, default=1)
        # Explode only when several cells agree on the same multi-line count.
        if n < 2 or sum(1 for c in counts if c == n) < 2:
            out.append(row)
            continue
        parts = [str(c).split("\n") if c is not None else [] for c in row]
        for i in range(n):
            out.append([p[i] if i < len(p) else None for p in parts])
    return out


def read_pdf_text_lines(path: str | Path) -> list[list]:
    """Regex line fallback over the raw text of every page."""
    grid: list[list] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                m = _LINE.match(line.strip())
                if not m:
                    continue
                amts = [a for a in (m.group("amt1"), m.group("amt2"), m.group("amt3")) if a]
                balance = amts[-1] if len(amts) >= 2 else None
                grid.append([m.group("date"), m.group("body"), amts[0], balance])
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
                # regex fallback per text line → synthetic 4-col rows
                for line in (page.extract_text() or "").splitlines():
                    m = _LINE.match(line.strip())
                    if not m:
                        continue
                    amts = [a for a in (m.group("amt1"), m.group("amt2"), m.group("amt3")) if a]
                    balance = amts[-1] if len(amts) >= 2 else None
                    amount = amts[0]
                    grid.append([m.group("date"), m.group("body"), amount, balance])
    meta = extract_header_meta(full_text_head)
    return explode_multiline_rows(grid), meta


FALLBACK_HEADER = ["date", "narration", "amount", "balance"]


def looks_like_fallback_grid(grid: list[list]) -> bool:
    """True when the grid came from the regex fallback (uniform 4-col, no header)."""
    return bool(grid) and all(len(r) == 4 for r in grid[:10])
