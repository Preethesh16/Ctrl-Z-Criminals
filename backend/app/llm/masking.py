"""PII masking for LLM calls — the privacy contract of the hybrid design.

NOTHING leaves the machine except column headers and masked sample cells.
This module is the single choke point: every LLM feature builds its prompt
from `masked_samples()` output only. Keep it that way — it is part of the
pitch and of the CLAUDE.md confidential-data rules (and LLM_ENABLED must
stay false while testing against the police dataset).
"""

import re

_LONG_DIGITS = re.compile(r"\d{6,}")
_VPA = re.compile(r"\b([A-Za-z0-9._-]{2,})@([A-Za-z][A-Za-z0-9]{1,15})\b")
_NAMEISH = re.compile(r"\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b")


def mask_cell(value) -> str:
    """Digits beyond last-4 → X; VPA local part → first 2 chars; names → initials."""
    s = str(value)
    s = _LONG_DIGITS.sub(lambda m: "X" * (len(m.group()) - 4) + m.group()[-4:], s)
    s = _VPA.sub(lambda m: m.group(1)[:2] + "***@" + m.group(2), s)
    s = _NAMEISH.sub(lambda m: m.group(1)[0] + ". " + m.group(2)[0] + ".", s)
    return s[:80]


def masked_samples(grid: list[list], header_idx: int, n: int = 4) -> list[list[str]]:
    """Header row (unmasked — column names are not PII) + n masked data rows."""
    header = [str(c)[:40] if c is not None else "" for c in grid[header_idx]]
    rows = [[mask_cell(c) if c is not None else "" for c in row]
            for row in grid[header_idx + 1 : header_idx + 1 + n]]
    return [header, *rows]
