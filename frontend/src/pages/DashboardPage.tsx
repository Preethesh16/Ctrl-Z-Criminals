import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { Cell, Pie, PieChart, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type {
  CaseOut,
  CaseStats,
  CleanReport,
  CommonIdentifier,
  Disposition,
  TransactionOut,
} from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { GoldenHourBoard } from '../components/GoldenHourBoard'
import { formatINR } from '../lib/format'
import { fadeIn, staggerContainer } from '../theme/motion'

const BUCKET_META: Array<{ key: keyof Disposition['buckets']; label: string; color: string }> = [
  { key: 'cash', label: 'Cash withdrawn', color: '#f5a623' },
  { key: 'cheque', label: 'Cheque', color: '#8b7cf6' },
  { key: 'redirected', label: 'Sent to other accounts', color: '#e5484d' },
  { key: 'merchant', label: 'Shops / merchants', color: '#2fc5a0' },
  { key: 'internal', label: 'Internal', color: '#2f6fed' },
  { key: 'unclassified', label: 'Unclassified', color: '#6b7280' },
]

export function DashboardPage() {
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [stats, setStats] = useState<CaseStats | null>(null)
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null)
  const [disposition, setDisposition] = useState<Disposition | null>(null)
  const [identifiers, setIdentifiers] = useState<CommonIdentifier[]>([])
  const [flaggedByDate, setFlaggedByDate] = useState<Array<{ date: string; count: number }>>([])
  const [analyzed, setAnalyzed] = useState(false)
  const [working, setWorking] = useState<'clean' | 'analyze' | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCaseId = searchParams.get('case')

  useEffect(() => {
    api.listCases().then(setCases).catch(() => setCases([]))
  }, [])

  useEffect(() => {
    if (cases && cases.length > 0 && !selectedCaseId) {
      setSearchParams({ case: cases[0].id }, { replace: true })
    }
  }, [cases, selectedCaseId, setSearchParams])

  const loadArtifacts = useCallback((caseId: string) => {
    api.getCaseStats(caseId).then(setStats).catch(() => {})
    api
      .getDisposition(caseId)
      .then((d) => {
        setDisposition(d)
        setAnalyzed(true)
      })
      .catch(() => setAnalyzed(false))
    api.getCorrelation(caseId).then(setIdentifiers).catch(() => setIdentifiers([]))
    api
      .listTransactions(caseId, { limit: 200 })
      .then((page) => setFlaggedByDate(groupFlaggedByDate(page.items)))
      .catch(() => setFlaggedByDate([]))
  }, [])

  useEffect(() => {
    if (!selectedCaseId) return
    setStats(null)
    setDisposition(null)
    setCleanReport(null)
    setIdentifiers([])
    setAnalyzed(false)
    loadArtifacts(selectedCaseId)
  }, [selectedCaseId, loadArtifacts])

  const selectedCase = cases?.find((c) => c.id === selectedCaseId) ?? null

  async function runCleaning() {
    if (!selectedCaseId) return
    setWorking('clean')
    try {
      setCleanReport(await api.cleanCase(selectedCaseId))
      loadArtifacts(selectedCaseId)
    } finally {
      setWorking(null)
    }
  }

  async function runAnalysis() {
    if (!selectedCaseId) return
    setWorking('analyze')
    try {
      const summary = await api.analyzeCase(selectedCaseId)
      setCleanReport(summary.cleaning)
      loadArtifacts(selectedCaseId)
    } finally {
      setWorking(null)
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
        <div className="flex items-center gap-3">
          {cases && cases.length > 1 && (
            <select
              value={selectedCaseId ?? ''}
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
          {selectedCase && (
            <Button onClick={runAnalysis} disabled={working !== null}>
              {working === 'analyze' ? 'Analyzing…' : analyzed ? 'Re-run analysis' : 'Analyze case'}
            </Button>
          )}
        </div>
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
            <StatCard
              label="Round trips found"
              value={stats?.round_trips_count ?? '…'}
              tone={stats && stats.round_trips_count > 0 ? 'danger' : 'default'}
            />
          </div>

          {!analyzed && (
            <Card className="mb-6 max-w-2xl">
              <p className="text-body text-text-primary mb-1 font-medium">
                Ready when you are.
              </p>
              <p className="text-body text-text-secondary">
                Press <span className="font-medium text-text-primary">Analyze case</span> (top
                right) to search for round trips, trace the money flow, and break down where the
                funds went. Everything below fills in automatically.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-6 mb-6">
            <Card title="Where did the money go?">
              {disposition ? (
                <DispositionDonut disposition={disposition} />
              ) : (
                <p className="text-body text-text-secondary">Run the analysis to see the split.</p>
              )}
            </Card>

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
                <Button variant="secondary" onClick={runCleaning} disabled={working !== null}>
                  {working === 'clean' ? 'Checking…' : 'Run cleaning only'}
                </Button>
                {stats && stats.needs_review_count > 0 && (
                  <Link to={`/cases/${selectedCase.id}/wizard`}>
                    <Button variant="secondary">Review {stats.needs_review_count} rows</Button>
                  </Link>
                )}
              </div>
            </Card>
          </div>

          {analyzed && (
            <div className="mb-6">
              <GoldenHourBoard key={`${selectedCase.id}-${analyzed}`} caseId={selectedCase.id} caseData={selectedCase} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            <Card title="Flagged activity over time">
              {flaggedByDate.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={flaggedByDate}>
                    <XAxis dataKey="date" fontSize={11} tickLine={false} />
                    <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={28} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#e5484d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-body text-text-secondary">
                  {analyzed ? 'No flagged activity.' : 'Run the analysis to see the timeline.'}
                </p>
              )}
            </Card>

            <Card title="Common suspicious identifiers">
              {identifiers.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {identifiers.map((id) => (
                    <li key={id.identifier} className="border-b border-border last:border-0 pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-body font-medium text-text-primary break-all">
                          {id.identifier}
                        </span>
                        <span className="tag bg-danger-soft text-danger shrink-0">
                          {id.seen_in_accounts.length} statements
                        </span>
                      </div>
                      <p className="text-label text-text-secondary">
                        {id.names.join(', ') || 'Name unknown'} · {id.txn_count} transactions ·
                        receives from {id.distinct_senders} different accounts
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-text-secondary">
                  {analyzed
                    ? 'No identifier appears across multiple statements.'
                    : 'Run the analysis to surface UPI IDs / accounts seen across statements.'}
                </p>
              )}
            </Card>
          </div>
        </>
      )}
    </motion.div>
  )
}

function groupFlaggedByDate(txns: TransactionOut[]): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>()
  for (const t of txns) {
    if (t.flags.length === 0 || t.excluded) continue
    counts.set(t.txn_date, (counts.get(t.txn_date) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date: date.slice(5), count }))
}

function DispositionDonut({ disposition }: { disposition: Disposition }) {
  const data = BUCKET_META.map((m) => ({
    name: m.label,
    value: Number(disposition.buckets[m.key]?.amount ?? 0),
    pct: disposition.buckets[m.key]?.pct ?? 0,
    color: m.color,
  })).filter((d) => d.value > 0)

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={55} outerRadius={90} strokeWidth={1}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => formatINR(String(value))} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex flex-col gap-1 text-body">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-pill" style={{ background: d.color }} />
            <span className="text-text-primary">{d.name}</span>
            <span className="text-text-secondary tabular-nums">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
