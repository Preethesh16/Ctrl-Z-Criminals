import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseOut, TransactionOut } from '../api/types'
import { Card } from '../components/ui/Card'
import { formatINR } from '../lib/format'
import {
  computeHoldings,
  formatHeld,
  holdSpeed,
  type AccountHoldings,
  type Holding,
} from '../lib/holdingTime'
import { fadeIn, staggerContainer } from '../theme/motion'

const SPEED_STYLE = {
  rapid: { bar: 'bg-danger', tag: 'bg-danger-soft text-danger', label: 'moved within 24h' },
  short: { bar: 'bg-warning', tag: 'bg-warning-soft text-warning', label: 'moved within a week' },
  long: { bar: 'bg-success', tag: 'bg-success-soft text-success', label: 'held long / resting' },
} as const

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

/**
 * Holding Time — a timeline audit: for every credited amount, how long it
 * stayed in the account before moving on (FIFO attribution, computed on
 * this machine from the case's transactions).
 */
export function HoldingTimePage() {
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const caseId = searchParams.get('case')
  const [txns, setTxns] = useState<TransactionOut[] | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)

  useEffect(() => {
    api.listCases().then(setCases).catch(() => setCases([]))
  }, [])

  useEffect(() => {
    if (cases && cases.length > 0 && !caseId) {
      setSearchParams({ case: cases[0].id }, { replace: true })
    }
  }, [cases, caseId, setSearchParams])

  useEffect(() => {
    if (!caseId) return
    setTxns(null)
    setSelectedAccount(null)
    api
      .listTransactions(caseId, { limit: 500 })
      .then((page) => setTxns(page.items))
      .catch(() => setTxns([]))
  }, [caseId])

  const accounts = useMemo(() => (txns ? computeHoldings(txns) : []), [txns])
  const active: AccountHoldings | null =
    accounts.find((a) => a.account === selectedAccount) ?? accounts[0] ?? null

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Holding Time</h1>
          <p className="text-body text-text-secondary mt-1">
            How long each credited amount sat in the account before it moved on — quick in-and-out
            is mule behaviour, money still resting can be frozen
          </p>
        </div>
        {cases && cases.length > 1 && (
          <select
            value={caseId ?? ''}
            onChange={(e) => setSearchParams({ case: e.target.value })}
            className="rounded-control border border-border bg-surface px-3 py-2 text-body"
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fir_number}
              </option>
            ))}
          </select>
        )}
      </motion.header>

      {txns === null && <p className="text-body text-text-secondary">Loading transactions…</p>}

      {txns !== null && accounts.length === 0 && (
        <Card className="max-w-xl">
          <p className="text-body text-text-secondary">
            No credits found to audit — upload statements to this case first.
          </p>
        </Card>
      )}

      {accounts.length > 0 && (
        <div className="grid grid-cols-[340px_1fr] gap-6">
          {/* Account picker — most rapid pass-throughs first */}
          <Card title="Accounts (worst first)" className="h-fit max-h-[640px] overflow-y-auto">
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li key={a.account}>
                  <button
                    onClick={() => setSelectedAccount(a.account)}
                    className={`w-full rounded-control border px-3 py-2 text-left transition-colors ${
                      active?.account === a.account
                        ? 'border-primary bg-primary-soft'
                        : 'border-border hover:border-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-body font-medium text-text-primary truncate">
                        {a.account}
                      </span>
                      {a.rapidCount > 0 && (
                        <span className="tag bg-danger-soft text-danger shrink-0">
                          {a.rapidCount} rapid
                        </span>
                      )}
                    </div>
                    <div className="text-label text-text-secondary">
                      {a.holdings.length} credits · {formatINR(String(a.stillHeldAmount))} still
                      resting
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {/* Timeline audit for the selected account */}
          {active && <HoldingTimeline key={active.account} data={active} />}
        </div>
      )}
    </motion.div>
  )
}

function HoldingTimeline({ data }: { data: AccountHoldings }) {
  const range = Math.max(1, data.maxTs - data.minTs)
  const rows = [...data.holdings].sort((a, b) => a.arrivedAt - b.arrivedAt)
  const hasTimes = false // most Indian statements carry no time-of-day; formatHeld handles both

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card className="!p-4">
          <div className="text-label uppercase text-text-secondary">Credits audited</div>
          <div className="stat-number text-text-primary">{rows.length}</div>
        </Card>
        <Card className="!p-4">
          <div className="text-label uppercase text-text-secondary">Average holding</div>
          <div className="stat-number text-text-primary">
            {formatHeld(data.avgHeldMs, hasTimes)}
          </div>
        </Card>
        <Card className="!p-4">
          <div className="text-label uppercase text-text-secondary">Still in account</div>
          <div className="stat-number text-success">
            {formatINR(String(data.stillHeldAmount))}
          </div>
        </Card>
      </div>

      <Card title={`Timeline — A/c ${data.account}`} className="mb-4">
        <div className="flex items-center justify-between text-label text-text-secondary mb-3">
          <span>{fmtDate(data.minTs)}</span>
          <span className="flex gap-4">
            <span>
              <span className="inline-block w-3 h-3 rounded-pill bg-danger mr-1 align-middle" />
              moved &lt;24h
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-pill bg-warning mr-1 align-middle" />
              &lt;1 week
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-pill bg-success mr-1 align-middle" />
              held / resting
            </span>
          </span>
          <span>{fmtDate(data.maxTs)}</span>
        </div>

        <ul className="flex flex-col gap-3">
          {rows.map((h) => (
            <HoldingRow key={h.creditId} holding={h} minTs={data.minTs} range={range} />
          ))}
        </ul>
      </Card>
    </motion.div>
  )
}

function HoldingRow({
  holding: h,
  minTs,
  range,
}: {
  holding: Holding
  minTs: number
  range: number
}) {
  const speed = holdSpeed(h)
  const style = SPEED_STYLE[speed]
  const left = ((h.arrivedAt - minTs) / range) * 100
  const width = Math.max(1.5, (h.heldMs / range) * 100)
  return (
    <li>
      <div className="flex items-center justify-between text-label mb-1">
        <span className="text-text-primary font-medium tabular-nums">
          {formatINR(String(h.amount))}
          <span className="text-text-secondary font-normal"> · {h.channel}</span>
        </span>
        <span className={`tag ${style.tag}`}>
          {h.stillHeld
            ? `${formatINR(String(h.remaining))} still here after ${formatHeld(h.heldMs, false)}`
            : `held ${formatHeld(h.heldMs, Boolean(h.spentAt))} — ${style.label}`}
        </span>
      </div>
      <div className="relative h-4 rounded-pill bg-background overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-pill ${style.bar}`}
          style={{ left: `${Math.min(left, 98)}%`, width: `${Math.min(width, 100 - Math.min(left, 98))}%` }}
          title={`arrived ${fmtDate(h.arrivedAt)}${h.spentAt ? ` — gone ${fmtDate(h.spentAt)}` : ' — still in account'}`}
        />
      </div>
      <div className="text-label text-text-secondary mt-0.5">
        arrived {fmtDate(h.arrivedAt)}
        {h.spentAt ? ` → fully moved on ${fmtDate(h.spentAt)}` : ' → never fully left'} ·{' '}
        <span className="truncate">{h.narration.slice(0, 70)}</span>
      </div>
    </li>
  )
}
