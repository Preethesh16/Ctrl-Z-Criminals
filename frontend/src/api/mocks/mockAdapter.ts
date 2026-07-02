/**
 * In-memory mock adapter, contract-shaped (backend/openapi.json parity):
 * upload returns JobOut, duplicates throw 409, job progress is 0–100 with
 * "N transactions" in detail, transactions come back paginated.
 *
 * All data is synthetic — never derived from the confidential dataset.
 */
import type {
  CaseCreate,
  CaseOut,
  CaseStats,
  ColumnTemplate,
  Direction,
  DocumentColumns,
  DocumentOut,
  JobOut,
  Page,
  ReviewAction,
  TransactionOut,
} from '../types'
import type { TransactionQuery } from '../client'
import { ApiError } from '../errors'

const SUPPORTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'tsv', 'docx', 'jpg', 'jpeg', 'png', 'txt']

const cases = new Map<string, CaseOut>()
const documents = new Map<string, DocumentOut>()
const jobs = new Map<string, JobOut & { _fileKey?: string }>()
const transactionsByCase = new Map<string, TransactionOut[]>()
const fileKeysByCase = new Map<string, Set<string>>()

let idCounter = 0
const nextId = (prefix: string) => `${prefix}_${++idCounter}`

/** Deterministic pseudo-random from a string seed (stable mock data across polls). */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

const NARRATIONS: Array<{ template: string; channel: string }> = [
  { template: 'UPI/CR/{ref}/ramesh.kumar@okhdfc/HDFC/payment', channel: 'UPI' },
  { template: 'UPI/DR/{ref}/quickmart.store@ybl/YESB/purchase', channel: 'UPI' },
  { template: 'NEFT-{ref}-SURESH TRADERS-TRANSFER', channel: 'NEFT' },
  { template: 'IMPS/P2A/{ref}/anita.sharma/AXIS', channel: 'IMPS' },
  { template: 'RTGS/{ref}/GLOBAL EXPORTS PVT LTD', channel: 'RTGS' },
  { template: 'ATM-CASH-WDL/{ref}/MG ROAD BLR', channel: 'ATM' },
  { template: 'CHQ PAID {ref} SELF', channel: 'CHEQUE' },
  { template: 'POS {ref} RELIANCE SMART BLR', channel: 'POS' },
  { template: 'CASH DEPOSIT BRANCH KORAMANGALA', channel: 'CASH' },
]

function generateTransactions(documentId: string, seed: string): TransactionOut[] {
  const rand = seededRandom(seed)
  const count = 40 + Math.floor(rand() * 160)
  const rows: TransactionOut[] = []
  let balance = 5_00_000 + Math.floor(rand() * 95_00_000) // ₹5L–₹1Cr opening
  const start = new Date('2026-01-05T00:00:00Z').getTime()
  let t = start
  for (let i = 0; i < count; i++) {
    t += Math.floor(rand() * 36 * 3600 * 1000)
    const pick = NARRATIONS[Math.floor(rand() * NARRATIONS.length)]
    const ref = String(100000000000 + Math.floor(rand() * 899999999999))
    const direction: Direction = rand() < 0.4 ? 'CREDIT' : 'DEBIT'
    const amount = (1 + Math.floor(rand() * 500)) * 1000 // ₹1k–₹5L
    balance += direction === 'CREDIT' ? amount : -amount
    const confidence = rand() < 0.85 ? 1.0 : 0.55 + rand() * 0.44
    // Sprinkle a few suspected duplicates so the review queue has both kinds of work.
    const flags = rand() < 0.04 ? ['SUSPECTED_DUPLICATE'] : []
    const date = new Date(t)
    rows.push({
      id: nextId('txn'),
      document_id: documentId,
      account_ref: 'XXXX1234',
      row_index: i,
      txn_date: date.toISOString().slice(0, 10),
      txn_time: date.toISOString().slice(11, 19),
      amount_inr: `${amount}.00`,
      direction,
      balance_after: `${balance}.00`,
      channel: pick.channel,
      narration_raw: pick.template.replace('{ref}', ref),
      reference_id: pick.channel === 'CASH' ? null : ref,
      counterparty_id: pick.channel === 'UPI' ? pick.template.split('/')[3] : null,
      counterparty_name: null,
      flags,
      extraction_confidence: confidence,
      needs_review: confidence < 0.7 || flags.length > 0,
      excluded: false,
    })
  }
  return rows
}

