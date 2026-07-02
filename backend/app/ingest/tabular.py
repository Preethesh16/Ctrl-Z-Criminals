"""Excel / CSV / HTML-table extraction into raw cell grids."""

import csv
import io
from pathlib import Path

import pandas as pd


def _df_to_grid(df: pd.DataFrame) -> list[list]:
    return df.where(pd.notna(df), None).values.tolist()


def read_excel_grid(path: str | Path, kind: str) -> list[list]:
    """kind: xlsx | xls (already content-sniffed, so engine is correct)."""
    engine = "openpyxl" if kind == "xlsx" else "xlrd"
    frames = pd.read_excel(path, header=None, sheet_name=None, engine=engine)
    grid: list[list] = []
    for _, df in frames.items():  # statements are usually single-sheet; concat all
        grid.extend(_df_to_grid(df))
    return grid


def read_csv_grid(path: str | Path) -> list[list]:
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=",\t;|")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    width = max((len(r) for r in rows), default=0)
    return [r + [None] * (width - len(r)) for r in rows]


def read_txt_fixed_width(path: str | Path) -> list[list]:
    """Fixed-width text statement → grid.

    Naive 2+-space splitting silently drops EMPTY columns (a credit row's
    blank debit cell), shifting amounts into the wrong field. Instead:
    find the header line, take each header field's span, put boundaries at
    the midpoint between adjacent fields, and slice every line by those
    boundaries — alignment-agnostic.
    """
    import re

    from .columns import score_header_row

    lines = Path(path).read_text(errors="replace").splitlines()
    naive = [re.split(r"\s{2,}", ln.strip()) for ln in lines if ln.strip()]

    best_score, header_line = 0, None
    for ln in lines[:60]:
        if not ln.strip():
            continue
        s = score_header_row(re.split(r"\s{2,}", ln.strip()))
        if s > best_score:
            best_score, header_line = s, ln
    if header_line is None or best_score < 3:
        return naive  # not a columnar statement; fall back

    # Infer column boundaries from DATA occupancy, not header text: a
    # position is a separator when it is whitespace in ~every data line
    # (headers are often narrower than their columns; data never lies).
    header_at = lines.index(header_line)
    data_lines = [ln for ln in lines[header_at:] if ln.strip()]
    if len(data_lines) < 3:
        return naive
    width = max(len(ln) for ln in data_lines)
    occupancy = [0] * width
    for ln in data_lines:
        for i, ch in enumerate(ln):
            if ch != " ":
                occupancy[i] += 1
    # A separator column must be empty in (essentially) every line — a
    # right-aligned amount's leading digits may exist in only ONE row and
    # that row is still authoritative. Tiny tolerance only for big files.
    threshold = 0 if len(data_lines) < 100 else int(len(data_lines) * 0.01)
    is_gap = [c <= threshold for c in occupancy]

    # column starts = first occupied position after each gap run of >= 2
    boundaries = [0]
    gap_run = 0
    for i in range(width):
        if is_gap[i]:
            gap_run += 1
        else:
            if gap_run >= 2 and i > 0:
                boundaries.append(i)
            gap_run = 0
    boundaries.append(10**6)
    if len(boundaries) < 4:
        return naive

    grid: list[list] = []
    for lineno, ln in enumerate(lines):
        if not ln.strip():
            continue
        if lineno < header_at:
            grid.append([ln.strip()])  # metadata lines stay whole
        else:
            grid.append([ln[a:b].strip() or None for a, b in zip(boundaries, boundaries[1:])])
    return grid


def read_html_table_grid(path: str | Path) -> list[list]:
    """Banks sometimes ship .xls that is actually an HTML table."""
    frames = pd.read_html(io.StringIO(Path(path).read_text(errors="replace")), header=None)
    grid: list[list] = []
    for df in frames:
        # pandas promotes <th> cells to df.columns even with header=None —
        # put them back as a data row so header detection can see them.
        if not all(isinstance(c, int) for c in df.columns):
            grid.append([str(c) for c in df.columns])
        grid.extend(_df_to_grid(df))
    return grid
