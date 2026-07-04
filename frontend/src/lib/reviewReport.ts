import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
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

async function fetchAllTransactions(
  caseId: string,
): Promise<{ rows: TransactionOut[]; total: number }> {
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
  return { rows, total }
}

function safeFileStem(firNumber: string | null, caseId: string): string {
  return (firNumber ?? caseId).replace(/[^A-Za-z0-9._-]+/g, '_')
}

function csvCell(value: string | null): string {
  const v = value ?? ''
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Finalised-review report as PDF: case header, review tally, then every
 * transaction with account number, timings, debit/credit and review
 * outcome — a handoff document co-workers can open anywhere.
 */
export async function downloadReviewReportPdf(
  caseId: string,
  firNumber: string | null,
): Promise<void> {
  const { rows, total } = await fetchAllTransactions(caseId)

  const reviewed = rows.filter((t) => !t.needs_review && !t.excluded).length
  const pending = rows.filter((t) => t.needs_review && !t.excluded).length
  const excluded = rows.filter((t) => t.excluded).length

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('TraceNet — Transaction Review Report', 40, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Case: ${firNumber ?? caseId}`, 40, 60)
  doc.text(`Generated: ${now} IST`, 40, 74)
  doc.text(
    `Transactions: ${rows.length}${rows.length < total ? ` of ${total} (truncated)` : ''}` +
      ` — Reviewed ${reviewed} · Pending review ${pending} · Excluded ${excluded}`,
    40,
    88,
  )
  // Summary line: accounts covered, money totals, flagged rows.
  const accounts = new Set(rows.map((t) => t.account_ref)).size
  const totalDebit = rows
    .filter((t) => t.direction === 'DEBIT' && !t.excluded)
    .reduce((s, t) => s + Number(t.amount_inr), 0)
  const totalCredit = rows
    .filter((t) => t.direction === 'CREDIT' && !t.excluded)
    .reduce((s, t) => s + Number(t.amount_inr), 0)
  const flaggedRows = rows.filter((t) => t.flags.length > 0).length
  doc.text(
    `Summary: ${accounts} account${accounts === 1 ? '' : 's'} — total debits ${totalDebit.toFixed(2)} INR` +
      ` — total credits ${totalCredit.toFixed(2)} INR — flagged rows ${flaggedRows}`,
    40,
    102,
  )

  autoTable(doc, {
    startY: 116,
    head: [
      [
        'Account No.',
        'Date',
        'Time',
        'Narration',
        'Channel',
        'Reference ID',
        'Debit (INR)',
        'Credit (INR)',
        'Balance (INR)',
        'Status',
      ],
    ],
    body: rows.map((t) => [
      t.account_ref,
      t.txn_date,
      t.txn_time ?? '',
      t.narration_raw,
      t.channel,
      t.reference_id ?? '',
      t.direction === 'DEBIT' ? t.amount_inr : '',
      t.direction === 'CREDIT' ? t.amount_inr : '',
      t.balance_after ?? '',
      reviewStatus(t),
    ]),
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 22, 29], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 52 },
      2: { cellWidth: 44 },
      3: { cellWidth: 220 },
      4: { cellWidth: 48 },
      5: { cellWidth: 78 },
      6: { cellWidth: 58, halign: 'right' },
      7: { cellWidth: 58, halign: 'right' },
      8: { cellWidth: 62, halign: 'right' },
      9: { cellWidth: 62 },
    },
    didDrawPage: () => {
      const page = doc.getCurrentPageInfo().pageNumber
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(
        `TraceNet review report — ${firNumber ?? caseId} — page ${page}`,
        40,
        doc.internal.pageSize.getHeight() - 20,
      )
      doc.setTextColor(0)
    },
  })

  doc.save(`review-report-${safeFileStem(firNumber, caseId)}.pdf`)
}

/**
 * Same report as a real Excel workbook: Summary sheet + all transactions,
 * for co-workers who keep working on the rows in Excel.
 */
export async function downloadReviewReportXlsx(
  caseId: string,
  firNumber: string | null,
): Promise<void> {
  const { rows, total } = await fetchAllTransactions(caseId)
  const reviewed = rows.filter((t) => !t.needs_review && !t.excluded).length
  const pending = rows.filter((t) => t.needs_review && !t.excluded).length
  const excluded = rows.filter((t) => t.excluded).length
  const totalDebit = rows
    .filter((t) => t.direction === 'DEBIT' && !t.excluded)
    .reduce((s, t) => s + Number(t.amount_inr), 0)
  const totalCredit = rows
    .filter((t) => t.direction === 'CREDIT' && !t.excluded)
    .reduce((s, t) => s + Number(t.amount_inr), 0)

  const summaryFacts: Array<[string, string]> = [
    ['Case', firNumber ?? caseId],
    [
      'Generated',
      `${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    ],
    [
      'Transactions',
      `${rows.length}${rows.length < total ? ` of ${total} (truncated)` : ''}`,
    ],
    ['Accounts', String(new Set(rows.map((t) => t.account_ref)).size)],
    ['Reviewed', String(reviewed)],
    ['Pending review', String(pending)],
    ['Excluded', String(excluded)],
    ['Total debits (INR)', totalDebit.toFixed(2)],
    ['Total credits (INR)', totalCredit.toFixed(2)],
    ['Flagged rows', String(rows.filter((t) => t.flags.length > 0).length)],
  ]
  const txnHeader = [
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
  const txnRows = rows.map((t) => [
    t.account_ref,
    t.txn_date,
    t.txn_time ?? '',
    t.narration_raw,
    t.channel,
    t.reference_id ?? '',
    t.direction === 'DEBIT' ? Number(t.amount_inr) : '',
    t.direction === 'CREDIT' ? Number(t.amount_inr) : '',
    t.balance_after !== null ? Number(t.balance_after) : '',
    reviewStatus(t),
    t.flags.map((f) => f.rule).join('; '),
  ])

  const wb = XLSX.utils.book_new()
  // First sheet mirrors the PDF: title, summary block, then the full table —
  // opening the file shows everything the PDF shows, no tab-hunting needed.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['TraceNet — Transaction Review Report'],
      ...summaryFacts.map(([k, v]) => [k, v]),
      [],
      txnHeader,
      ...txnRows,
    ]),
    'Report',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([txnHeader, ...txnRows]),
    'Transactions',
  )
  XLSX.writeFile(wb, `review-report-${safeFileStem(firNumber, caseId)}.xlsx`)
}

/**
 * Same report as CSV, for co-workers who want to keep working on the rows
 * in Excel.
 */
export async function downloadReviewReportCsv(
  caseId: string,
  firNumber: string | null,
): Promise<void> {
  const { rows, total } = await fetchAllTransactions(caseId)

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

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `review-report-${safeFileStem(firNumber, caseId)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
