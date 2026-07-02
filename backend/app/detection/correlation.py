"""Common suspicious identifiers — mentor requirement 2.

A counterparty (VPA / account / name) is surfaced when it appears in
statements of >= 2 different accounts, or receives from >= 3 distinct
sources — the classic signature of a collection/mule account.
"""

from collections import defaultdict


def common_identifiers(txns: list) -> list[dict]:
    per_identifier: dict[str, dict] = defaultdict(
        lambda: {"accounts": set(), "senders": set(), "txn_count": 0, "names": set()})

    for t in txns:
        if getattr(t, "excluded", False) or not t.counterparty_id:
            continue
        entry = per_identifier[t.counterparty_id]
        entry["accounts"].add(t.account_ref)
        entry["txn_count"] += 1
        if t.counterparty_name:
            entry["names"].add(t.counterparty_name)
        if t.direction == "DEBIT":  # this account SENDS to the identifier
            entry["senders"].add(t.account_ref)

    out = []
    for identifier, entry in per_identifier.items():
        if len(entry["accounts"]) >= 2 or len(entry["senders"]) >= 3:
            out.append({
                "identifier": identifier,
                "names": sorted(entry["names"]),
                "seen_in_accounts": sorted(entry["accounts"]),
                "distinct_senders": len(entry["senders"]),
                "txn_count": entry["txn_count"],
            })
    return sorted(out, key=lambda x: (-len(x["seen_in_accounts"]), -x["txn_count"]))
