import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { api, exportDownloadUrl } from '../api/client'
import type { CaseOut, ExportKind, Trail, TransactionOut } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { downloadVisualAnalysisPdf, renderGraphPngOffscreen } from '../lib/analysisPdf'
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

  /** All three visual features in one client-side PDF: flow graph image,
   *  round trips, and the FIFO trails of the top flagged credits. */
  async function generateVisualAnalysis() {
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
      const graphPng = await renderGraphPngOffscreen(graph)
      downloadVisualAnalysisPdf({
        caseLabel: cases?.find((c) => c.id === caseId)?.fir_number ?? caseId,
        graph,
        graphPng,
        roundTrips,
        trails,
        disposition,
      })
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
                Visual analysis (PDF)
              </div>
              <p className="text-label text-text-secondary mb-3">
                Money flow graph, round-tripping steps, and the flagged credits' money trails
                layer by layer — built on this machine, nothing uploaded
              </p>
              <Button onClick={generateVisualAnalysis} disabled={visualBusy}>
                {visualBusy ? 'Building…' : 'Generate & download'}
              </Button>
              {visualError && <p className="text-label text-danger mt-2">{visualError}</p>}
            </Card>
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
