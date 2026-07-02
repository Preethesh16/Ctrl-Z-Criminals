import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api/client'
import type { CaseOut, GraphNodeData } from '../api/types'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { formatINR } from '../lib/format'
import { fadeIn, slideUp } from '../theme/motion'

/**
 * Golden Hour board: in cyber-fraud the first hours decide whether money is
 * recoverable. One card per suspicious account with a freeze status the
 * officer updates as banks respond, plus a prefilled Section 94 BNSS notice.
 *
 * Status lives in localStorage (officer's working state, not case evidence);
 * nothing is ever sent automatically.
 */

const STATUSES = [
  { key: 'not_contacted', label: 'Not contacted', className: 'bg-danger-soft text-danger' },
  { key: 'notice_sent', label: 'Notice sent', className: 'bg-warning-soft text-warning' },
  { key: 'frozen', label: 'Frozen', className: 'bg-success-soft text-success' },
  { key: 'escaped', label: 'Funds moved out', className: 'bg-sidebar text-text-inverse' },
] as const

type FreezeStatus = (typeof STATUSES)[number]['key']

function storageKey(caseId: string): string {
  return `tracenet.freeze.${caseId}`
}

function loadStatuses(caseId: string): Record<string, FreezeStatus> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(caseId)) ?? '{}')
  } catch {
    return {}
  }
}

export function GoldenHourBoard({ caseId, caseData }: { caseId: string; caseData: CaseOut }) {
  const [suspects, setSuspects] = useState<GraphNodeData[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, FreezeStatus>>({})
  const [summonsFor, setSummonsFor] = useState<GraphNodeData | null>(null)

  useEffect(() => {
    setStatuses(loadStatuses(caseId))
    api
      .getGraph(caseId)
      .then((g) => {
        const flagged = g.nodes
          .map((n) => n.data)
          .filter((n) => n.suspicion !== 'low' || n.accumulator)
          .sort((a, b) => Number(b.inflow) + Number(b.outflow) - (Number(a.inflow) + Number(a.outflow)))
        setSuspects(flagged)
      })
      .catch(() => setSuspects(null))
  }, [caseId])

  function setStatus(accountId: string, status: FreezeStatus) {
    const next = { ...statuses, [accountId]: status }
    setStatuses(next)
    localStorage.setItem(storageKey(caseId), JSON.stringify(next))
  }

  if (suspects === null) {
    return (
      <Card title="Golden Hour — freeze board">
        <p className="text-body text-text-secondary">
          Run the analysis first — the suspicious accounts appear here for freeze tracking.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Golden Hour — freeze board">
      <p className="text-body text-text-secondary mb-4">
        Every hour counts. Track each suspicious account: send the Section 94 notice, mark it
        frozen when the bank confirms.
      </p>
      {suspects.length === 0 && (
        <p className="text-body text-text-secondary">No suspicious accounts in this case.</p>
      )}
      <ul className="flex flex-col gap-3">
        {suspects.map((s) => {
          const status = statuses[s.id] ?? 'not_contacted'
          const meta = STATUSES.find((st) => st.key === status)!
          return (
            <motion.li
              key={s.id}
              variants={slideUp}
              className="border border-border rounded-control p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-body font-medium text-text-primary truncate">{s.label}</div>
                <div className="text-label text-text-secondary">
                  received {formatINR(s.inflow)}
                  {s.accumulator && (
                    <span className="tag bg-danger-soft text-danger ml-2">funds accumulate</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={status}
                  onChange={(e) => setStatus(s.id, e.target.value as FreezeStatus)}
                  className={`tag ${meta.className} border-0 cursor-pointer`}
                >
                  {STATUSES.map((st) => (
                    <option key={st.key} value={st.key}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => setSummonsFor(s)}>
                  Section 94 notice
                </Button>
              </div>
            </motion.li>
          )
        })}
      </ul>

      <AnimatePresence>
        {summonsFor && (
          <SummonsModal
            account={summonsFor}
            caseData={caseData}
            onClose={() => setSummonsFor(null)}
            onDownloaded={() => {
              if ((statuses[summonsFor.id] ?? 'not_contacted') === 'not_contacted') {
                setStatus(summonsFor.id, 'notice_sent')
              }
              setSummonsFor(null)
            }}
          />
        )}
      </AnimatePresence>
    </Card>
  )
}

function summonsText(account: GraphNodeData, caseData: CaseOut): string {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  return `BEFORE THE OFFICE OF THE CYBERCRIME POLICE STATION, BENGALURU CITY

NOTICE UNDER SECTION 94, BHARATIYA NAGARIK SURAKSHA SANHITA, 2023
(Summons to produce document or other thing)

Date: ${today}
Ref: FIR / CEN No. ${caseData.fir_number}

To,
The Nodal Officer / Branch Manager,
[Bank name and branch — fill in]

Subject: Freezing of account and production of records — account/identifier "${account.label}"

Whereas an investigation is in progress in the above-referenced case involving an alleged
loss of ${caseData.fraud_amount ? '₹' + caseData.fraud_amount : '[amount]'} to the complainant
${caseData.complainant ?? '[complainant name]'}, and whereas analysis of banking records has
identified the account/identifier "${account.label}" as having received proceeds connected to
the offence;

You are hereby required, under Section 94 of the BNSS, 2023:

1. To place an immediate DEBIT FREEZE on the said account and confirm compliance;
2. To produce the complete account opening form (AOF) and KYC documents;
3. To produce the account statement from account opening to date;
4. To provide the registered mobile number, email, and linked device/IP logs;
5. To provide details of any linked accounts, cards, wallets, or UPI handles.

The records may be produced to the undersigned within 24 hours by email with a certificate
under Section 63 of the Bharatiya Sakshya Adhiniyam, 2023.

[Name and designation of Investigating Officer]
[Police Station] · [Contact]

--- Generated by TraceNet for officer review. VERIFY ALL DETAILS BEFORE ISSUING. ---
`
}

function SummonsModal({
  account,
  caseData,
  onClose,
  onDownloaded,
}: {
  account: GraphNodeData
  caseData: CaseOut
  onClose: () => void
  onDownloaded: () => void
}) {
  const [text, setText] = useState(() => summonsText(account, caseData))

  function download() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `section94-${account.label.replace(/\W+/g, '_')}.txt`
    link.click()
    URL.revokeObjectURL(link.href)
    onDownloaded()
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/60 p-8"
      onClick={onClose}
    >
      <motion.div
        variants={slideUp}
        className="card w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-section text-text-primary mb-1">Section 94 BNSS notice</h2>
        <p className="text-body text-text-secondary mb-4">
          Prefilled from the case — review and edit before issuing.{' '}
          <span className="font-medium text-text-primary">Nothing is sent automatically.</span>
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="w-full h-96 rounded-control border border-border bg-surface p-3 text-label font-mono text-text-primary outline-none focus:border-primary"
        />
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={download}>Download notice</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
