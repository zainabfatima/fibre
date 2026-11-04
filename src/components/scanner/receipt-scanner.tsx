"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { ReceiptCamera, type UsedScan } from "@/components/ReceiptCamera"
import { PageManager, type ManagedPage } from "@/components/scanner/page-manager"
import { sha256 } from "@/lib/scanner/hash"
import { isPdfUpload, RECEIPT_UPLOAD_ACCEPT, imagesToPdf } from "@/lib/scanner/pdf"
import type { CaptureType, PageChecks, ScanResult } from "@/lib/scanner/types"

type Draft = {
  id: string
  hash: string
  original: Blob
  scanBlob: Blob
  previewUrl: string
  width: number
  height: number
  corners: UsedScan["corners"]
  method: UsedScan["method"]
  checks: PageChecks
}

const emptyChecks: PageChecks = { blurry: false, tooSmall: false, glare: false, dark: false, joins: false }

export function ReceiptScanner({
  initialFiles = [],
  startInCamera = false,
  replacing = false,
  onCancel,
  onComplete,
  onPdfFiles,
}: {
  initialFiles?: File[]
  startInCamera?: boolean
  replacing?: boolean
  onCancel: () => void
  onComplete: (results: ScanResult[]) => Promise<void>
  onPdfFiles?: (files: File[]) => Promise<void>
}) {
  const [pages, setPages] = useState<Draft[]>([])
  const [camera, setCamera] = useState(startInCamera && initialFiles.length === 0)
  const [incoming, setIncoming] = useState<File | null>(null)
  const [captureType, setCaptureType] = useState<CaptureType>("single")
  const [batchChoice, setBatchChoice] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)
  const waiting = useRef<File[]>([])

  useEffect(() => {
    if (started.current || initialFiles.length === 0) return
    started.current = true
    void acceptFiles(initialFiles)
    // The chosen files are scanned once when the scanner opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles])

  async function acceptFiles(files: File[]) {
    const chosen = files.slice(0, 20)
    const pdfs: File[] = []
    const images: File[] = []
    for (const file of chosen) {
      if (await isPdfUpload(file)) pdfs.push(file)
      else images.push(file)
    }
    if (pdfs.length > 0) {
      if (onPdfFiles) await onPdfFiles(pdfs)
      else setNote("PDF receipts are saved as the original file from Upload Receipts.")
    }
    if (images.length > 1) setBatchChoice(true)
    if (images[0]) {
      waiting.current = images.slice(1)
      setIncoming(images[0])
      setCamera(true)
    }
  }

  async function acceptScan(scan: UsedScan) {
    const hash = await sha256(scan.originalBlob)
    const id = crypto.randomUUID()
    setPages((current) => [
      ...current,
      {
        id,
        hash,
        original: scan.originalBlob,
        scanBlob: scan.blob,
        previewUrl: URL.createObjectURL(scan.blob),
        width: scan.width,
        height: scan.height,
        corners: scan.corners,
        method: scan.method,
        checks: { ...emptyChecks, glare: scan.glareSevere },
      },
    ].slice(0, 20))
  }

  function finishCapture() {
    const next = waiting.current[0]
    waiting.current = waiting.current.slice(1)
    if (next) setIncoming(next)
    else {
      setIncoming(null)
      setCamera(false)
    }
  }

  const managed: ManagedPage[] = useMemo(
    () => pages.map((page) => ({ id: page.id, previewUrl: page.previewUrl, checks: page.checks })),
    [pages],
  )

  async function buildResult(group: Draft[], type: CaptureType): Promise<ScanResult> {
    const multi = type !== "single" && group.length > 1
    const fileBlob = multi ? await imagesToPdf(group.map((page) => page.scanBlob)) : group[0]?.scanBlob
    if (!fileBlob) throw new Error("The scan could not be saved")
    const thumbnailBlob = await thumbnail(group[0])
    const methods = group.map((page) => page.method)
    return {
      fileBlob,
      fileType: multi ? "pdf" : "image",
      pageCount: group.length,
      thumbnailBlob,
      originals: group.map((page) => page.original),
      pageHashes: group.map((page) => page.hash),
      filter: "bw",
      captureType: type,
      cropMethod: methods.includes("manual") ? "manual" : methods.includes("none") ? "none" : "auto",
      needsManualCrop: methods.includes("none"),
      pages: group.map((page) => ({
        width: page.width,
        height: page.height,
        cropCorners: page.corners ?? [],
        filter: "bw" as const,
        checks: page.checks,
      })),
      rerender: async () => fileBlob,
    }
  }

  async function confirm() {
    if (pages.length === 0) return
    setBusy(true)
    try {
      const type = replacing && pages.length > 1 ? "multi_page" : pages.length === 1 ? "single" : captureType
      if (!replacing && type === "single" && pages.length > 1) {
        const results: ScanResult[] = []
        for (const page of pages) results.push(await buildResult([page], "single"))
        await onComplete(results)
        return
      }
      await onComplete([await buildResult(pages, type)])
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "The scan could not be saved")
    } finally {
      setBusy(false)
    }
  }

  if (camera) {
    return (
      <ReceiptCamera
        file={incoming}
        onCancel={() => {
          setCamera(false)
          setIncoming(null)
          if (pages.length === 0) onCancel()
        }}
        onUse={(scan) => void acceptScan(scan)}
        onFinished={finishCapture}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{replacing ? "Retake picture" : "Scan receipt"}</h2>
        <button type="button" onClick={onCancel} className="text-sm underline">
          Cancel
        </button>
      </div>
      {note ? <p className="text-sm text-destructive">{note}</p> : null}
      {batchChoice && pages.length > 1 && !replacing ? (
        <div className="grid gap-2 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">
          <p>These photos can be separate receipts or one multi-page document.</p>
          <div className="grid gap-2">
            <button type="button" className="min-h-11 rounded-lg border border-input" onClick={() => { setCaptureType("single"); setBatchChoice(false) }}>
              Separate receipts
            </button>
            <button type="button" className="min-h-11 rounded-lg border border-input" onClick={() => { setCaptureType("multi_page"); setBatchChoice(false) }}>
              One multi-page document
            </button>
          </div>
        </div>
      ) : null}
      {pages.length > 0 ? (
        <PageManager
          pages={managed}
          onReorder={(next) => {
            setPages((current) => next.map((item) => current.find((page) => page.id === item.id)).filter((page): page is Draft => Boolean(page)))
          }}
          onDelete={(id) => setPages((current) => current.filter((page) => page.id !== id))}
          onEdit={() => setCamera(true)}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => { setIncoming(null); setCamera(true) }}>
          Camera
        </button>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-input text-sm">
          Upload
          <input
            type="file"
            accept={RECEIPT_UPLOAD_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ""
              void acceptFiles(files)
            }}
          />
        </label>
      </div>
      {pages.length > 0 ? (
        <button type="button" disabled={busy} className="min-h-11 rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60" onClick={() => void confirm()}>
          {busy ? "Saving…" : "Done"}
        </button>
      ) : null}
    </div>
  )
}

async function thumbnail(page: Draft) {
  const bitmap = await createImageBitmap(page.scanBlob)
  const canvas = document.createElement("canvas")
  canvas.width = 400
  canvas.height = Math.max(1, Math.round((bitmap.height / bitmap.width) * 400))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.75))
  if (!blob) throw new Error("Could not make a thumbnail")
  return blob
}
