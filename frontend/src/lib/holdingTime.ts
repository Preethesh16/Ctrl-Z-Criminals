import type { TransactionOut } from '../api/types'

/**
 * Holding-time audit (FIFO): how long each credited amount actually sat in
 * the account before it moved on. Rapid pass-through (<24h) is classic mule
 * behaviour; money still resting is recoverable by freezing the account.
 */

export interface Holding {
  creditId: string
  account: string
  /** Tranche amount in INR. */
  amount: number
  narration: string
  channel: string
  arrivedAt: number // epoch ms
  /** When the tranche was fully consumed by debits; null = still in account. */
  spentAt: number | null
  /** Holding duration in ms (to spentAt, or to the account's last activity). */
  heldMs: number
  stillHeld: boolean
  /** Portion of the tranche still unspent (INR). */
  remaining: number
}

export interface AccountHoldings {
  account: string
  holdings: Holding[]
  totalCredited: number
  stillHeldAmount: number
  rapidCount: number
  avgHeldMs: number
  minTs: number
  maxTs: number
}

export const DAY_MS = 24 * 60 * 60 * 1000

function ts(t: TransactionOut): number {
  return new Date(`${t.txn_date}T${t.txn_time ?? '00:00:00'}`).getTime()
}

/** "3 days", "6 hours", "same day" (when no time-of-day is in the statement). */
export function formatHeld(ms: number, hasTimes: boolean): string {
  if (ms >= DAY_MS) {
    const days = Math.round(ms / DAY_MS)
    return `${days} day${days === 1 ? '' : 's'}`
  }
  if (!hasTimes) return 'same day'
  const hours = ms / (60 * 60 * 1000)
  if (hours >= 1) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`
  return `${Math.max(1, Math.round(ms / 60000))} min`
}

export type HoldSpeed = 'rapid' | 'short' | 'long'

/** rapid = moved within 24h (mule sign) · short = under a week · long = held / resting. */
export function holdSpeed(h: Holding): HoldSpeed {
  if (h.stillHeld) return 'long'
  if (h.heldMs < DAY_MS) return 'rapid'
  if (h.heldMs < 7 * DAY_MS) return 'short'
  return 'long'
}

export function computeHoldings(txns: TransactionOut[]): AccountHoldings[] {
  const byAccount = new Map<string, TransactionOut[]>()
  for (const t of txns) {
    if (t.excluded) continue
    const list = byAccount.get(t.account_ref) ?? []
    list.push(t)
    byAccount.set(t.account_ref, list)
  }

  const result: AccountHoldings[] = []
  for (const [account, rows] of byAccount) {
    rows.sort((a, b) => ts(a) - ts(b) || a.row_index - b.row_index)
    const lastTs = ts(rows[rows.length - 1])
    interface OpenTranche {
      credit: TransactionOut
      remaining: number
      spentAt: number | null
    }
    const queue: OpenTranche[] = []
    const closed: Holding[] = []

    for (const t of rows) {
      const amount = Number(t.amount_inr)
      if (t.direction === 'CREDIT') {
        queue.push({ credit: t, remaining: amount, spentAt: null })
        continue
      }
      // DEBIT: consume open tranches oldest-first (FIFO)
      let toConsume = amount
      for (const tr of queue) {
        if (toConsume <= 0) break
        if (tr.remaining <= 0) continue
        const take = Math.min(tr.remaining, toConsume)
        tr.remaining -= take
        toConsume -= take
        if (tr.remaining <= 0.005) {
          tr.remaining = 0
          tr.spentAt = ts(t)
        }
      }
    }

    for (const tr of queue) {
      const arrivedAt = ts(tr.credit)
      const stillHeld = tr.remaining > 0
      const end = tr.spentAt ?? lastTs
      closed.push({
        creditId: tr.credit.id,
        account,
        amount: Number(tr.credit.amount_inr),
        narration: tr.credit.narration_raw,
        channel: tr.credit.channel,
        arrivedAt,
        spentAt: tr.spentAt,
        heldMs: Math.max(0, end - arrivedAt),
        stillHeld,
        remaining: tr.remaining,
      })
    }

    if (closed.length === 0) continue
    const totalCredited = closed.reduce((s, h) => s + h.amount, 0)
    result.push({
      account,
      holdings: closed,
      totalCredited,
      stillHeldAmount: closed.reduce((s, h) => s + h.remaining, 0),
      rapidCount: closed.filter((h) => holdSpeed(h) === 'rapid').length,
      avgHeldMs: closed.reduce((s, h) => s + h.heldMs, 0) / closed.length,
      minTs: ts(rows[0]),
      maxTs: lastTs,
    })
  }
  // Accounts with the most rapid pass-throughs first — those are the mules.
  return result.sort((a, b) => b.rapidCount - a.rapidCount || b.totalCredited - a.totalCredited)
}
