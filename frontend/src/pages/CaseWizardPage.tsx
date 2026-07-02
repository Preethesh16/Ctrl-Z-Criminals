import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Case, Transaction } from '../api/types'
import { UploadDropzone } from '../components/UploadDropzone'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { formatDateIST, formatINR } from '../lib/format'
import { fadeIn, staggerContainer } from '../theme/motion'

const STEPS = ['Upload', 'Review', 'Analyze'] as const
type Step = (typeof STEPS)[number]

export function CaseWizardPage() {
  const { caseId = '' } = useParams()
  const [caseData, setCaseData] = useState<Case | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep] = useState<Step>('Upload')
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const refresh = useCallback(() => {
    api.getCase(caseId).then(setCaseData).catch(() => setNotFound(true))
    api.listTransactions(caseId).then(setTransactions).catch(() => {})
  }, [caseId])

  useEffect(refresh, [refresh])

  if (notFound) {
    return (
      <Card className="max-w-xl">
        <p className="text-body text-text-secondary">
          This case could not be found.{' '}
          <Link to="/cases" className="text-primary font-medium">
            Back to Cases
          </Link>
        </p>
      </Card>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6">
        <Link to="/cases" className="text-label text-text-secondary hover:text-primary">
          ← All cases
        </Link>
        <h1 className="text-display text-text-primary mt-1">
          {caseData?.fir_number ?? 'Loading…'}
        </h1>
        {caseData && (
          <p className="text-body text-text-secondary mt-1">
            {caseData.complainant} · reported loss {formatINR(caseData.fraud_amount_paise)}
          </p>
        )}
      </motion.header>

      <motion.div variants={fadeIn} className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const isActive = s === step
          return (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`rounded-pill px-4 py-2 text-body font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-text-inverse'
                  : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {i + 1}. {s}
            </button>
          )
        })}
      </motion.div>

      {step === 'Upload' && (
        <motion.div variants={fadeIn}>
          <UploadDropzone caseId={caseId} onTransactionsAdded={refresh} />
          {transactions.length > 0 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-body text-text-secondary">
                {transactions.length} transactions read so far.
              </p>
              <Button onClick={() => setStep('Review')}>Next: Review →</Button>
            </div>
          )}
        </motion.div>
      )}

      {step === 'Review' && (
        <ReviewStep transactions={transactions} onNext={() => setStep('Analyze')} />
      )}

      {step === 'Analyze' && (
        <Card className="max-w-xl">
          <h2 className="text-section text-text-primary mb-2">Run analysis</h2>
          <p className="text-body text-text-secondary mb-4">
            One click will look for round trips, trace where the money went, and flag suspicious
            activity across all uploaded statements.
          </p>
          <Button disabled title="Detection engine arrives in Phase 3">
            Analyze case (coming in Phase 3)
          </Button>
        </Card>
      )}
    </motion.div>
  )
}

const LOW_CONFIDENCE_THRESHOLD = 0.7

function ReviewStep({
  transactions,
  onNext,
}: {
  transactions: Transaction[]
  onNext: () => void
}) {
  const lowConfidence = transactions.filter(
    (t) => t.extraction_confidence < LOW_CONFIDENCE_THRESHOLD,
  )

  if (transactions.length === 0) {
    return (
      <Card className="max-w-xl">
        <p className="text-body text-text-secondary">
          No transactions yet — upload at least one statement in the Upload step first.
        </p>
      </Card>
    )
  }

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-body text-text-secondary">
          {transactions.length} transactions read.{' '}
          {lowConfidence.length > 0 ? (
            <span className="text-warning font-medium">
              {lowConfidence.length} rows were hard to read and are highlighted — full
              review-and-fix arrives in Phase 2.
            </span>
          ) : (
            'All rows were read with high confidence.'
          )}
        </p>
        <Button onClick={onNext}>Next: Analyze →</Button>
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 text-label uppercase text-text-secondary">Date</th>
              <th className="px-4 py-3 text-label uppercase text-text-secondary">Narration</th>
              <th className="px-4 py-3 text-label uppercase text-text-secondary">Channel</th>
              <th className="px-4 py-3 text-label uppercase text-text-secondary text-right">
                Debit
              </th>
              <th className="px-4 py-3 text-label uppercase text-text-secondary text-right">
                Credit
              </th>
              <th className="px-4 py-3 text-label uppercase text-text-secondary text-right">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 200).map((t) => {
              const isLow = t.extraction_confidence < LOW_CONFIDENCE_THRESHOLD
              return (
                <tr
                  key={t.id}
                  className={`border-b border-border last:border-0 ${
                    isLow ? 'bg-warning-soft' : ''
                  }`}
                >
                  <td className="px-4 py-2 whitespace-nowrap text-text-primary">
                    {formatDateIST(t.txn_date)}
                  </td>
                  <td className="px-4 py-2 max-w-md truncate text-text-primary">{t.narration}</td>
                  <td className="px-4 py-2">
                    <span className="tag bg-primary-soft text-primary">{t.channel}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-danger">
                    {t.debit_paise !== null ? formatINR(t.debit_paise) : ''}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-success">
                    {t.credit_paise !== null ? formatINR(t.credit_paise) : ''}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                    {t.balance_paise !== null ? formatINR(t.balance_paise) : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {transactions.length > 200 && (
          <p className="px-4 py-3 text-label text-text-secondary border-t border-border">
            Showing first 200 of {transactions.length} — full pagination arrives with the real
            API.
          </p>
        )}
      </div>
    </motion.div>
  )
}
