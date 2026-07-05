import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { api, exportDownloadUrl } from '../api/client'
import type { CaseOut, ExportKind, ReportVerification, Trail, TransactionOut } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DownloadChoice } from '../components/ui/DownloadChoice'
import { downloadAccountFinalReportPdf, downloadAccountFinalReportXlsx } from '../lib/accountReport'
import { downloadVisualAnalysisPdf, renderGraphPngOffscreen } from '../lib/analysisPdf'
import { downloadVisualAnalysisXlsx } from '../lib/analysisXlsx'
import { deriveRoles, ROLE_LABEL, SUSPICION_ORDER, type NodeRole } from '../lib/graphRoles'
import { fadeIn, staggerContainer } from '../theme/motion'

const DOWNLOADS: Array<{ kind: ExportKind; label: string; description: string }> = [
  {
    kind: 'report.pdf',
    label: 'Investigation report (PDF)',
    description: 'Findings, flags with evidence, round trips, legal clause mapping, hashes',
  },
  {
    kind: 'standardized.pdf',
    label: 'Standardized statements (PDF)',
    description: 'Every uploaded statement re-rendered as one uniform table',
  },
  {
    kind: 'case.xlsx',
    label: 'Full workbook (Excel)',
    description: 'Transactions, flags, round trips, trails, accounts, audit log',
  },
]

export function ReportPage() {
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const caseId = searchParams.get('case')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [visualBusy, setVisualBusy] = useState(false)
  const [visualError, setVisualError] = useState('')

  /** All three visual features in one client-side report (PDF or Excel):
   *  flow graph, round trips, and the FIFO trails of the top flagged credits. */
  async function generateVisualAnalysis(format: 'pdf' | 'excel') {
    if (!caseId) return
    setVisualBusy(true)
    setVisualError('')
    try {
      const [graph, roundTrips] = await Promise.all([
        api.getGraph(caseId),
        api.getRoundTrips(caseId).catch(() => []),
      ])
      const disposition = await api.getDisposition(caseId).catch(() => null)
      const page = await api.listTransactions(caseId, { limit: 200 })
      const credits = page.items
        .filter((t) => t.direction === 'CREDIT' && !t.excluded)
        .sort(
          (a, b) => b.flags.length - a.flags.length || Number(b.amount_inr) - Number(a.amount_inr),
        )
        .slice(0, 3)
      const trails: Array<{ credit: TransactionOut; trail: Trail }> = []
      for (const credit of credits) {
        const trail = await api.getTrail(caseId, credit.id, 'tranche').catch(() => null)
        if (trail && trail.hops.length > 0) trails.push({ credit, trail })
      }
      const caseLabel = cases?.find((c) => c.id === caseId)?.fir_number ?? caseId
      if (format === 'pdf') {
        const graphPng = await renderGraphPngOffscreen(graph)
        await downloadVisualAnalysisPdf({ caseId, caseLabel, graph, graphPng, roundTrips, trails, disposition })
      } else {
        await downloadVisualAnalysisXlsx({ caseId, caseLabel, graph, roundTrips, trails, disposition })
      }
    } catch {
      setVisualError('Could not build the visual analysis — run the case analysis first.')
    } finally {
      setVisualBusy(false)
    }
  }

  async function loadRealCases() {
    const response = await fetch('/api/cases')
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<CaseOut[]>
  }

  async function loadRealReportPreview(selectedCaseId: string) {
    const response = await fetch(`/api/cases/${selectedCaseId}/report/preview`)
    if (!response.ok) throw new Error(await response.text())
    return response.text()
  }

  useEffect(() => {
    loadRealCases().then(setCases).catch(() => setCases([]))
  }, [])

  useEffect(() => {
    if (cases && cases.length > 0 && !caseId) {
      setSearchParams({ case: cases[0].id }, { replace: true })
    }
  }, [cases, caseId, setSearchParams])

  useEffect(() => {
    if (!caseId) return
    setPreviewHtml(null)
    setPreviewFailed(false)
    loadRealReportPreview(caseId).then(setPreviewHtml).catch(() => setPreviewFailed(true))
  }, [caseId])

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Reports</h1>
          <p className="text-body text-text-secondary mt-1">
            Preview the investigation report, then download the court-ready files
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

      {cases?.length === 0 && (
        <Card className="max-w-xl">
          <p className="text-body text-text-secondary">
            No cases yet —{' '}
            <Link to="/cases" className="text-primary font-medium">
              create a case
            </Link>{' '}
            and upload statements first.
          </p>
        </Card>
      )}

      {caseId && (
        <div className="grid grid-cols-[1fr_320px] gap-6">
          <Card className="!p-0 overflow-hidden">
            {previewFailed ? (
              <div className="p-6">
                <p className="text-body text-text-secondary">
                  The report preview isn't available yet — upload statements and run the analysis
                  first, then come back here.
                </p>
              </div>
            ) : previewHtml === null ? (
              <p className="p-6 text-body text-text-secondary">Building the preview…</p>
            ) : (
              <iframe
                title="Investigation report preview"
                srcDoc={previewHtml}
                className="w-full h-[720px] bg-surface"
                sandbox=""
              />
            )}
          </Card>

          <div className="flex flex-col gap-4 h-fit">
            {DOWNLOADS.map((d) => (
              <Card key={d.kind} className="!p-4">
                <div className="text-card-title text-text-primary mb-1">{d.label}</div>
                <p className="text-label text-text-secondary mb-3">{d.description}</p>
                <a href={exportDownloadUrl(caseId, d.kind)} download>
                  <Button>Download</Button>
                </a>
              </Card>
            ))}
            <Card className="!p-4">
              <div className="text-card-title text-text-primary mb-1">
                Visual analysis
              </div>
              <p className="text-label text-text-secondary mb-3">
                Money flow graph, round-tripping steps, and the flagged credits' money trails
                layer by layer — built on this machine, nothing uploaded
              </p>
              <DownloadChoice
                label="Generate & download"
                variant="primary"
                busy={visualBusy}
                onPdf={() => generateVisualAnalysis('pdf')}
                onExcel={() => generateVisualAnalysis('excel')}
              />
              {visualError && <p className="text-label text-danger mt-2">{visualError}</p>}
            </Card>
            <AccountFinalReportCard
              caseId={caseId}
              caseLabel={cases?.find((c) => c.id === caseId)?.fir_number ?? caseId}
            />
            <VerifyReportCard />
            <p className="text-label text-text-secondary">
              Every download is recorded in the case audit log with its file size — the evidence
              chain stays intact. If the backend is reachable, the download works even when the
              frontend is running in mock mode.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/**
 * Final report for one selected account — layered charge-sheet annexure:
 * summary + checklist, suspicious transactions only, the account's money
 * flow, its round trips, money trails and the evidence chain.
 */
function AccountFinalReportCard({ caseId, caseLabel }: { caseId: string; caseLabel: string }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string; role: NodeRole }> | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAccounts(null)
    setSelected('')
    api
      .getGraph(caseId)
      .then((graph) => {
        const roles = deriveRoles(graph.nodes, graph.edges)
        const list = graph.nodes
          .map((n) => ({
            id: n.data.id,
            label: n.data.label.replace('ext:', ''),
            role: roles.get(n.data.id) ?? ('other' as NodeRole),
          }))
          .sort((a, b) => SUSPICION_ORDER[a.role] - SUSPICION_ORDER[b.role])
          .slice(0, 200)
        setAccounts(list)
        if (list.length > 0) setSelected(list[0].id)
      })
      .catch(() => setAccounts([]))
  }, [caseId])

  async function generate(format: 'pdf' | 'excel') {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const opts = { caseId, caseLabel, accountId: selected }
      if (format === 'pdf') await downloadAccountFinalReportPdf(opts)
      else await downloadAccountFinalReportXlsx(opts)
    } catch {
      setError('Could not build the report — run the case analysis first.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="!p-4">
      <div className="text-card-title text-text-primary mb-1">
        Final report — single account
      </div>
      <p className="text-label text-text-secondary mb-3">
        Charge-sheet style: summary + checklist, suspicious transactions only, the account's
        money flow, round-tripping, money trails and the evidence chain
      </p>
      {accounts === null ? (
        <p className="text-label text-text-secondary">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-label text-text-secondary">
          No analyzed accounts yet — run the analysis first.
        </p>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mb-3 w-full rounded-control border border-border bg-surface px-3 py-2 text-body"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {ROLE_LABEL[a.role] !== '—' ? `[${ROLE_LABEL[a.role]}] ` : ''}
                {a.label}
              </option>
            ))}
          </select>
          <DownloadChoice
            label="Generate final report"
            variant="primary"
            busy={busy}
            onPdf={() => void generate('pdf')}
            onExcel={() => void generate('excel')}
          />
        </>
      )}
      {error && <p className="text-label text-danger mt-2">{error}</p>}
    </Card>
  )
}

