"""File-kind detection by magic bytes — extensions cannot be trusted.

Real police datasets contain `.xls` files that are actually XLSX (zip),
XLS that are actually HTML exports, and PDFs without text layers. Sniff
content first, fall back to extension.
"""

from pathlib import Path

PDF_MAGIC = b"%PDF"
ZIP_MAGIC = b"PK\x03\x04"  # xlsx/docx are zip containers
OLE_MAGIC = b"\xd0\xcf\x11\xe0"  # legacy .xls / .doc


def detect_file_kind(path: str | Path, content_head: bytes | None = None) -> str:
    """Return one of: pdf, xlsx, xls, docx, csv, txt, image, unknown."""
    p = Path(path)
    head = content_head if content_head is not None else p.open("rb").read(4096)
    ext = p.suffix.lower()

    if head.startswith(PDF_MAGIC):
        return "pdf"
    if head.startswith(ZIP_MAGIC):
        return "docx" if ext == ".docx" else "xlsx"
    if head.startswith(OLE_MAGIC):
        return "doc" if ext in (".doc",) else "xls"
    if head.startswith((b"\x89PNG", b"\xff\xd8\xff")):
        return "image"
    if head.lstrip()[:5].lower() in (b"<html", b"<!doc", b"<tabl"):
        return "html_table"  # some banks export .xls that is really HTML

    # Text-like: csv vs plain text
    try:
        sample = head.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        sample = head.decode("latin-1", errors="replace")
    if ext == ".txt":
        # a .txt statement may CONTAIN commas (PNB ledger reports) — the
        # extension is authoritative for the fixed-width/line-regex path
        return "txt" if sample.strip() else "unknown"
    if ext == ".csv" or sample.count(",") > 10 or sample.count("\t") > 10:
        return "csv"
    if sample.strip():
        return "txt"
    return "unknown"
