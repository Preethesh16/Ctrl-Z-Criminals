/**
 * In-memory mock adapter — standing rule from CLAUDE.md: Person B codes
 * against this until Person A's real API lands, then flips VITE_API_MODE.
 *
 * Simulates upload → job polling → parsed transactions, including the
 * failure states the UI must handle (password-protected PDF, unsupported
 * format, duplicate file). All data is synthetic — never derived from the
 * confidential Bank-statements-dataset.
 */
import type {
  Case,
  CaseCreate,
  Channel,
  Job,
  Transaction,
  UploadResult,
} from '../types'

const SUPPORTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'tsv', 'docx', 'jpg', 'jpeg', 'png']

const cases = new Map<string, Case>()
const jobs = new Map<string, Job>()
const transactionsByCase = new Map<string, Transaction[]>()
const uploadedFileKeysByCase = new Map<string, Set<string>>()

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

const NARRATIONS: Array<{ template: string; channel: Channel }> = [
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

function generateTransactions(caseId: string, documentId: string, seed: string): Transaction[] {
  const rand = seededRandom(seed)
  const count = 40 + Math.floor(rand() * 160)
  const rows: Transaction[] = []
  let balancePaise = 50_00_000_00 + Math.floor(rand() * 100_00_000_00) // ₹50L–₹150L opening
  const start = new Date('2026-01-05T00:00:00Z').getTime()
  let t = start
  for (let i = 0; i < count; i++) {
    t += Math.floor(rand() * 36 * 3600 * 1000)
    const pick = NARRATIONS[Math.floor(rand() * NARRATIONS.length)]
    const ref = String(100000000000 + Math.floor(rand() * 899999999999))
    const isCredit = rand() < 0.4
    const amountPaise = (1 + Math.floor(rand() * 500)) * 1000_00 // ₹1k–₹5L in ₹1k steps
    balancePaise += isCredit ? amountPaise : -amountPaise
    const digital = rand() < 0.85
    rows.push({
      id: nextId('txn'),
      case_id: caseId,
      source_document_id: documentId,
      txn_date: new Date(t).toISOString(),
      narration: pick.template.replace('{ref}', ref),
      reference_id: pick.channel === 'CASH' ? null : ref,
      channel: pick.channel,
      debit_paise: isCredit ? null : amountPaise,
      credit_paise: isCredit ? amountPaise : null,
      balance_paise: balancePaise,
      extraction_confidence: digital ? 1.0 : 0.55 + rand() * 0.44,
    })
  }
  return rows
}

function seedDemoCase(): void {
  const id = nextId('case')
  const demo: Case = {
    id,
    fir_number: 'CEN/0042/2026',
    complainant: 'Demo Complainant (synthetic)',
    fraud_amount_paise: 5_00_000_00,
    incident_date: '2026-06-12',
    status: 'review',
    created_at: '2026-06-28T09:30:00Z',
    documents_count: 2,
    transactions_count: 0,
    flagged_count: 0,
  }
  const docId = nextId('doc')
  const txns = generateTransactions(id, docId, 'demo-seed')
  transactionsByCase.set(id, txns)
  demo.transactions_count = txns.length
  cases.set(id, demo)
}
seedDemoCase()

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const mockAdapter = {
  async listCases(): Promise<Case[]> {
    await delay(200)
    return [...cases.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async createCase(input: CaseCreate): Promise<Case> {
    await delay(250)
    const created: Case = {
      id: nextId('case'),
      ...input,
      status: 'draft',
      created_at: new Date().toISOString(),
      documents_count: 0,
      transactions_count: 0,
      flagged_count: 0,
    }
    cases.set(created.id, created)
    return created
  },

  async getCase(caseId: string): Promise<Case> {
    await delay(150)
    const found = cases.get(caseId)
    if (!found) throw new Error(`Case ${caseId} not found`)
    return found
  },

  async uploadDocument(caseId: string, file: File): Promise<UploadResult> {
    await delay(300 + Math.random() * 400)
    const documentId = nextId('doc')
    const jobId = nextId('job')
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const fileKey = `${file.name}:${file.size}`
    const seenKeys = uploadedFileKeysByCase.get(caseId) ?? new Set<string>()

    const job: Job = {
      id: jobId,
      document_id: documentId,
      status: 'queued',
      progress: 0,
      transactions_found: null,
      error_code: null,
      error_message: null,
    }

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      job.status = 'failed'
      job.error_code = 'UNSUPPORTED_FORMAT'
      job.error_message = `.${ext} files are not supported`
    } else if (seenKeys.has(fileKey)) {
      job.status = 'failed'
      job.error_code = 'DUPLICATE_FILE'
      job.error_message = 'Identical file already uploaded to this case (same SHA-256)'
    } else if (/protected|locked|password/i.test(file.name)) {
      // Mock trigger for the password-protected flow: name the file accordingly.
      job.status = 'failed'
      job.error_code = 'PASSWORD_PROTECTED'
      job.error_message = 'PDF is password-protected'
    } else {
      seenKeys.add(fileKey)
      uploadedFileKeysByCase.set(caseId, seenKeys)
      // Progress advances on each poll; completion generates transactions.
      ;(job as Job & { _caseId?: string; _seed?: string })._caseId = caseId
      ;(job as Job & { _seed?: string })._seed = fileKey
    }

    jobs.set(jobId, job)
    return {
      document_id: documentId,
      job_id: jobId,
      filename: file.name,
      sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
    }
  },

  async getJob(jobId: string): Promise<Job> {
    await delay(120)
    const job = jobs.get(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)
    if (job.status === 'queued') {
      job.status = 'running'
      job.progress = 0.1
    } else if (job.status === 'running') {
      job.progress = Math.min(1, job.progress + 0.15 + Math.random() * 0.2)
      if (job.progress >= 1) {
        const meta = job as Job & { _caseId?: string; _seed?: string }
        const caseId = meta._caseId
        if (caseId) {
          const documentTxns = generateTransactions(caseId, job.document_id, meta._seed ?? job.id)
          const existing = transactionsByCase.get(caseId) ?? []
          transactionsByCase.set(caseId, [...existing, ...documentTxns])
          const parent = cases.get(caseId)
          if (parent) {
            parent.documents_count += 1
            parent.transactions_count += documentTxns.length
            parent.status = 'ingesting'
          }
          job.transactions_found = documentTxns.length
        }
        job.status = 'done'
      }
    }
    return { ...job }
  },

  async listTransactions(caseId: string): Promise<Transaction[]> {
    await delay(250)
    return [...(transactionsByCase.get(caseId) ?? [])].sort((a, b) =>
      a.txn_date.localeCompare(b.txn_date),
    )
  },
}
