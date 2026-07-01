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
_LINE = re.compile(
    r"^(?P<date>\d{1,2}[-/. ]\w{3}[-/. ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+"
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
    return grid, meta


FALLBACK_HEADER = ["date", "narration", "amount", "balance"]


def looks_like_fallback_grid(grid: list[list]) -> bool:
    """True when the grid came from the regex fallback (uniform 4-col, no header)."""
    return bool(grid) and all(len(r) == 4 for r in grid[:10])