function seedDemoCase(): void {
  const id = nextId('case')
  cases.set(id, {
    id,
    fir_number: 'CEN/0042/2026',
    complainant: 'Demo Complainant (synthetic)',
    fraud_amount: '500000.00',
    complaint_date: '2026-06-12',
    created_at: '2026-06-28T09:30:00Z',
  })
  const docId = nextId('doc')
  transactionsByCase.set(id, generateTransactions(docId, 'demo-seed'))
}
seedDemoCase()

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const mockAdapter = {
  async listCases(): Promise<CaseOut[]> {
    await delay(200)
    return [...cases.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async createCase(input: CaseCreate): Promise<CaseOut> {
    await delay(250)
    const created: CaseOut = {
      id: nextId('case'),
      fir_number: input.fir_number,
      complainant: input.complainant ?? null,
      fraud_amount: input.fraud_amount ?? null,
      complaint_date: input.complaint_date ?? null,
      created_at: new Date().toISOString(),
    }
    cases.set(created.id, created)
    return created
  },

  async getCase(caseId: string): Promise<CaseOut> {
    await delay(150)
    const found = cases.get(caseId)
    if (!found) throw new ApiError(404, 'case not found')
    return found
  },

  async uploadDocument(caseId: string, file: File): Promise<JobOut> {
    await delay(300 + Math.random() * 400)
    if (!cases.has(caseId)) throw new ApiError(404, 'case not found')

    const fileKey = `${file.name}:${file.size}`
    const seen = fileKeysByCase.get(caseId) ?? new Set<string>()
    if (seen.has(fileKey)) {
      throw new ApiError(409, `identical file already uploaded: ${file.name}`)
    }

    const documentId = nextId('doc')
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const job: JobOut & { _fileKey?: string } = {
      id: nextId('job'),
      case_id: caseId,
      kind: 'parse',
      status: 'pending',
      progress: 0,
      detail: null,
      _fileKey: fileKey,
    }

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      job.status = 'failed'
      job.detail = `unsupported file type: .${ext}`
    } else if (/protected|locked|password/i.test(file.name)) {
      // Mock trigger for the password-protected flow: name the file accordingly.
      job.status = 'failed'
      job.detail = 'PDF is password-protected'
    } else if (/unmapped|unknown/i.test(file.name)) {
      // Mock trigger for the column-mapping flow: unrecognized statement layout.
      job.status = 'failed'
      job.detail = `unrecognized layout:${documentId}`
      seen.add(fileKey)
      fileKeysByCase.set(caseId, seen)
      documents.set(documentId, {
        id: documentId,
        case_id: caseId,
        filename: file.name,
        sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
        file_kind: ext,
        status: 'failed',
        error: 'unrecognized layout',
        account_number: null,
        account_holder: null,
        bank_name: null,
        period_from: null,
        period_to: null,
        txn_count: 0,
      })
    } else {
      seen.add(fileKey)
      fileKeysByCase.set(caseId, seen)
      documents.set(documentId, {
        id: documentId,
        case_id: caseId,
        filename: file.name,
        sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
        file_kind: ext === 'pdf' ? 'pdf_digital' : ext,
        status: 'parsing',
        error: null,
        account_number: 'XXXX1234',
        account_holder: null,
        bank_name: null,
        period_from: null,
        period_to: null,
        txn_count: 0,
      })
      ;(job as JobOut & { _docId?: string })._docId = documentId
    }

    jobs.set(job.id, job)
    return { ...job }
  },

  async getJob(jobId: string): Promise<JobOut> {
    await delay(120)
    const job = jobs.get(jobId)
    if (!job) throw new ApiError(404, 'job not found')
    if (job.status === 'pending') {
      job.status = 'running'
      job.progress = 10
    } else if (job.status === 'running') {
      job.progress = Math.min(100, job.progress + 15 + Math.floor(Math.random() * 20))
      if (job.progress >= 100) {
        const meta = job as JobOut & { _fileKey?: string; _docId?: string }
        const docId = meta._docId ?? nextId('doc')
        const txns = generateTransactions(docId, meta._fileKey ?? job.id)
        const existing = transactionsByCase.get(job.case_id) ?? []
        transactionsByCase.set(job.case_id, [...existing, ...txns])
        const doc = documents.get(docId)
        if (doc) {
          doc.status = 'parsed'
          doc.txn_count = txns.length
        }
        job.status = 'done'
        job.detail = `${txns.length} transactions`
      }
    }
    return { ...job }
  },

  async listDocuments(caseId: string): Promise<DocumentOut[]> {
    await delay(150)
    return [...documents.values()].filter((d) => d.case_id === caseId)
  },

  async listTransactions(
    caseId: string,
    query: TransactionQuery = {},
  ): Promise<Page<TransactionOut>> {
    await delay(250)
    const offset = query.offset ?? 0
    const limit = query.limit ?? 100
    let all = [...(transactionsByCase.get(caseId) ?? [])].sort((a, b) =>
      a.txn_date.localeCompare(b.txn_date),
    )
    if (query.needs_review !== undefined) {
      all = all.filter((t) => t.needs_review === query.needs_review)
    }
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit }
  },

  /* ---------------- Phase-2 provisional endpoints ---------------- */

  async reviewTransaction(txnId: string, action: ReviewAction): Promise<TransactionOut> {
    await delay(180)
    for (const txns of transactionsByCase.values()) {
      const txn = txns.find((t) => t.id === txnId)
      if (!txn) continue
      if (action.action === 'exclude') {
        txn.excluded = true
        txn.needs_review = false
      } else if (action.action === 'confirm') {
        txn.needs_review = false
        txn.flags = txn.flags.filter((f) => f !== 'SUSPECTED_DUPLICATE')
      } else {
        Object.assign(txn, action.corrections)
        txn.extraction_confidence = 1.0
        txn.needs_review = false
      }
      return { ...txn }
    }
    throw new ApiError(404, 'transaction not found')
  },

  async getCaseStats(caseId: string): Promise<CaseStats> {
    await delay(200)
    if (!cases.has(caseId)) throw new ApiError(404, 'case not found')
    const txns = transactionsByCase.get(caseId) ?? []
    const docs = [...documents.values()].filter((d) => d.case_id === caseId)
    const rand = seededRandom(`stats-${caseId}`)
    return {
      case_id: caseId,
      documents_count: docs.length,
      transactions_count: txns.length,
      needs_review_count: txns.filter((t) => t.needs_review && !t.excluded).length,
      flagged_count: txns.filter((t) => t.flags.length > 0).length,
      accounts_count: 2 + Math.floor(rand() * 6),
      round_trips_count: 0, // detection engine lands in Phase 3
      cleaning: {
        duplicates_flagged: txns.filter((t) => t.flags.includes('SUSPECTED_DUPLICATE')).length,
        reversals_detected: Math.floor(rand() * 3),
        balance_breaks: Math.floor(rand() * 2),
      },
    }
  },

  async getDocumentColumns(documentId: string): Promise<DocumentColumns> {
    await delay(200)
    const doc = documents.get(documentId)
    if (!doc) throw new ApiError(404, 'document not found')
    // A plausible unrecognized bank layout for the mapping demo.
    return {
      document_id: documentId,
      filename: doc.filename,
      bank_hint: 'Sample Co-op Bank',
      columns: [
        { index: 0, header: 'TXN DT', samples: ['03/01/2026', '05/01/2026', '09/01/2026'] },
        {
          index: 1,
          header: 'PARTICULARS',
          samples: ['UPI/CR/600123456789/ramesh', 'NEFT-N012026-SURESH TRADERS', 'ATM WDL MG ROAD'],
        },
        { index: 2, header: 'CHQ/REF', samples: ['600123456789', 'N012026', ''] },
        { index: 3, header: 'WITHDRAWAL AMT', samples: ['', '25,000.00', '10,000.00'] },
        { index: 4, header: 'DEPOSIT AMT', samples: ['1,00,000.00', '', ''] },
        { index: 5, header: 'BAL', samples: ['1,25,000.00 Cr', '1,00,000.00 Cr', '90,000.00 Cr'] },
      ],
    }
  },

  async saveColumnTemplate(documentId: string, template: ColumnTemplate): Promise<JobOut> {
    await delay(300)
    const doc = documents.get(documentId)
    if (!doc) throw new ApiError(404, 'document not found')
    void template // stored server-side in the real API
    doc.status = 'parsing'
    doc.error = null
    const job: JobOut & { _fileKey?: string; _docId?: string } = {
      id: nextId('job'),
      case_id: doc.case_id,
      kind: 'parse',
      status: 'pending',
      progress: 0,
      detail: null,
      _fileKey: `remap:${doc.sha256}`,
      _docId: documentId,
    }
    jobs.set(job.id, job)
    return { ...job }
  },
}
