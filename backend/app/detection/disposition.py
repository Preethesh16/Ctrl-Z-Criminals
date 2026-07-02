"""Disposition breakdown — mentor requirement 6.

Where did the money GO: % cash withdrawal (ATM/CASH), % cheque,
% redirected to other accounts (UPI/NEFT/IMPS/RTGS), % merchant (POS),
% internal/charges, % unclassified. Computed over debits only — that is
the officer's question ("how was it spent?").
"""

from decimal import Decimal

BUCKETS = {
    "cash": ("ATM", "CASH"),
    "cheque": ("CHEQUE",),
    "redirected": ("UPI", "NEFT", "IMPS", "RTGS"),
    "merchant": ("POS",),
    "internal": ("INTERNAL",),
    "unclassified": ("UNKNOWN",),
}


def disposition(txns: list) -> dict:
    totals = {bucket: Decimal(0) for bucket in BUCKETS}
    total = Decimal(0)
    channel_to_bucket = {ch: b for b, chs in BUCKETS.items() for ch in chs}
    for t in txns:
        if getattr(t, "excluded", False) or t.direction != "DEBIT":
            continue
        bucket = channel_to_bucket.get(t.channel, "unclassified")
        totals[bucket] += t.amount_inr
        total += t.amount_inr
    return {
        "total_debits": str(total),
        "buckets": {
            b: {"amount": str(amt), "pct": round(float(amt / total * 100), 1) if total else 0.0}
            for b, amt in totals.items()
        },
    }
