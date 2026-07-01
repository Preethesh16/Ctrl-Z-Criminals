"""Date parsing for Indian bank statement conventions.

Handles: 01-02-2025, 01/02/2025, 01/02/25, 2025-02-01, 01-Feb-2025,
01 Feb 2025, 01-FEB-25, 20250201, and datetime variants with time parts.
Ambiguous DD/MM vs MM/DD defaults to DD/MM (Indian convention); callers with
statement-period context can pass `dayfirst=False` to override.
"""

import re
from datetime import date, datetime

_MONTHS = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

_TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b")


def _year(y: int) -> int:
    if y < 100:
        return 2000 + y if y <= 69 else 1900 + y
    return y


def parse_date(value, dayfirst: bool = True) -> date | None:
    """Parse a statement date cell. Returns None when unparseable."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    s = str(value).strip()
    if not s or s.lower() in ("nan", "nat", "none", "-"):
        return None
    s = _TIME_RE.sub("", s).strip().strip(",").strip()

    # 01-Feb-2025 / 01 FEB 25 / 01Feb2025
    m = re.match(r"^(\d{1,2})[\s\-/]?([A-Za-z]{3,9})[\s\-/]?(\d{2,4})$", s)
    if m:
        mon = _MONTHS.get(m.group(2)[:3].lower())
        if mon:
            try:
                return date(_year(int(m.group(3))), mon, int(m.group(1)))
            except ValueError:
                return None

    # Feb 01, 2025
    m = re.match(r"^([A-Za-z]{3,9})[\s\-/](\d{1,2}),?[\s\-/](\d{2,4})$", s)
    if m:
        mon = _MONTHS.get(m.group(1)[:3].lower())
        if mon:
            try:
                return date(_year(int(m.group(3))), mon, int(m.group(2)))
            except ValueError:
                return None

    # ISO 2025-02-01
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None

    # Compact 20250201
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None

    # DD-MM-YYYY / DD/MM/YY (or MM-DD with dayfirst=False)
    m = re.match(r"^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), _year(int(m.group(3)))
        d_, mo = (a, b) if dayfirst else (b, a)
        if mo > 12 and d_ <= 12:  # impossible month ⇒ the other order
            d_, mo = mo, d_
        try:
            return date(y, mo, d_)
        except ValueError:
            return None

    return None


def parse_time(value) -> str | None:
    """Extract HH:MM[:SS] from a cell/narration if present."""
    if value is None:
        return None
    m = _TIME_RE.search(str(value))
    if not m:
        return None
    h, mi, sec = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}:{sec:02d}"
