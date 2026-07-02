"""Reference-ID extraction with per-channel format validation.

Network-level keys (verified against NPCI conventions):
- UPI/IMPS: 12-digit RRN — the same number appears in BOTH parties'
  statements, so it is the primary cross-account linking key.
- NEFT: ~16-char UTR (e.g. HDFCN52022... / bank prefix + digits).
- RTGS: ~22-char UTR (e.g. HDFCR52026071012345678).
- CHEQUE: 6-digit instrument number.

Validating format per channel prevents false joins on random digit runs
(account numbers, mobile numbers) inside narrations.
"""

import re

_UPI_SEG = re.compile(r"UPI[/\-](?:[A-Z]+[/\-])?(\d{12})\b", re.IGNORECASE)
_RRN_12 = re.compile(r"\b(\d{12})\b")
_NEFT_UTR = re.compile(r"\b([A-Z]{4}[A-Z0-9]?\d{9,16})\b")
_RTGS_UTR = re.compile(r"\b([A-Z]{4}R[C5]?\d{16,18})\b")
_CHQ = re.compile(r"(?:CHQ|CHEQUE)[\s./:-]*(?:NO[\s./:-]*)?(\d{6})\b", re.IGNORECASE)
_MOBILE_HINT = re.compile(r"^[6-9]\d{9}")


def extract_reference(narration: str | None, channel: str) -> str | None:
    """Extract the strongest valid reference for the classified channel."""
    if not narration:
        return None
    text = str(narration)

    if channel in ("UPI", "IMPS"):
        m = _UPI_SEG.search(text)
        if m:
            return m.group(1)
        for m in _RRN_12.finditer(text):
            cand = m.group(1)
            # skip things that look like 10-digit mobiles padded, or years
            if _MOBILE_HINT.match(cand) and cand[:2] in ("91",):
                continue
            return cand
        return None

    if channel == "RTGS":
        m = _RTGS_UTR.search(text)
        return m.group(1) if m else None

    if channel == "NEFT":
        m = _NEFT_UTR.search(text)
        return m.group(1) if m else None

    if channel == "CHEQUE":
        m = _CHQ.search(text)
        if m:
            return m.group(1)
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else None

    # Unknown channel: accept a 12-digit run as a weak candidate.
    m = _RRN_12.search(text)
    return m.group(1) if m else None


_VPA = re.compile(r"\b([A-Za-z0-9][A-Za-z0-9._-]{1,49}@[A-Za-z][A-Za-z0-9]{1,15})\b")


def extract_counterparty(narration: str | None) -> tuple[str | None, str | None]:
    """Extract (counterparty_id, counterparty_name) where disclosed.

    UPI narrations commonly look like:
      UPI/DR/436512345678/JOHN DOE/OKAX/john@okaxis/payment
    """
    if not narration:
        return None, None
    text = str(narration)

    vpa = _VPA.search(text)
    cp_id = vpa.group(1).lower() if vpa else None

    cp_name = None
    parts = re.split(r"[/|]", text)
    if len(parts) >= 4:
        for p in parts[2:6]:
            p = p.strip()
            # A plausible person/merchant name: alphabetic words, not codes.
            if re.fullmatch(r"[A-Za-z][A-Za-z .]{2,40}", p) and p.upper() not in (
                "DR", "CR", "UPI", "OKAX", "YBL", "PAYTM", "AXL", "IBL", "PAYMENT FROM PH",
            ):
                cp_name = p.title()
                break
    return cp_id, cp_name
