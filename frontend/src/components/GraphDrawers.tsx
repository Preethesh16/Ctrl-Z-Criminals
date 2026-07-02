import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client'
import type { GraphEdgeData, GraphNodeData, TransactionOut } from '../api/types'
import { explainFlag, flagLabel } from '../lib/flagExplanations'
import { formatDateIST, formatINR } from '../lib/format'
import { transitions } from '../theme/motion'

const drawerMotion = {
  initial: { x: 420, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 420, opacity: 0 },
  transition: transitions.enter,
}

function DrawerShell({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <motion.aside
      {...drawerMotion}
      className="fixed right-0 top-0 z-40 h-full w-[400px] bg-surface border-l border-border shadow-card overflow-y-auto p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-section text-text-primary break-all">{title}</h2>
        <button
          onClick={onClose}
          className="rounded-control px-2 py-1 text-body text-text-secondary hover:bg-background"
        >
          ✕
        </button>
      </div>
      {children}
    </motion.aside>
  )
}

/** Node click → the account's numbers, badge, and its flagged transactions. */
export function NodeDrawer({
  caseId,
  node,
  onClose,
}: {
  caseId: string
  node: GraphNodeData
  onClose: () => void
}) {
  const [transactions, setTransactions] = useState<TransactionOut[] | null>(null)

  useEffect(() => {
    // External counterparties have no rows of their own; only own accounts do.
    if (!node.own_account) {
      setTransactions([])
      return
    }
    api
      .listTransactions(caseId, { limit: 200 })
      .then((page) => setTransactions(page.items.filter((t) => t.account_ref === node.id)))
      .catch(() => setTransactions([]))
  }, [caseId, node])

  const flagged = (transactions ?? []).filter((t) => t.flags.length > 0)

  return (
    <DrawerShell title={node.label} onClose={onClose}>
      <div className="flex gap-2 mb-4 flex-wrap">
        {node.accumulator && (
          <span className="tag bg-danger-soft text-danger">Funds accumulate here</span>
        )}
        <span
          className={`tag ${
            node.suspicion === 'high'
              ? 'bg-danger-soft text-danger'
              : node.suspicion === 'medium'
                ? 'bg-warning-soft text-warning'
                : 'bg-primary-soft text-primary'
          }`}
        >
          {node.suspicion === 'high' ? 'Suspicious' : node.suspicion === 'medium' ? 'Watch' : 'Normal'}
        </span>
        {node.own_account && <span className="tag bg-primary-soft text-primary">Statement uploaded</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="card !p-3">
          <div className="text-label uppercase text-text-secondary">Money in</div>
          <div className="text-body font-semibold text-success tabular-nums">
            {formatINR(node.inflow)}
          </div>
        </div>
        <div className="card !p-3">
          <div className="text-label uppercase text-text-secondary">Money out</div>
          <div className="text-body font-semibold text-danger tabular-nums">
            {formatINR(node.outflow)}
          </div>
        </div>
      </div>

      {!node.own_account ? (
        <p className="text-body text-text-secondary">
          This account appears only in other people's statements — request its statement from the
          bank to trace further.
        </p>
      ) : transactions === null ? (
        <p className="text-body text-text-secondary">Loading transactions…</p>
      ) : flagged.length === 0 ? (
        <p className="text-body text-text-secondary">No flagged transactions on this account.</p>
      ) : (
        <>
          <h3 className="text-card-title text-text-primary mb-2">
            Flagged transactions ({flagged.length})
          </h3>
          <ul className="flex flex-col gap-3">
            {flagged.slice(0, 20).map((t) => (
              <li key={t.id} className="border-b border-border pb-2">
                <div className="text-body text-text-primary truncate">{t.narration_raw}</div>
                <div className="text-label text-text-secondary">
                  {formatDateIST(t.txn_date)} ·{' '}
                  <span className={t.direction === 'DEBIT' ? 'text-danger' : 'text-success'}>
                    {formatINR(t.amount_inr)}
                  </span>
                </div>
                {t.flags.map((f, i) => (
                  <p key={i} className="text-label text-text-secondary mt-1">
                    <span className="tag bg-warning-soft text-warning mr-1">{flagLabel(f)}</span>
                    {explainFlag(f)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </DrawerShell>
  )
}

/** Edge click → the transfer's evidence. */
export function EdgeDrawer({ edge, onClose }: { edge: GraphEdgeData; onClose: () => void }) {
  return (
    <DrawerShell title="Transfer evidence" onClose={onClose}>
      <div className="flex flex-col gap-3 text-body">
        <div>
          <div className="text-label uppercase text-text-secondary">From → To</div>
          <div className="text-text-primary break-all">
            {edge.source.replace('ext:', '')} → {edge.target.replace('ext:', '')}
          </div>
        </div>
        <div>
          <div className="text-label uppercase text-text-secondary">Amount</div>
          <div className="text-text-primary font-semibold tabular-nums">
            {formatINR(edge.amount)}
          </div>
        </div>
        <div>
          <div className="text-label uppercase text-text-secondary">When</div>
          <div className="text-text-primary">{formatDateIST(edge.when)}</div>
        </div>
        <div>
          <div className="text-label uppercase text-text-secondary">Channel</div>
          <span className="tag bg-primary-soft text-primary">{edge.channel}</span>
        </div>
        <div>
          <div className="text-label uppercase text-text-secondary">Reference / UTR</div>
          <div className="text-text-primary tabular-nums">{edge.reference ?? '—'}</div>
        </div>
        <div>
          <div className="text-label uppercase text-text-secondary">Link strength</div>
          {edge.tier === 'confirmed' ? (
            <p className="text-text-primary">
              <span className="tag bg-success-soft text-success mr-1">Confirmed</span>
              The same reference number appears in both accounts' statements.
            </p>
          ) : (
            <p className="text-text-primary">
              <span className="tag bg-warning-soft text-warning mr-1">Probable</span>
              Matched by amount and timing — request the counterparty statement to confirm.
            </p>
          )}
        </div>
      </div>
    </DrawerShell>
  )
}
