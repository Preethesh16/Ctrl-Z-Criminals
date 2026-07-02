"""Extraction router: any file → canonical raw transactions + metadata."""

from pathlib import Path

from .detector import detect_file_kind
from .pdf_digital import FALLBACK_HEADER, looks_like_fallback_grid, pdf_has_text, read_pdf_grid
from .rows import RawTxn, grid_to_txns, repair_directions
from .tabular import read_csv_grid, read_excel_grid, read_html_table_grid


class UnsupportedFormat(Exception):
    pass


def _extract_via_ocr(path: Path, info: dict, scanned_pdf: bool) -> tuple[list["RawTxn"], dict]:
    """Scanned PDF / photographed statement → OCR lines → regex line parser.

    Reuses the exact downstream path of digital-PDF fallback; per-line OCR
    confidence carries into each row's extraction_confidence.
    """
    from .ocr import NoOcrEngine, image_file_to_array, ocr_image, pdf_pages_to_images
    from .pdf_digital import _LINE, _line_to_row

    try:
        images = pdf_pages_to_images(path) if scanned_pdf else [image_file_to_array(path)]
    except Exception as e:  # pdf2image/poppler issues surface as parse failures
        raise UnsupportedFormat(f"could not rasterize: {e}") from e

    grid: list[list] = []
    line_conf: list[float] = []
    ocr_text_head: list[str] = []
    try:
        for pageno, img in enumerate(images):
            for line in ocr_image(img):
                if pageno == 0:
                    ocr_text_head.append(line.text)
                m = _LINE.match(line.text.strip())
                if m:
                    grid.append(_line_to_row(m))
                    line_conf.append(line.confidence)
    except NoOcrEngine as e:
        raise UnsupportedFormat(str(e)) from e

    from .headermeta import extract_header_meta
    from .pdf_digital import FALLBACK_HEADER

    info["header_meta"] = extract_header_meta("\n".join(ocr_text_head))
    info["extraction_mode"] = "ocr"
    txns, ginfo = grid_to_txns([FALLBACK_HEADER, *grid], base_confidence=0.75)
    # blend per-line OCR confidence into each row (row_index is 1-based
    # relative to the header we prepended)
    for t in txns:
        idx = t.row_index - 1
        if 0 <= idx < len(line_conf):
            t.confidence = round(min(t.confidence, max(0.1, line_conf[idx] * 0.95)), 2)
    info["directions_repaired"] = repair_directions(txns)
    info.update(ginfo)
    return txns, info


def read_any_grid(path: str | Path) -> tuple[list[list], dict]:
    """Raw cell grid for any tabular-capable format (mapping UI backend)."""
    path = Path(path)
    kind = detect_file_kind(path)
    info: dict = {"file_kind": kind}
    if kind == "pdf" and pdf_has_text(path):
        grid, meta = read_pdf_grid(path)
        info["header_meta"] = meta
        if looks_like_fallback_grid(grid):
            grid = [FALLBACK_HEADER, *grid]
    elif kind in ("xlsx", "xls"):
        grid = read_excel_grid(path, kind)
    elif kind == "csv":
        grid = read_csv_grid(path)
    elif kind == "html_table":
        grid = read_html_table_grid(path)
    elif kind == "docx":
        from .docxfile import read_docx_grid

        grid, _ = read_docx_grid(path)
    elif kind == "txt":
        import re

        lines = path.read_text(errors="replace").splitlines()
        grid = [re.split(r"\s{2,}", ln.strip()) for ln in lines if ln.strip()]
    else:
        raise UnsupportedFormat(f"no raw grid for file kind: {kind}")
    return grid, info


def extract_rows(path: str | Path, mapping_override: dict[str, int] | None = None) -> tuple[list[RawTxn], dict]:
    """Extract transactions from any supported statement file.

    `mapping_override` applies an officer-saved column template.
    Returns (txns, info). info includes file_kind, header meta (PDF), and
    grid_to_txns diagnostics — everything the audit trail needs.
    """
    path = Path(path)
    kind = detect_file_kind(path)
    info: dict = {"file_kind": kind}

    if mapping_override is not None:
        grid, ginfo0 = read_any_grid(path)
        info.update(ginfo0)
        info["extraction_mode"] = "template_override"
        txns, ginfo = grid_to_txns(grid, mapping_override=mapping_override)
        info.update(ginfo)
        return txns, info

    if kind == "pdf":
        if not pdf_has_text(path):
            info["file_kind"] = "pdf_scanned"
            return _extract_via_ocr(path, info, scanned_pdf=True)
        grid, meta = read_pdf_grid(path)
        info["header_meta"] = meta
        if looks_like_fallback_grid(grid):
            grid = [FALLBACK_HEADER, *grid]
            info["extraction_mode"] = "pdf_text_regex"
            txns, ginfo = grid_to_txns(grid, base_confidence=0.85)
        else:
            info["extraction_mode"] = "pdf_tables"
            txns, ginfo = grid_to_txns(grid)
            if not txns:
                # Table detection produced garbage (mini/decorative tables).
                # Retry with the raw-text line parser before giving up.
                from .pdf_digital import read_pdf_text_lines

                fallback = read_pdf_text_lines(path)
                if fallback:
                    info["extraction_mode"] = "pdf_text_regex_retry"
                    txns, ginfo = grid_to_txns([FALLBACK_HEADER, *fallback], base_confidence=0.85)
        if info["extraction_mode"].startswith("pdf_text_regex"):
            # Regex fallback can't know column order/direction — balance
            # deltas are the ground truth.
            info["directions_repaired"] = repair_directions(txns)
    elif kind in ("xlsx", "xls"):
        txns, ginfo = grid_to_txns(read_excel_grid(path, kind))
    elif kind == "csv":
        txns, ginfo = grid_to_txns(read_csv_grid(path))
    elif kind == "html_table":
        txns, ginfo = grid_to_txns(read_html_table_grid(path))
    elif kind == "image":
        return _extract_via_ocr(path, info, scanned_pdf=False)
    elif kind == "docx":
        from .docxfile import read_docx_grid
        from .headermeta import extract_header_meta

        grid, text = read_docx_grid(path)
        info["header_meta"] = extract_header_meta(text)
        txns, ginfo = grid_to_txns(grid)
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
