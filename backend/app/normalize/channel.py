"""Transfer-channel classification from narration text.

Rule set covering common Indian bank narration conventions (UPI/NEFT/IMPS/
RTGS/ATM/CHEQUE/CASH/POS/INTERNAL). Unclassified → UNKNOWN, surfaced for
officer annotation. Percentages for the disposition dashboard (cash vs
cheque vs redirected) come straight from this field.
"""

import re

_RULES: list[tuple[str, re.Pattern]] = [
    ("UPI", re.compile(r"\bUPI\b|^UPI[/-]|[A-Za-z0-9._-]+@[A-Za-z]{2,}", re.IGNORECASE)),
    ("ATM", re.compile(r"\bATM\b|ATM\s?WDL|ATM\s?CW|\bAWB\b|\bCSH\s?WDL\b|CARDLESS\s?CASH", re.IGNORECASE)),
    ("NEFT", re.compile(r"\bNEFT\b", re.IGNORECASE)),
    ("RTGS", re.compile(r"\bRTGS\b", re.IGNORECASE)),
    ("IMPS", re.compile(r"\bIMPS\b|\bMMT\b", re.IGNORECASE)),
    ("CHEQUE", re.compile(r"\bCHQ\b|\bCHEQUE\b|CLG[/\s-]|CLEARING|\bMICR\b|\bINWARD\s?CLG\b", re.IGNORECASE)),
    ("CASH", re.compile(r"CASH\s?DEP|BY\s?CASH|CASH\s?WITHDRAW|SELF\b.*CASH|\bCDM\b", re.IGNORECASE)),
    ("POS", re.compile(r"\bPOS\b|\bECOM\b|POINT\s?OF\s?SALE|CARD\s?PURCHASE|\bVPS\b", re.IGNORECASE)),
    ("INTERNAL", re.compile(r"\bTRF\s?TO\s?OWN\b|SWEEP|INT\.?\s?PD|INTEREST\s?(PAID|CREDIT)|\bSB\s?INT\b|BANK\s?CHARGES|SMS\s?CHG|GST\b|\bMIN\s?BAL\b", re.IGNORECASE)),
]


def classify_channel(narration: str | None) -> str:
    if not narration:
        return "UNKNOWN"
    for channel, pattern in _RULES:
        if pattern.search(narration):
            return channel
    return "UNKNOWN"
