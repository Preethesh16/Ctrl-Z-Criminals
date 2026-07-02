"""Forensic detection rules FD-01…FD-08 (plan.md §4.7).

Every flag carries the rule inputs that fired — the evidence gate demands
officers see the reasoning, not just the conclusion. FD-07 (balance
arithmetic) lives in the cleaning suite; the rest are here.

Returns {txn_id: [flag_dict, ...]} — the analysis service merges them
into Transaction.flags.
"""

from collections import defaultdict
from datetime import time, timedelta
from decimal import Decimal


class Thresholds:
    round_figure_min = Decimal(10000)
    rapid_inout_window_h = 4
    rapid_inout_pct = Decimal("0.80")
    odd_hour_start, odd_hour_end = time(0, 0), time(5, 0)
    smurf_limit = Decimal(50000)  # RBI threshold
    smurf_min_credits = 3
    velocity_multiplier = 3.0
    dominance_pct = Decimal("0.60")
    new_account_days = 30
    new_account_inflow = Decimal(200000)


def _flag(rule: str, why: str, **evidence) -> dict:
    return {"rule": rule, "why": why, **{k: str(v) for k, v in evidence.items()}}


def run_rules(txns: list, th: Thresholds = Thresholds()) -> dict[str, list[dict]]:
    rows = [t for t in txns if not getattr(t, "excluded", False)]
    flags: dict[str, list[dict]] = defaultdict(list)
    by_account: dict[str, list] = defaultdict(list)
    for t in rows:
        by_account[t.account_ref].append(t)
    for acct_rows in by_account.values():
        acct_rows.sort(key=lambda t: (t.txn_date, t.row_index))

    # FD-01 round figure
    for t in rows:
        if t.amount_inr >= th.round_figure_min and t.amount_inr % 1000 == 0:
            flags[t.id].append(_flag("FD-01-ROUND-FIGURE",
                                     "humans pick round numbers when structuring",
                                     amount=t.amount_inr))

    # FD-03 odd hour (needs a time)
    for t in rows:
        if isinstance(t.txn_time, time) and th.odd_hour_start <= t.txn_time < th.odd_hour_end:
            flags[t.id].append(_flag("FD-03-ODD-HOUR",
                                     "activity between 00:00 and 05:00",
                                     at=t.txn_time, channel=t.channel))

    for account, acct_rows in by_account.items():
        credits = [t for t in acct_rows if t.direction == "CREDIT"]
        debits = [t for t in acct_rows if t.direction == "DEBIT"]

        # FD-02 rapid in-out: credit forwarded (>=80%) within the window
        for c in credits:
            horizon = c.txn_date + timedelta(days=1)  # date granularity fallback
            fwd = [d for d in debits if c.txn_date <= d.txn_date <= horizon
                   and (d.txn_date, d.row_index) > (c.txn_date, c.row_index)]
            sent = sum((d.amount_inr for d in fwd), Decimal(0))
            if sent >= c.amount_inr * th.rapid_inout_pct and c.amount_inr > 0:
                evidence_ids = [d.id for d in fwd][:6]
                for tid in (c.id, *evidence_ids):
                    flags[tid].append(_flag("FD-02-RAPID-IN-OUT",
                                            "credit forwarded almost immediately — mule signature",
                                            credited=c.amount_inr, forwarded=sent,
                                            within="~%dh" % (th.rapid_inout_window_h
                                                             if c.txn_time else 24)))

        # FD-04 structuring/smurfing: same-day credits each under the limit
        by_day: dict = defaultdict(list)
        for c in credits:
            by_day[c.txn_date].append(c)
        for day, day_credits in by_day.items():
            small = [c for c in day_credits if c.amount_inr < th.smurf_limit]
            total = sum((c.amount_inr for c in small), Decimal(0))
            if len(small) >= th.smurf_min_credits and total > th.smurf_limit:
                for c in small:
                    flags[c.id].append(_flag("FD-04-SMURFING",
                                             "multiple sub-50k credits summing above the threshold",
                                             day=day, count=len(small), total=total))

        # FD-05 velocity spike: any day with > multiplier x average daily count
        day_counts: dict = defaultdict(int)
        for t in acct_rows:
            day_counts[t.txn_date] += 1
        if len(day_counts) >= 5:
            avg = sum(day_counts.values()) / len(day_counts)
            for day, n in day_counts.items():
                if n > max(th.velocity_multiplier * avg, 5):
                    for t in acct_rows:
                        if t.txn_date == day:
                            flags[t.id].append(_flag("FD-05-VELOCITY-SPIKE",
                                                     "daily activity far above account's norm",
                                                     day=day, count=n, daily_avg=round(avg, 1)))

        # FD-06 new-account spike: heavy inflow in first N days of history
        if acct_rows:
            first = acct_rows[0].txn_date
            window = [t for t in credits if (t.txn_date - first).days <= th.new_account_days]
            inflow = sum((t.amount_inr for t in window), Decimal(0))
            opening_like = acct_rows[0].balance_after is not None and \
                acct_rows[0].balance_after <= acct_rows[0].amount_inr + Decimal(10000)
            if inflow >= th.new_account_inflow and opening_like:
                for t in window:
                    flags[t.id].append(_flag("FD-06-NEW-ACCOUNT-SPIKE",
                                             "large inflows right at the start of account history",
                                             inflow=inflow, days=th.new_account_days))

        # FD-08 single counterparty dominance (of debits)
        outflow: dict[str, Decimal] = defaultdict(Decimal)
        total_debit = Decimal(0)
        for d in debits:
            total_debit += d.amount_inr
            if d.counterparty_id:
                outflow[d.counterparty_id] += d.amount_inr
        for cp, amt in outflow.items():
            if total_debit > 0 and amt > total_debit * th.dominance_pct:
                for d in debits:
                    if d.counterparty_id == cp:
                        flags[d.id].append(_flag("FD-08-COUNTERPARTY-DOMINANCE",
                                                 "most of this account's money goes to one place",
                                                 counterparty=cp, share=f"{float(amt/total_debit*100):.0f}%"))

    return dict(flags)
