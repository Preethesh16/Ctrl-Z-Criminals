"""Statement header-block extraction: account number, holder, bank, IFSC, period."""

import re

_ACCT = re.compile(r"(?:account\s*(?:no|number)\.?\s*[:\-]?\s*)([X\dx*]{6,20})", re.IGNORECASE)
_IFSC = re.compile(r"\b([A-Z]{4}0[A-Z0-9]{6})\b")
_NAME = re.compile(r"(?:customer\s*name|account\s*holder|name)\s*[:\-]\s*([A-Za-z .]{3,60})", re.IGNORECASE)
_PERIOD = re.compile(
    r"(?:from|period|between)?\s*(\d{1,2}[-/ ]\w{3,9}[-/ ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})"
    r"\s*(?:to|till|-|–)\s*"
    r"(\d{1,2}[-/ ]\w{3,9}[-/ ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})",
    re.IGNORECASE,
)

_BANKS = [
    "State Bank of India", "SBI", "HDFC", "ICICI", "Axis", "Kotak", "Canara",
    "Punjab National Bank", "PNB", "Bank of Baroda", "Bank of Maharashtra",
    "Union Bank", "IndusInd", "Yes Bank", "IDBI", "IDFC", "Federal Bank",
    "Karnataka Bank", "Kerala Gramin Bank", "AU Small Finance", "Airtel Payments",
    "Paytm Payments", "Fino Payments", "India Post Payments", "RBL", "Bandhan",
    "Central Bank of India", "Indian Overseas Bank", "Indian Bank", "UCO Bank",
]


def extract_header_meta(text: str) -> dict:
    """Best-effort header metadata from the first-page text of a statement."""
    from ..normalize.dates import parse_date

    meta: dict = {}
    if not text:
        return meta
    head = text[:3000]

    if m := _ACCT.search(head):
        meta["account_number"] = m.group(1)
    if m := _IFSC.search(head):
        meta["ifsc"] = m.group(1)
    if m := _NAME.search(head):
        meta["account_holder"] = m.group(1).strip().title()
    if m := _PERIOD.search(head):
        meta["period_from"] = parse_date(m.group(1))
        meta["period_to"] = parse_date(m.group(2))
    for bank in _BANKS:
        if re.search(re.escape(bank), head, re.IGNORECASE):
            meta["bank_name"] = bank
            break
    return meta
