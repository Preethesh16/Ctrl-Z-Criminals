import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api/client'
import type { Direction, TransactionOut } from '../api/types'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { formatDateIST, formatINR } from '../lib/format'
import { slideUp, staggerContainer } from '../theme/motion'

/** Plain-English reason the row landed in the queue. */
function reasonFor(txn: TransactionOut): { label: string; className: string } {
  if (txn.flags.some((f) => f.rule === 'DUPLICATE-SUSPECT'))
    return { label: 'Possible duplicate', className: 'bg-warning-soft text-warning' }
  if (txn.flags.some((f) => f.rule === 'FD-07-BALANCE-BREAK'))
    return { label: 'Balance mismatch', className: 'bg-danger-soft text-danger' }
  return { label: 'Hard to read', className: 'bg-warning-soft text-warning' }
}

/**
 * Officer review queue: every row the system wasn't sure about, cleared one
 * decision at a time with big Accept / Fix / Exclude buttons.
 */
export function ReviewQueue({
  caseId,
  onChanged,
}: {
  caseId: string
  onChanged?: () => void
}) {
  const [queue, setQueue] = useState<TransactionOut[] | null>(null)
  const [initialCount, setInitialCount] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .listTransactions(caseId, { needs_review: true, limit: 100 })
      .then((page) => {
        const pending = page.items.filter((t) => !t.excluded)
        setQueue(pending)
        setInitialCount((prev) => Math.max(prev, page.total))
      })
      .catch(() => setQueue([]))
  }, [caseId])

  useEffect(load, [load])

  async function act(
    txn: TransactionOut,
    action: 'confirm' | 'exclude',
  ): Promise<void> {
    setQueue((prev) => prev?.filter((t) => t.id !== txn.id) ?? null)
    try {
      await api.reviewTransaction(txn.id, { action })
      onChanged?.()
    } catch {
      load() // restore the row if the server rejected the action
    }
  }

  if (queue === null) {
    return <p className="text-body text-text-secondary">Checking for rows that need review…</p>
  }

  if (queue.length === 0) {
    return (
      <Card className="max-w-xl mb-6">
        <p className="text-body text-success font-medium">
          ✓ Nothing needs your review — every transaction was read cleanly.
        </p>
      </Card>
    )
  }

  const done = Math.max(0, initialCount - queue.length)

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-body text-text-primary font-medium">
          {queue.length} row{queue.length === 1 ? '' : 's'} need your review
        </p>
        {done > 0 && (
          <span className="text-label text-text-secondary">
            {done} of {initialCount} cleared
          </span>
        )}
      </div>

      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-3"
      >
        <AnimatePresence>
          {queue.map((txn) => {
            const reason = reasonFor(txn)
            return (
              <motion.li
                key={txn.id}
                variants={slideUp}
                exit={{ opacity: 0, height: 0 }}
                className="card !p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`tag ${reason.className}`}>{reason.label}</span>
                      <span className="tag bg-primary-soft text-primary">{txn.channel}</span>
                    </div>
                    <div className="text-body text-text-primary truncate max-w-xl">
                      {txn.narration_raw}
                    </div>
                    <div className="text-label text-text-secondary mt-1">
                      {formatDateIST(txn.txn_date)} ·{' '}
                      <span className={txn.direction === 'DEBIT' ? 'text-danger' : 'text-success'}>
                        {txn.direction === 'DEBIT' ? 'paid out' : 'received'}{' '}
                        {formatINR(txn.amount_inr)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button onClick={() => act(txn, 'confirm')}>✓ Correct</Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditingId(editingId === txn.id ? null : txn.id)}
                    >
                      ✎ Fix
                    </Button>
                    <Button variant="secondary" onClick={() => act(txn, 'exclude')}>
                      ✕ Exclude
                    </Button>
                  </div>
                </div>

                {editingId === txn.id && (
                  <FixForm
                    txn={txn}
                    onSaved={() => {
                      setEditingId(null)
                      setQueue((prev) => prev?.filter((t) => t.id !== txn.id) ?? null)
                      onChanged?.()
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </motion.ul>
    </div>
  )
}

function FixForm({
  txn,
  onSaved,
  onCancel,
}: {
  txn: TransactionOut
  onSaved: () => void
  onCancel: () => void
}) {
  const [txnDate, setTxnDate] = useState(txn.txn_date)
  const [amount, setAmount] = useState(txn.amount_inr)
  const [direction, setDirection] = useState<Direction>(txn.direction)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const cleaned = amount.replace(/[,\s₹]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      setError('Enter the amount in rupees, digits only')
      return
    }
    setSaving(true)
    try {
      await api.reviewTransaction(txn.id, {
        action: 'correct',
        txn_date: txnDate,
        amount_inr: cleaned,
        direction,
      })
      onSaved()
    } catch {
      setError('Could not save the fix — try again.')
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4 flex flex-wrap items-end gap-4">
      <Input
        label="Date"
        type="date"
        value={txnDate}
        onChange={(e) => setTxnDate(e.target.value)}
        className="w-44"
      />
      <Input
        label="Amount (₹)"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={error}
        className="w-44"
      />
      <div>
        <span className="block text-label uppercase text-text-secondary mb-1">Type</span>
        <div className="flex gap-2">
          <Button
            variant={direction === 'CREDIT' ? 'primary' : 'secondary'}
            onClick={() => setDirection('CREDIT')}
          >
            Money in
          </Button>
          <Button
            variant={direction === 'DEBIT' ? 'primary' : 'secondary'}
            onClick={() => setDirection('DEBIT')}
          >
            Money out
          </Button>
        </div>
      </div>
      <div className="flex gap-2 ml-auto">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save fix'}
        </Button>
      </div>
    </div>
  )
}
