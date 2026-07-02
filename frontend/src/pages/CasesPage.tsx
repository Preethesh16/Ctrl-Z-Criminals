import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Case, CaseCreate } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { formatDateIST, formatINR } from '../lib/format'
import { fadeIn, slideUp, staggerContainer } from '../theme/motion'

const STATUS_TAG: Record<Case['status'], { label: string; className: string }> = {
  draft: { label: 'New', className: 'bg-primary-soft text-primary' },
  ingesting: { label: 'Statements uploaded', className: 'bg-warning-soft text-warning' },
  review: { label: 'Needs review', className: 'bg-warning-soft text-warning' },
  analyzed: { label: 'Analyzed', className: 'bg-success-soft text-success' },
}

export function CasesPage() {
  const [cases, setCases] = useState<Case[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.listCases().then(setCases).catch(() => setCases([]))
  }, [])

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Cases</h1>
          <p className="text-body text-text-secondary mt-1">
            Each case holds the bank statements for one complaint
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ New Case</Button>
      </motion.header>

      {cases === null && <p className="text-body text-text-secondary">Loading cases…</p>}

      {cases?.length === 0 && (
        <Card className="max-w-xl text-center">
          <p className="text-section text-text-primary mb-2">No cases yet</p>
          <p className="text-body text-text-secondary mb-4">
            Create your first case with the FIR number, then upload the bank statements you
            received from the banks.
          </p>
          <Button onClick={() => setShowForm(true)}>Create the first case</Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 max-w-4xl">
        {cases?.map((c) => {
          const status = STATUS_TAG[c.status]
          return (
            <motion.button
              key={c.id}
              variants={slideUp}
              onClick={() => navigate(`/cases/${c.id}/wizard`)}
              className="card text-left hover:border-primary transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-card-title text-text-primary">{c.fir_number}</div>
                  <div className="text-body text-text-secondary mt-1">
                    {c.complainant} · reported loss {formatINR(c.fraud_amount_paise)} · opened{' '}
                    {formatDateIST(c.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="stat-number text-text-primary">{c.transactions_count}</div>
                    <div className="text-label uppercase text-text-secondary">transactions</div>
                  </div>
                  <span className={`tag ${status.className}`}>{status.label}</span>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>
        {showForm && (
          <NewCaseModal
            onClose={() => setShowForm(false)}
            onCreated={(created) => navigate(`/cases/${created.id}/wizard`)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function NewCaseModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (created: Case) => void
}) {
  const [firNumber, setFirNumber] = useState('')
  const [complainant, setComplainant] = useState('')
  const [fraudAmountRupees, setFraudAmountRupees] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const nextErrors: Record<string, string> = {}
    if (!firNumber.trim()) nextErrors.fir = 'Enter the FIR / CEN number'
    if (!complainant.trim()) nextErrors.complainant = 'Enter the complainant name'
    const rupees = Number(fraudAmountRupees.replace(/[,\s]/g, ''))
    if (!fraudAmountRupees || !Number.isFinite(rupees) || rupees <= 0)
      nextErrors.amount = 'Enter the amount lost, in rupees'
    if (!incidentDate) nextErrors.date = 'Pick the date of the incident'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const input: CaseCreate = {
      fir_number: firNumber.trim(),
      complainant: complainant.trim(),
      fraud_amount_paise: Math.round(rupees * 100),
      incident_date: incidentDate,
    }
    setSubmitting(true)
    try {
      onCreated(await api.createCase(input))
    } catch {
      setErrors({ submit: 'Could not create the case. Is the server running?' })
      setSubmitting(false)
    }
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
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-section text-text-primary mb-1">New Case</h2>
        <p className="text-body text-text-secondary mb-5">
          Details from the FIR — you can upload statements in the next step.
        </p>
        <div className="flex flex-col gap-4">
          <Input
            label="FIR / CEN number"
            placeholder="CEN/0042/2026"
            value={firNumber}
            onChange={(e) => setFirNumber(e.target.value)}
            error={errors.fir}
            autoFocus
          />
          <Input
            label="Complainant name"
            placeholder="Name as on the FIR"
            value={complainant}
            onChange={(e) => setComplainant(e.target.value)}
            error={errors.complainant}
          />
          <Input
            label="Amount lost (₹)"
            placeholder="5,00,000"
            inputMode="numeric"
            value={fraudAmountRupees}
            onChange={(e) => setFraudAmountRupees(e.target.value)}
            error={errors.amount}
          />
          <Input
            label="Incident date"
            type="date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            error={errors.date}
          />
        </div>
        {errors.submit && <p className="text-body text-danger mt-4">{errors.submit}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create case'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
