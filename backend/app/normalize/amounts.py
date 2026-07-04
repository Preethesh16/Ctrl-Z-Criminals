"""Amount parsing for Indian bank statement conventions.

Handles: Indian digit grouping (1,00,000.50), ₹/Rs/INR prefixes, Dr/Cr
suffixes ("5,000.00 Dr"), parentheses negatives, trailing minus, and the
BALANCE INDICATOR-style separate Cr/Dr column handled by callers.
"""

import re
from decimal import Decimal, InvalidOperation

_CLEAN_RE = re.compile(r"[₹,\s]|Rs\.?|INR", re.IGNORECASE)
# (?<![A-Za-z]) instead of \b: "0.06Cr" has NO word boundary between the
# digit and "Cr" (both are \w), so \b silently failed on glued suffixes —
# the lookbehind only requires the char before DR/CR to not be a letter.
_DRCR_RE = re.compile(r"(?<![A-Za-z])(DR|CR|DEBIT|CREDIT)\.?\s*$", re.IGNORECASE)


def parse_amount(value) -> tuple[Decimal | None, str | None]:
    """Parse an amount cell.

    Returns (abs_amount, drcr_hint) where drcr_hint is "DEBIT"/"CREDIT" when
    the cell itself carries a Dr/Cr suffix or a negative sign, else None.
    """
    if value is None:
        return None, None
    if isinstance(value, (int, float, Decimal)):
        if isinstance(value, float) and value != value:  # NaN
            return None, None
        d = Decimal(str(value))
        hint = "DEBIT" if d < 0 else None
        return abs(d).quantize(Decimal("0.01")), hint

    s = str(value).strip()
    if not s or s.lower() in ("nan", "none", "-", "--", "nil"):
        return None, None

    hint = None
    m = _DRCR_RE.search(s)
    if m:
        hint = "DEBIT" if m.group(1).upper().startswith("D") else "CREDIT"
        s = s[: m.start()].strip()

    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    if s.endswith("-"):
        negative, s = True, s[:-1]
    if s.startswith("-"):
        negative, s = True, s[1:]

    s = _CLEAN_RE.sub("", s)
    if not s or not re.fullmatch(r"\d+(\.\d+)?", s):
        # Table-extraction artifact: a stray leading letter fragment bled
        # into the amount cell from an adjacent column (e.g. "N1.00" from
        # a wrapped "NEFT..." narration). Only strip when what's left is
        # an unambiguous, complete number — never touch trailing content.
        stripped = re.sub(r"^[A-Za-z]{1,3}(?=\d)", "", s)
        if stripped != s and re.fullmatch(r"\d+(\.\d+)?", stripped):
            s = stripped
        else:
            return None, None
    try:
        d = Decimal(s).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None, None
    if negative and hint is None:
        hint = "DEBIT"
    return d, hint
