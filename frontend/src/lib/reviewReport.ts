import { api } from '../api/client'
import type { TransactionOut } from '../api/types'

/** Server page size used when pulling the full case for the report. */
const REPORT_PAGE_SIZE = 500
/** Safety cap so a 145k-row case cannot lock up the browser tab. */
const REPORT_MAX_ROWS = 20000

function reviewStatus(t: TransactionOut): string {
  if (t.excluded) return 'EXCLUDED'
  if (t.needs_review) return 'PENDING REVIEW'
  return 'REVIEWED'
}

function csvCell(value: string | null): string {
  const v = value ?? ''
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Finalised-review report: every transaction in the case with its account
 * number, timings, debit/credit and review outcome — a handoff file
 * co-workers can open in Excel and keep working from.
 */
export async function downloadReviewReportCsv(
  caseId: string,
  firNumber: string | null,
): Promise<void> {
  const rows: TransactionOut[] = []
  let offset = 0
  let total = Infinity
  while (offset < total && rows.length < REPORT_MAX_ROWS) {
    const page = await api.listTransactions(caseId, {
      offset,
      limit: REPORT_PAGE_SIZE,
    })
    rows.push(...page.items)
    total = page.total
    offset += page.items.length
    if (page.items.length === 0) break
  }

  const header = [
    'Account No.',
    'Date',
    'Time',
    'Narration',
    'Channel',
    'Reference ID',
    'Debit (INR)',
    'Credit (INR)',
    'Balance (INR)',
    'Review status',
    'Flags',
  ]
  const lines = rows.map((t) =>
    [
      csvCell(t.account_ref),
      csvCell(t.txn_date),
      csvCell(t.txn_time),
      csvCell(t.narration_raw),
      csvCell(t.channel),
      csvCell(t.reference_id),
      csvCell(t.direction === 'DEBIT' ? t.amount_inr : ''),
      csvCell(t.direction === 'CREDIT' ? t.amount_inr : ''),
      csvCell(t.balance_after),
      csvCell(reviewStatus(t)),
      csvCell(t.flags.map((f) => f.rule).join('; ')),
    ].join(','),
  )
  const truncated =
    rows.length < total ? [`"NOTE: first ${rows.length} of ${total} transactions"`] : []
  // BOM so Excel opens it as UTF-8 without an import wizard.
  const csv = '\uFEFF' + [header.join(','), ...lines, ...truncated].join('\r\n')

  const safeFir = (firNumber ?? caseId).replace(/[^A-Za-z0-9._-]+/g, '_')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `review-report-${safeFir}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
