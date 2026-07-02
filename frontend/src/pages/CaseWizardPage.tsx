import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseOut, Page, TransactionOut } from '../api/types'
import { UploadDropzone } from '../components/UploadDropzone'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { formatDateIST, formatINR } from '../lib/format'
import { fadeIn, staggerContainer } from '../theme/motion'

const STEPS = ['Upload', 'Review', 'Analyze'] as const
type Step = (typeof STEPS)[number]

const PAGE_SIZE = 200

export function CaseWizardPage() {
  const { caseId = '' } = useParams()
  const [caseData, setCaseData] = useState<CaseOut | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep] = useState<Step>('Upload')
  const [txnPage, setTxnPage] = useState<Page<TransactionOut> | null>(null)

  const refresh = useCallback(() => {
    api.getCase(caseId).then(setCaseData).catch(() => setNotFound(true))
    api.listTransactions(caseId, { limit: PAGE_SIZE }).then(setTxnPage).catch(() => {})
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

  const totalTxns = txnPage?.total ?? 0

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
            {caseData.complainant ?? 'Complainant not recorded'}
            {caseData.fraud_amount && ` · reported loss ${formatINR(caseData.fraud_amount)}`}
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
          {totalTxns > 0 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-body text-text-secondary">
                {totalTxns} transactions read so far.
              </p>
              <Button onClick={() => setStep('Review')}>Next: Review →</Button>
            </div>
          )}
        </motion.div>
      )}

      {step === 'Review' && <ReviewStep page={txnPage} onNext={() => setStep('Analyze')} />}

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

function ReviewStep({
  page,
  onNext,
}: {
  page: Page<TransactionOut> | null
  onNext: () => void
}) {
  if (!page || page.total === 0) {
    return (
      <Card className="max-w-xl">
        <p className="text-body text-text-secondary">
          No transactions yet — upload at least one statement in the Upload step first.
        </p>
      </Card>
    )
  }

  const reviewCount = page.items.filter((t) => t.needs_review).length

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-body text-text-secondary">
          {page.total} transactions read.{' '}
          {reviewCount > 0 ? (
            <span className="text-warning font-medium">
              {reviewCount} rows were hard to read and are highlighted — full review-and-fix
              arrives in Phase 2.
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
            {page.items.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-border last:border-0 ${
                  t.needs_review ? 'bg-warning-soft' : ''
                }`}
              >
                <td className="px-4 py-2 whitespace-nowrap text-text-primary">
                  {formatDateIST(t.txn_date)}
                </td>
                <td className="px-4 py-2 max-w-md truncate text-text-primary">
                  {t.narration_raw}
                </td>
                <td className="px-4 py-2">
                  <span className="tag bg-primary-soft text-primary">{t.channel}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-danger">
                  {t.direction === 'DEBIT' ? formatINR(t.amount_inr) : ''}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-success">
                  {t.direction === 'CREDIT' ? formatINR(t.amount_inr) : ''}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                  {formatINR(t.balance_after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.total > page.items.length && (
          <p className="px-4 py-3 text-label text-text-secondary border-t border-border">
            Showing first {page.items.length} of {page.total} transactions.
          </p>
        )}
      </div>
    </motion.div>
  )
}
