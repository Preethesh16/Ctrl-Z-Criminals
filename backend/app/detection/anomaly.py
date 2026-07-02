"""Isolation Forest anomaly scoring (plan.md §4.7). Runs fully locally.

Features per transaction: log-amount, direction, hour-of-day (when known),
day-of-week, channel, and account-relative amount z-score. Unsupervised —
trained on the case's own transactions; scores mark statistical outliers
for officer attention, never conclusions. Skipped for tiny cases.
"""

import math
from collections import defaultdict
from datetime import time

MIN_ROWS = 30
CHANNELS = ["UPI", "NEFT", "IMPS", "RTGS", "ATM", "CHEQUE", "CASH", "POS", "INTERNAL", "UNKNOWN"]


def score_anomalies(txns: list, contamination: float = 0.05) -> dict[str, float]:
    """Returns {txn_id: anomaly_score 0..1} for rows above the cutoff."""
    rows = [t for t in txns if not getattr(t, "excluded", False)]
    if len(rows) < MIN_ROWS:
        return {}

    from sklearn.ensemble import IsolationForest

    stats: dict[str, list] = defaultdict(list)
    for t in rows:
        stats[t.account_ref].append(float(t.amount_inr))
    mean_std = {}
    for acct, amounts in stats.items():
        mean = sum(amounts) / len(amounts)
        var = sum((a - mean) ** 2 for a in amounts) / len(amounts)
        mean_std[acct] = (mean, math.sqrt(var) or 1.0)

    def features(t) -> list[float]:
        mean, std = mean_std[t.account_ref]
        hour = t.txn_time.hour if isinstance(t.txn_time, time) else 12
        return [
            math.log10(float(t.amount_inr) + 1),
            1.0 if t.direction == "DEBIT" else 0.0,
            hour / 23,
            t.txn_date.weekday() / 6,
            float(CHANNELS.index(t.channel if t.channel in CHANNELS else "UNKNOWN")) / len(CHANNELS),
            (float(t.amount_inr) - mean) / std,
        ]

    X = [features(t) for t in rows]
    forest = IsolationForest(n_estimators=100, contamination=contamination, random_state=7)
    forest.fit(X)
    raw = forest.decision_function(X)  # lower = more anomalous
    lo, hi = min(raw), max(raw)
    span = (hi - lo) or 1.0
    labels = forest.predict(X)

    return {
        t.id: round(1 - (r - lo) / span, 3)
        for t, r, label in zip(rows, raw, labels)
        if label == -1
    }
