"""Duplicate-transaction detection.

Two tiers, both FLAG ONLY — nothing is deleted; the officer decides
(audit-trail requirement):

- exact: same account, date, amount, direction and reference_id (or, when
  no reference, identical narration). Typical cause: the same statement
  uploaded twice in different formats.
- fuzzy: same account/date/amount/direction, narration similarity >= 0.9 —
  catches OCR noise and format-specific narration truncation.
"""

from collections import defaultdict
from difflib import SequenceMatcher


def _key(t) -> tuple:
    return (t.account_ref, t.txn_date, t.amount_inr, t.direction)


def find_duplicates(txns: list) -> list[tuple[str, str, str]]:
    """Return (original_id, duplicate_id, tier) pairs across a case.

    Within one document the same key can legitimately repeat (e.g. two
    identical UPI payments the same day), so only cross-document pairs are
    flagged.
    """
    pairs: list[tuple[str, str, str]] = []
    buckets: dict[tuple, list] = defaultdict(list)
    for t in sorted(txns, key=lambda t: (t.txn_date, t.row_index)):
        buckets[_key(t)].append(t)

    for bucket in buckets.values():
        if len(bucket) < 2:
            continue
        for i, a in enumerate(bucket):
            for b in bucket[i + 1 :]:
                if a.document_id == b.document_id:
                    continue
                if a.reference_id and b.reference_id:
                    if a.reference_id == b.reference_id:
                        pairs.append((a.id, b.id, "exact"))
                    continue
                sim = SequenceMatcher(None, a.narration_raw or "", b.narration_raw or "").ratio()
                if sim == 1.0:
                    pairs.append((a.id, b.id, "exact"))
                elif sim >= 0.9:
                    pairs.append((a.id, b.id, "fuzzy"))
    return pairs
