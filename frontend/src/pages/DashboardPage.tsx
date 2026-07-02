import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseOut, CaseStats, CleanReport } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { fadeIn, staggerContainer } from '../theme/motion'

/**
 * Dashboard shell (Phase 2): headline cards + cleaning summary.
 * Disposition donut, timeline, and suspicious-identifier panel land in
 * Phase 3 when the analysis APIs exist.
 */
export function DashboardPage() {
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [stats, setStats] = useState<CaseStats | null>(null)
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null)
  const [cleaningNow, setCleaningNow] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCaseId = searchParams.get('case')

  useEffect(() => {
    api.listCases().then(setCases).catch(() => setCases([]))
  }, [])

  // Default to the most recent case once cases load.
  useEffect(() => {
    if (cases && cases.length > 0 && !selectedCaseId) {
      setSearchParams({ case: cases[0].id }, { replace: true })
    }
  }, [cases, selectedCaseId, setSearchParams])

  useEffect(() => {
    if (!selectedCaseId) return
    setStats(null)
    setCleanReport(null)
    api.getCaseStats(selectedCaseId).then(setStats).catch(() => {})
  }, [selectedCaseId])

  const selectedCase = cases?.find((c) => c.id === selectedCaseId) ?? null

  async function runCleaning() {
    if (!selectedCaseId) return
    setCleaningNow(true)
    try {
      setCleanReport(await api.cleanCase(selectedCaseId))
      api.getCaseStats(selectedCaseId).then(setStats).catch(() => {})
    } catch {
      /* keep previous state; the officer can retry */
    } finally {
      setCleaningNow(false)
    }
  }

  const duplicates = cleanReport?.duplicate_pairs ?? stats?.cleaning.duplicates_flagged
  const reversals = cleanReport?.reversal_pairs ?? stats?.cleaning.reversals_detected
  const balanceBreaks = cleanReport?.balance_breaks ?? stats?.cleaning.balance_breaks

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Dashboard</h1>
          <p className="text-body text-text-secondary mt-1">
            {selectedCase ? `Case ${selectedCase.fir_number}` : 'The case at a glance'}
          </p>
        </div>
        {cases && cases.length > 1 && (
          <select
            value={selectedCaseId ?? ''}
            onChange={(e) => setSearchParams({ case: e.target.value })}
            className="rounded-control border border-border bg-surface px-3 py-2 text-body text-text-primary"
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fir_number}
              </option>
            ))}
          </select>
        )}
      </motion.header>

      {cases?.length === 0 && (
        <Card className="max-w-xl">
          <p className="text-section text-text-primary mb-2">No cases yet</p>
          <p className="text-body text-text-secondary mb-4">
            The dashboard fills up once a case has statements. Create a case and upload the bank
            statements first.
          </p>
          <Link to="/cases">
            <Button>Go to Cases</Button>
          </Link>
        </Card>
      )}

      {selectedCase && (
        <>
          <div className="grid grid-cols-4 gap-6 mb-6">
            <StatCard label="Transactions analyzed" value={stats?.transactions_count ?? '…'} />
            <StatCard
              label="Rows needing review"
              value={stats?.needs_review_count ?? '…'}
              tone={stats && stats.needs_review_count > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Flagged"
              value={stats?.flagged_count ?? '…'}
              tone={stats && stats.flagged_count > 0 ? 'danger' : 'default'}
            />
            <StatCard label="Accounts involved" value={stats?.accounts_count ?? '…'} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <Card title="Cleaning summary">
              {stats ? (
                <ul className="flex flex-col gap-2 text-body text-text-primary">
                  <li className="flex justify-between">
                    <span>Possible duplicate transactions flagged</span>
                    <span className="font-medium tabular-nums">{duplicates}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Failed / reversed transactions detected</span>
                    <span className="font-medium tabular-nums">{reversals}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Balance inconsistencies found</span>
                    <span
                      className={`font-medium tabular-nums ${
                        (balanceBreaks ?? 0) > 0 ? 'text-danger' : ''
                      }`}
                    >
                      {balanceBreaks}
                    </span>
                  </li>
                </ul>
              ) : (
                <p className="text-body text-text-secondary">Loading…</p>
              )}
              <div className="mt-4 border-t border-border pt-4 flex gap-3">
                <Button onClick={runCleaning} disabled={cleaningNow || !stats}>
                  {cleaningNow ? 'Checking…' : cleanReport ? 'Re-run cleaning' : 'Run cleaning'}
                </Button>
                {stats && stats.needs_review_count > 0 && (
                  <Link to={`/cases/${selectedCase.id}/wizard`}>
                    <Button variant="secondary">
                      Review {stats.needs_review_count} rows now
                    </Button>
                  </Link>
                )}
              </div>
            </Card>

            <Card title="Analysis">
              <p className="text-body text-text-secondary">
                Round-trip detection, the money-flow graph, and the disposition breakdown appear
                here after analysis — arriving in Phase 3.
              </p>
              <div className="mt-3 flex gap-2">
                <span className="tag bg-primary-soft text-primary">
                  Round trips: {stats?.round_trips_count ?? '—'}
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </motion.div>
  )
}
