/**
 * Typed API client — the only sanctioned way pages talk to the server.
 * Shapes match backend/openapi.json (Person A's contract).
 *
 * Mocks by default for offline dev; set VITE_API_MODE=real (.env.local)
 * to hit the FastAPI backend proxied at /api (see vite.config.ts).
 */
import type {
  BankTemplateIn,
  BankTemplateOut,
  CaseCreate,
  CaseOut,
  CaseStats,
  CleanReport,
  ColumnTemplate,
  DocumentColumns,
  DocumentOut,
  JobOut,
  Page,
  TransactionOut,
  TransactionReview,
  UploadOut,
} from './types'
import { ApiError } from './errors'
import { mockAdapter } from './mocks/mockAdapter'

const USE_REAL_API = import.meta.env.VITE_API_MODE === 'real'
const API_BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

export interface TransactionQuery {
  offset?: number
  limit?: number
  needs_review?: boolean
}

const realAdapter = {
  listCases: () => request<CaseOut[]>('/cases'),
  createCase: (input: CaseCreate) =>
    request<CaseOut>('/cases', { method: 'POST', body: JSON.stringify(input) }),
  getCase: (caseId: string) => request<CaseOut>(`/cases/${caseId}`),
  uploadDocument: (caseId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadOut>(`/cases/${caseId}/documents`, { method: 'POST', body: form })
  },
  getJob: (jobId: string) => request<JobOut>(`/jobs/${jobId}`),
  listDocuments: (caseId: string) => request<DocumentOut[]>(`/cases/${caseId}/documents`),
  listTransactions: (caseId: string, query: TransactionQuery = {}) => {
    const params = new URLSearchParams()
    if (query.offset !== undefined) params.set('offset', String(query.offset))
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.needs_review !== undefined) params.set('needs_review', String(query.needs_review))
    const qs = params.toString()
    return request<Page<TransactionOut>>(`/cases/${caseId}/transactions${qs ? `?${qs}` : ''}`)
  },

  /* Phase-2 endpoints (real contract, reconciled 2026-07-02) */
  reviewTransaction: (txnId: string, review: TransactionReview) =>
    request<TransactionOut>(`/transactions/${txnId}/review`, {
      method: 'POST',
      body: JSON.stringify(review),
    }),
  cleanCase: (caseId: string) =>
    request<CleanReport>(`/cases/${caseId}/clean`, { method: 'POST' }),
  listTemplates: () => request<BankTemplateOut[]>('/templates'),
  saveTemplate: (template: BankTemplateIn) =>
    request<BankTemplateOut>('/templates', { method: 'POST', body: JSON.stringify(template) }),

  /** No single backend endpoint — composed from documents + transaction queries. */
  getCaseStats: async (caseId: string): Promise<CaseStats> => {
    const [docs, all, review] = await Promise.all([
      realAdapter.listDocuments(caseId),
      realAdapter.listTransactions(caseId, { limit: 1 }),
      realAdapter.listTransactions(caseId, { limit: 1, needs_review: true }),
    ])
    const accounts = new Set(docs.map((d) => d.account_number).filter(Boolean))
    return {
      case_id: caseId,
      documents_count: docs.length,
      transactions_count: all.total,
      needs_review_count: review.total,
      flagged_count: 0, // per-rule flag counts arrive with the Phase-3 flags API
      accounts_count: accounts.size,
      round_trips_count: 0, // Phase 3
      cleaning: { duplicates_flagged: 0, reversals_detected: 0, balance_breaks: 0 }, // via cleanCase()
    }
  },

  /** PROVISIONAL, mock-only: no backend source of raw columns yet. */
  getDocumentColumns: (documentId: string): Promise<DocumentColumns> => {
    void documentId
    return Promise.reject(
      new ApiError(501, 'raw-column preview is not available from the server yet'),
    )
  },

  /** Real mode saves a reusable bank template; re-parse of the failed file isn't
   * server-triggerable yet, so this returns null (the UI asks for a re-upload). */
  saveColumnTemplate: async (
    doc: DocumentColumns,
    template: ColumnTemplate,
  ): Promise<JobOut | null> => {
    const headerSignature = doc.columns.map((c) => c.header.trim().toLowerCase()).join('|')
    const mapping: Record<string, string> = {}
    for (const [index, field] of Object.entries(template.mapping)) {
      const header = doc.columns.find((c) => c.index === Number(index))?.header
      if (header && field !== 'ignore') mapping[header] = field
    }
    await realAdapter.saveTemplate({
      name: template.bank_name,
      bank: template.bank_name,
      header_signature: headerSignature,
      mapping,
    })
    return null
  },
}

export const api = USE_REAL_API ? realAdapter : mockAdapter
export { ApiError }
