/**
 * Typed API client — the only sanctioned way pages talk to the server.
 * Shapes match backend/openapi.json (Person A's contract).
 *
 * Real backend by default; set VITE_API_MODE=mock (.env.local)
 * to use the offline mock adapter instead.
 */
import type {
  AnalysisSummary,
  BankTemplateIn,
  BankTemplateOut,
  CaseCreate,
  CaseGraph,
  CaseOut,
  CaseStats,
  CleanReport,
  ColumnTemplate,
  CommonIdentifier,
  Disposition,
  DocumentColumns,
  DocumentOut,
  ExportKind,
  JobOut,
  Page,
  RoundTrip,
  Trail,
  TrailStopRule,
  TransactionOut,
  TransactionReview,
  UploadOut,
} from './types'
import { ApiError } from './errors'
import { mockAdapter } from './mocks/mockAdapter'

const API_MODE = String(import.meta.env.VITE_API_MODE ?? 'real').toLowerCase()
const USE_REAL_API = API_MODE !== 'mock'
const API_BASE = '/api'

/** True when running against mocks — pages disable server-only features (file downloads). */
export const IS_MOCK_MODE = !USE_REAL_API

/** Browser-navigable download URL (Content-Disposition attachment on the server). */
export function exportDownloadUrl(caseId: string, kind: ExportKind): string {
  return `${API_BASE}/cases/${caseId}/export/${kind}`
}

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

  /* Person A reconciled these to real endpoints (2026-07-02, commit c354dc8). */
  getCaseStats: (caseId: string) => request<CaseStats>(`/cases/${caseId}/stats`),
  getDocumentColumns: (documentId: string) =>
    request<DocumentColumns>(`/documents/${documentId}/columns`),
  saveColumnTemplate: (doc: DocumentColumns, template: ColumnTemplate): Promise<JobOut | null> =>
    request<JobOut>(`/documents/${doc.document_id}/template`, {
      method: 'POST',
      body: JSON.stringify(template),
    }),

  /* Phase-3 analysis endpoints */
  analyzeCase: (caseId: string) =>
    request<AnalysisSummary>(`/cases/${caseId}/analyze`, { method: 'POST' }),
  getGraph: (caseId: string) => request<CaseGraph>(`/cases/${caseId}/graph`),
  getRoundTrips: (caseId: string) => request<RoundTrip[]>(`/cases/${caseId}/round-trips`),
  getCorrelation: (caseId: string) =>
    request<CommonIdentifier[]>(`/cases/${caseId}/correlation`),
  getDisposition: (caseId: string, accountRef?: string) =>
    request<Disposition>(
      `/cases/${caseId}/disposition${accountRef ? `?account_ref=${encodeURIComponent(accountRef)}` : ''}`,
    ),
  getTrail: (caseId: string, txnId: string, stopRule: TrailStopRule = 'tranche') =>
    request<Trail>(`/cases/${caseId}/trail/${txnId}?stop_rule=${stopRule}`),

  /* Phase-4: investigation report preview (same template as the PDF). */
  getReportPreviewHtml: async (caseId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/cases/${caseId}/report/preview`)
    if (!response.ok) throw new ApiError(response.status, await response.text())
    return response.text()
  },
}

export const api = USE_REAL_API ? realAdapter : mockAdapter
export { ApiError }
