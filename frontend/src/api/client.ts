/**
 * Typed API client — the only sanctioned way pages talk to the server.
 * Shapes match backend/openapi.json (Person A's contract).
 *
 * Mocks by default for offline dev; set VITE_API_MODE=real (.env.local)
 * to hit the FastAPI backend proxied at /api (see vite.config.ts).
 */
import type {
  CaseCreate,
  CaseOut,
  CaseStats,
  ColumnTemplate,
  DocumentColumns,
  DocumentOut,
  JobOut,
  Page,
  ReviewAction,
  TransactionOut,
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
    return request<JobOut>(`/cases/${caseId}/documents`, { method: 'POST', body: form })
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

  /* Phase-2 provisional endpoints — paths are Person B's proposal until
   * Person A publishes the review/cleaning/template contract. */
  reviewTransaction: (txnId: string, action: ReviewAction) =>
    request<TransactionOut>(`/transactions/${txnId}/review`, {
      method: 'POST',
      body: JSON.stringify(action),
    }),
  getCaseStats: (caseId: string) => request<CaseStats>(`/cases/${caseId}/stats`),
  getDocumentColumns: (documentId: string) =>
    request<DocumentColumns>(`/documents/${documentId}/columns`),
  saveColumnTemplate: (documentId: string, template: ColumnTemplate) =>
    request<JobOut>(`/documents/${documentId}/template`, {
      method: 'POST',
      body: JSON.stringify(template),
    }),
}

export const api = USE_REAL_API ? realAdapter : mockAdapter
export { ApiError }
