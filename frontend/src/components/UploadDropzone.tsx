import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client'
import type { JobErrorCode } from '../api/types'
import { formatBytes } from '../lib/format'
import { slideUp } from '../theme/motion'

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.tsv,.docx,.jpg,.jpeg,.png'
const POLL_INTERVAL_MS = 700

/** Plain-English guidance per failure — officers read these, keep them jargon-free. */
const ERROR_GUIDANCE: Record<JobErrorCode, string> = {
  PASSWORD_PROTECTED:
    'This PDF has a password. Open it, remove the password (usually date of birth or account number the bank set), save, and upload again.',
  UNSUPPORTED_FORMAT:
    'This file type is not supported. Upload the statement as PDF, Excel, CSV, Word, or a photo (JPG/PNG).',
  DUPLICATE_FILE: 'This exact file is already in this case — no need to upload it twice.',
  PARSE_FAILED:
    'We could not read this statement automatically. It will be routed for manual mapping.',
}

type UploadPhase = 'uploading' | 'parsing' | 'done' | 'failed'

interface UploadItem {
  key: string
  filename: string
  sizeBytes: number
  phase: UploadPhase
  progress: number
  transactionsFound: number | null
  errorCode: JobErrorCode | null
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
          errorCode: null,
        },
      ])
      try {
        const upload = await api.uploadDocument(caseId, file)
        patchItem(key, { phase: 'parsing', progress: 0.05 })
        // Poll the parse job until it settles.
        for (;;) {
          const job = await api.getJob(upload.job_id)
          if (job.status === 'done') {
            patchItem(key, {
              phase: 'done',
              progress: 1,
              transactionsFound: job.transactions_found,
            })
            onTransactionsAdded?.()
            return
          }
          if (job.status === 'failed') {
            patchItem(key, { phase: 'failed', errorCode: job.error_code ?? 'PARSE_FAILED' })
            return
          }
          patchItem(key, { progress: Math.max(0.05, job.progress) })
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
      } catch {
        patchItem(key, { phase: 'failed', errorCode: 'PARSE_FAILED' })
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
        {item.phase === 'failed' && item.errorCode && (
          <p className="text-body text-danger mt-1">{ERROR_GUIDANCE[item.errorCode]}</p>
        )}
      </div>

      {(item.phase === 'uploading' || item.phase === 'parsing') && (
        <div className="flex items-center gap-3 w-48 shrink-0">
          <div className="h-2 flex-1 rounded-pill bg-background overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </div>
          <span className="text-label text-text-secondary w-16">
            {item.phase === 'uploading' ? 'Sending…' : 'Reading…'}
          </span>
        </div>
      )}

      {item.phase === 'done' && (
        <span className="tag bg-success-soft text-success shrink-0">
          {item.transactionsFound ?? 0} transactions found
        </span>
      )}
      {item.phase === 'failed' && (
        <span className="tag bg-danger-soft text-danger shrink-0">Needs attention</span>
      )}
    </motion.li>
  )
}
