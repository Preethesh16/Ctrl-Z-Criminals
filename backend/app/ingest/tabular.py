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
