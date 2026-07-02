/**
 * Typed API client — the only sanctioned way pages talk to the server.
 *
 * Mode switch: mocks by default until Person A's Phase-1 API + OpenAPI
 * contract land; set VITE_API_MODE=real (e.g. in .env.local) to hit the
 * FastAPI backend proxied at /api (see vite.config.ts).
 */
import type { Case, CaseCreate, Job, Transaction, UploadResult } from './types'
import { mockAdapter } from './mocks/mockAdapter'

const USE_REAL_API = import.meta.env.VITE_API_MODE === 'real'
const API_BASE = '/api'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

const realAdapter = {
  listCases: () => request<Case[]>('/cases'),
  createCase: (input: CaseCreate) =>
    request<Case>('/cases', { method: 'POST', body: JSON.stringify(input) }),
  getCase: (caseId: string) => request<Case>(`/cases/${caseId}`),
  uploadDocument: (caseId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>(`/cases/${caseId}/uploads`, { method: 'POST', body: form })
  },
  getJob: (jobId: string) => request<Job>(`/jobs/${jobId}`),
  listTransactions: (caseId: string) => request<Transaction[]>(`/cases/${caseId}/transactions`),
}

export const api = USE_REAL_API ? realAdapter : mockAdapter
export { ApiError }
