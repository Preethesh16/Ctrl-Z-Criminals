"""FIFO money-trail engine — plan.md §4.5, mentor requirement 5.

For a selected credit: maintain a FIFO queue of credit tranches; every
subsequent debit consumes tranches oldest-first (a debit can split across
tranches). The trail of the selected credit is the list of debits (with
attributed portions) that consumed ITS tranche.

Stop rules:
- "tranche"  (default): stop when the selected credit is fully spent
- "balance": stop when balance returns to the pre-credit level

If the tranche isn't exhausted by the end of the statement period the
remainder is reported as still resting in the account.
"""

from dataclasses import dataclass
from decimal import Decimal


@dataclass
class TrailHop:
    txn_id: str
    txn_date: str
    narration: str
    channel: str
    counterparty: str | None
    attributed: Decimal  # portion of THIS debit funded by the tracked credit
    debit_total: Decimal


@dataclass
class Trail:
    credit_txn_id: str
    credit_amount: Decimal
    pre_credit_balance: Decimal | None
    hops: list[TrailHop]
    spent: Decimal
    resting: Decimal  # unspent at period end
    stop_rule: str
    stopped_early: bool  # balance rule fired before tranche exhausted


def fifo_trail(txns: list, credit_txn_id: str, stop_rule: str = "tranche") -> Trail:
    """`txns` = ONE account's transactions; reversal-excluded rows skipped."""
    rows = sorted((t for t in txns if not getattr(t, "excluded", False)),
                  key=lambda t: (t.txn_date, t.row_index))
    target = next((t for t in rows if t.id == credit_txn_id), None)
    if target is None or target.direction != "CREDIT":
        raise ValueError("credit transaction not found in this account")

    target_idx = rows.index(target)
    pre_balance = None
    for t in reversed(rows[:target_idx]):
        if t.balance_after is not None:
            pre_balance = t.balance_after
            break

    # Tranche queue seeded with credits up to and including the target —
    # earlier unspent credits are consumed first (that's what FIFO means).
    queue: list[list] = []  # [txn_id, remaining]
    for t in rows[: target_idx + 1]:
        if t.direction == "CREDIT":
            queue.append([t.id, t.amount_inr])

    hops: list[TrailHop] = []
    spent = Decimal(0)
    stopped_early = False

    for t in rows[target_idx + 1 :]:
        if t.direction == "CREDIT":
            queue.append([t.id, t.amount_inr])
            continue
        remaining_debit = t.amount_inr
        attributed_here = Decimal(0)
        while remaining_debit > 0 and queue:
            tranche = queue[0]
            take = min(tranche[1], remaining_debit)
            tranche[1] -= take
            remaining_debit -= take
            if tranche[0] == credit_txn_id:
                attributed_here += take
            if tranche[1] == 0:
                queue.pop(0)
        if attributed_here > 0:
            hops.append(TrailHop(
                txn_id=t.id, txn_date=str(t.txn_date), narration=t.narration_raw,
                channel=t.channel,
                counterparty=t.counterparty_id or t.counterparty_name,
                attributed=attributed_here, debit_total=t.amount_inr,
            ))
            spent += attributed_here

        tranche_done = not any(tid == credit_txn_id for tid, _ in queue)
        if tranche_done:
            break
        if stop_rule == "balance" and pre_balance is not None \
                and t.balance_after is not None and t.balance_after <= pre_balance:
            stopped_early = True
            break

    return Trail(
        credit_txn_id=credit_txn_id,
        credit_amount=target.amount_inr,
        pre_credit_balance=pre_balance,
        hops=hops,
        spent=spent,
        resting=target.amount_inr - spent,
        stop_rule=stop_rule,
        stopped_early=stopped_early,
    )
