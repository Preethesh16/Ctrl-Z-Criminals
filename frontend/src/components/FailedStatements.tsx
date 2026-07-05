import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api/client'
import type { DocumentOut, JobOut } from '../api/types'
import { ColumnMappingModal } from './ColumnMappingModal'
import { Button } from './ui/Button'
import { slideUp, staggerContainer } from '../theme/motion'

/** A statement needs attention if parsing FAILED outright, or if it was read
 *  but yielded ZERO transactions (blurry scan, a photo that isn't a bank
 *  statement, or a layout the parser couldn't map). */
function needsAttention(doc: DocumentOut): boolean {
  if (doc.status === 'failed') return true
  return doc.status !== 'parsing' && doc.status !== 'uploaded' && doc.txn_count === 0
}

/** Plain-English reason a statement could not be read. */
function explainFailure(doc: DocumentOut): string {
  const err = (doc.error ?? '').toLowerCase()
  if (err.includes('password'))
    return 'The PDF is password-protected — remove the password and upload it again.'
  if (err.includes('unsupported'))
    return 'This file format is not supported — export the statement as PDF, Excel or CSV.'
  if (err.includes('unrecognized') || err.includes('layout'))
    return "The statement's table layout was not recognised — map its columns manually below."
  if (doc.status !== 'failed' && doc.txn_count === 0)
    return 'The file was read but no transactions were found — it may be a blurry scan or photo, ' +
      'or not a bank statement. Upload a clearer copy, or map its columns manually below.'
  return doc.error
    ? `Could not read this statement: ${doc.error}`
    : 'Could not read this statement.'
}

/**
 * Statements that failed to parse, surfaced in the Review step with two ways
 * forward: re-upload a corrected file, or map the columns manually.
 */
export function FailedStatements({
  caseId,
  onChanged,
}: {
  caseId: string
  onChanged?: () => void
}) {
  const [failed, setFailed] = useState<DocumentOut[] | null>(null)
  const [mappingDocId, setMappingDocId] = useState<string | null>(null)
  const [busyDocId, setBusyDocId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reuploadForRef = useRef<string | null>(null)

  const load = useCallback(() => {
    api
      .listDocuments(caseId)
      .then((docs) => setFailed(docs.filter(needsAttention)))
      .catch(() => setFailed([]))
  }, [caseId])

  useEffect(load, [load])

  async function pollJob(jobId: string): Promise<JobOut> {
    for (;;) {
      const job = await api.getJob(jobId)
      if (job.status === 'done' || job.status === 'failed') return job
      await new Promise((r) => setTimeout(r, 800))
    }
  }

  /** Re-upload flow: officer picks the corrected file for this statement. */
  function startReupload(docId: string) {
    reuploadForRef.current = docId
    fileInputRef.current?.click()
  }

  async function onFilePicked(file: File | null) {
    const docId = reuploadForRef.current
    reuploadForRef.current = null
    if (!file || !docId) return
    setBusyDocId(docId)
    setNotice('')
    try {
      const up = await api.uploadDocument(caseId, file)
      const job = await pollJob(up.job_id)
      if (job.status === 'done') {
        setNotice(`✓ ${file.name} read successfully — ${job.detail ?? 'done'}.`)
        load()
        onChanged?.()
      } else {
        setNotice(`✕ ${file.name} still could not be read: ${job.detail ?? 'unknown error'}`)
      }
    } catch (e) {
      setNotice(
        e instanceof Error && e.message.includes('409')
          ? '✕ That exact file is already in this case — fix the statement file first, then upload the corrected copy.'
          : '✕ Upload failed — try again.',
      )
    } finally {
      setBusyDocId(null)
    }
  }

  if (!failed || failed.length === 0) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
      />
    )
  }

  return (
    <div className="mb-6">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      <p className="text-body text-text-primary font-medium mb-3">
        {failed.length} statement{failed.length === 1 ? '' : 's'} could not be read
      </p>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-3"
      >
        {failed.map((doc) => (
          <motion.li key={doc.id} variants={slideUp} className="card !p-4 border border-danger/40">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="tag bg-danger-soft text-danger">Not read</span>
                  <span className="text-body font-medium text-text-primary truncate">
                    {doc.filename}
                  </span>
                </div>
                <p className="text-label text-text-secondary max-w-xl">{explainFailure(doc)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  onClick={() => startReupload(doc.id)}
                  disabled={busyDocId !== null}
                >
                  {busyDocId === doc.id ? 'Uploading…' : '⬆ Re-upload corrected file'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setMappingDocId(doc.id)}
                  disabled={busyDocId !== null}
                >
                  ✎ Fix columns manually
                </Button>
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ul>
      {notice && (
        <p
          className={`text-body mt-3 ${notice.startsWith('✓') ? 'text-success' : 'text-danger'}`}
        >
          {notice}
        </p>
      )}

      <AnimatePresence>
        {mappingDocId && (
          <ColumnMappingModal
            documentId={mappingDocId}
            onClose={() => setMappingDocId(null)}
            onMapped={(job) => {
              setMappingDocId(null)
              if (job) {
                setNotice('✓ Columns mapped — the statement is being re-read now.')
                void pollJob(job.id).then(() => {
                  load()
                  onChanged?.()
                })
              } else {
                setNotice(
                  '✓ Template saved. Re-upload the corrected file — it will be read automatically now.',
                )
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
