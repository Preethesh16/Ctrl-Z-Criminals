"""Extraction router: any file → canonical raw transactions + metadata."""

from pathlib import Path

from .detector import detect_file_kind
from .pdf_digital import FALLBACK_HEADER, looks_like_fallback_grid, pdf_has_text, read_pdf_grid
from .rows import RawTxn, grid_to_txns
from .tabular import read_csv_grid, read_excel_grid, read_html_table_grid


class UnsupportedFormat(Exception):
    pass


def extract_rows(path: str | Path) -> tuple[list[RawTxn], dict]:
    """Extract transactions from any supported statement file.

    Returns (txns, info). info includes file_kind, header meta (PDF), and
    grid_to_txns diagnostics — everything the audit trail needs.
    """
    path = Path(path)
    kind = detect_file_kind(path)
    info: dict = {"file_kind": kind}

    if kind == "pdf":
        if not pdf_has_text(path):
            info["file_kind"] = "pdf_scanned"
            raise UnsupportedFormat("scanned PDF — OCR pipeline lands in Phase 2")
        grid, meta = read_pdf_grid(path)
        info["header_meta"] = meta
        if looks_like_fallback_grid(grid):
            grid = [FALLBACK_HEADER, *grid]
            info["extraction_mode"] = "pdf_text_regex"
            txns, ginfo = grid_to_txns(grid, base_confidence=0.85)
        else:
            info["extraction_mode"] = "pdf_tables"
            txns, ginfo = grid_to_txns(grid)
    elif kind in ("xlsx", "xls"):
        txns, ginfo = grid_to_txns(read_excel_grid(path, kind))
    elif kind == "csv":
        txns, ginfo = grid_to_txns(read_csv_grid(path))
    elif kind == "html_table":
        txns, ginfo = grid_to_txns(read_html_table_grid(path))
    elif kind == "txt":
        # Fixed-width text statements: treat runs of 2+ spaces as delimiters.
        lines = Path(path).read_text(errors="replace").splitlines()
        import re

        grid = [re.split(r"\s{2,}", ln.strip()) for ln in lines if ln.strip()]
        txns, ginfo = grid_to_txns(grid, base_confidence=0.8)
    else:
        raise UnsupportedFormat(f"unsupported file kind: {kind}")

    info.update(ginfo)
    return txns, info