/**
 * Authenticity check: every report this system generates carries a
 * Verification ID in its footer. Enter it here — a genuine report resolves
 * to its case and signing time; an unknown ID means the document is fake.
 */
function VerifyReportCard() {
  const [verifyId, setVerifyId] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ReportVerification | null>(null)
  const [failMessage, setFailMessage] = useState('')

  async function check() {
    const token = verifyId.trim().replace(/[….\s]+$/, '')
    if (!token) return
    setChecking(true)
    setResult(null)
    setFailMessage('')
    try {
      setResult(await api.verifyReport(token))
    } catch {
      setFailMessage(
        '✕ NOT GENUINE — this verification ID is not in our records. The report was not generated by this system (or the ID was mistyped).',
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card className="!p-4">
      <div className="text-card-title text-text-primary mb-1">Verify a report</div>
      <p className="text-label text-text-secondary mb-3">
        Paste the Verification ID or the Signature from a report's footer to confirm it was
        genuinely generated by this system
      </p>
      <div className="flex gap-2">
        <input
          value={verifyId}
          onChange={(e) => setVerifyId(e.target.value)}
          placeholder="Verification ID or Signature…"
          className="flex-1 min-w-0 rounded-control border border-border bg-surface px-3 py-2 text-body"
          onKeyDown={(e) => e.key === 'Enter' && void check()}
        />
        <Button onClick={check} disabled={checking || !verifyId.trim()}>
          {checking ? '…' : 'Check'}
        </Button>
      </div>
      {result && (
        <div className="mt-3 rounded-control bg-success-soft p-3">
          <p className="text-body text-success font-medium">
            ✓ GENUINE {result.valid ? '' : '(record found, but signature mismatch — investigate)'}
          </p>
          <p className="text-label text-text-secondary mt-1">
            {result.report_type} for case {result.fir_number ?? result.case_id} · signed{' '}
            {new Date(result.signed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          </p>
        </div>
      )}
      {failMessage && (
        <p className="mt-3 rounded-control bg-danger-soft p-3 text-body text-danger">
          {failMessage}
        </p>
      )}
    </Card>
  )
}
