import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api, ApiError } from '../api/client'
import { formatBytes } from '../lib/format'
import { slideUp } from '../theme/motion'

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.tsv,.docx,.txt,.jpg,.jpeg,.png'
const POLL_INTERVAL_MS = 700

/**
 * Plain-English guidance from server error text — officers read these.
 * The contract carries failures as free text (job.detail / HTTP detail),
 * so classification is by message content + status code.
 */
function guidanceFor(status: number | null, message: string): string {
  if (status === 409)
    return 'This exact file is already in this case — no need to upload it twice.'
  if (status === 413) return 'This file is too large. Split the statement and try again.'
  if (/password/i.test(message))
    return 'This PDF has a password. Open it, remove the password (usually date of birth or account number the bank set), save, and upload again.'
  if (/unsupported/i.test(message))
    return 'This file type is not supported. Upload the statement as PDF, Excel, CSV, Word, or a photo (JPG/PNG).'
  return `We could not read this statement automatically${message ? ` (${message})` : ''}. It will be routed for manual mapping.`
}

/** Job completion detail is "N transactions" — extract N for the success chip. */
function transactionsFromDetail(detail: string | null): number | null {
  const match = detail?.match(/(\d+)\s+transactions?/)
  return match ? Number(match[1]) : null
}

type UploadPhase = 'uploading' | 'parsing' | 'done' | 'failed'

interface UploadItem {
  key: string
  filename: string
  sizeBytes: number
  phase: UploadPhase
  /** 0–100 */
  progress: number
  transactionsFound: number | null
  errorText: string | null
}

export function UploadDropzone({
  caseId,
  onTransactionsAdded,
}: {
  caseId: string
  onTransactionsAdded?: () => void
}) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const patchItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }, [])

  const startUpload = useCallback(
    async (file: File) => {
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`
      setItems((prev) => [
        ...prev,
        {
          key,
          filename: file.name,
          sizeBytes: file.size,
          phase: 'uploading',
          progress: 0,
          transactionsFound: null,
          errorText: null,
        },
      ])
      try {
        const initialJob = await api.uploadDocument(caseId, file)
        patchItem(key, { phase: 'parsing', progress: Math.max(5, initialJob.progress) })
        // Poll the parse job until it settles.
        let job = initialJob
        while (job.status === 'pending' || job.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          job = await api.getJob(job.id)
          patchItem(key, { progress: Math.max(5, job.progress) })
        }
        if (job.status === 'done') {
          patchItem(key, {
            phase: 'done',
            progress: 100,
            transactionsFound: transactionsFromDetail(job.detail),
          })
          onTransactionsAdded?.()
        } else {
          patchItem(key, { phase: 'failed', errorText: guidanceFor(null, job.detail ?? '') })
        }
      } catch (error) {
        const status = error instanceof ApiError ? error.status : null
        const message = error instanceof Error ? error.message : ''
        patchItem(key, { phase: 'failed', errorText: guidanceFor(status, message) })
      }
    },
    [caseId, onTransactionsAdded, patchItem],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      for (const file of Array.from(files)) void startUpload(file)
    },
    [startUpload],
  )

  const doneCount = items.filter((it) => it.phase === 'done').length
  const failedCount = items.filter((it) => it.phase === 'failed').length
  const busyCount = items.length - doneCount - failedCount

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`rounded-card border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary-soft' : 'border-border bg-surface'
        }`}
      >
        <p className="text-section text-text-primary mb-2">Drop bank statements here</p>
        <p className="text-body text-text-secondary">
          or click to choose files — PDF, Excel, CSV, Word, or photos. Any mix, any bank, as many
          files as you have.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-label uppercase text-text-secondary mb-2">
            {items.length} file{items.length === 1 ? '' : 's'} · {doneCount} read
            {busyCount > 0 && ` · ${busyCount} in progress`}
            {failedCount > 0 && ` · ${failedCount} need attention`}
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }) {
  return (
    <motion.li
      variants={slideUp}
      initial="hidden"
      animate="visible"
      className="card !p-4 flex items-center gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-text-primary truncate">{item.filename}</div>
        <div className="text-label text-text-secondary">{formatBytes(item.sizeBytes)}</div>
        {item.phase === 'failed' && item.errorText && (
          <p className="text-body text-danger mt-1">{item.errorText}</p>
        )}
      </div>

      {(item.phase === 'uploading' || item.phase === 'parsing') && (
        <div className="flex items-center gap-3 w-48 shrink-0">
          <div className="h-2 flex-1 rounded-pill bg-background overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <span className="text-label text-text-secondary w-16">
            {item.phase === 'uploading' ? 'Sending…' : 'Reading…'}
          </span>
        </div>
      )}

      {item.phase === 'done' && (
        <span className="tag bg-success-soft text-success shrink-0">
          {item.transactionsFound !== null
            ? `${item.transactionsFound} transactions found`
            : 'Statement read'}
        </span>
      )}
      {item.phase === 'failed' && (
        <span className="tag bg-danger-soft text-danger shrink-0">Needs attention</span>
      )}
    </motion.li>
  )
}
