"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { CameraCapture } from "@/components/scanner/camera-capture"
import { CornerAdjuster } from "@/components/scanner/corner-adjuster"
import { PageManager, type ManagedPage } from "@/components/scanner/page-manager"
import { ScanPreview } from "@/components/scanner/scan-preview"
import { blobFromFile, imageDataToBlob, previewUrl, scanPage } from "@/lib/scanner/engine"
import { detectCorners, rotate } from "@/lib/scanner/image"
import { sha256 } from "@/lib/scanner/hash"
import { imagesToPdf, renderPdf } from "@/lib/scanner/pdf"
import type { CaptureType, PageChecks, Point, ScanFilter, ScanResult } from "@/lib/scanner/types"

type Draft = {
  id: string
  hash: string
  original: Blob
  source: ImageData
  corners: Point[]
  filter: ScanFilter
  checks: PageChecks
  previewUrl: string
  processed: ImageData | null
}

const emptyChecks: PageChecks = { blurry: false, tooSmall: false, glare: false, dark: false, joins: false }

async function fileToJpegBlob(file: Blob) {
  const name = file instanceof File ? file.name.toLowerCase() : ""
  const type = file.type.toLowerCase()
  if (name.endsWith(".heic") || name.endsWith(".heif") || type.includes("heic")) {
    const heic2any = (await import("heic2any")).default
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })
    return Array.isArray(converted) ? converted[0] : converted
  }
  return file
}

export function ReceiptScanner({
  initialFiles = [],
  startInCamera = false,
  onCancel,
  onComplete,
}: {
  initialFiles?: File[]
  startInCamera?: boolean
  onCancel: () => void
  onComplete: (results: ScanResult[]) => Promise<void>
}) {
  const [pages, setPages] = useState<Draft[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [camera, setCamera] = useState(startInCamera && initialFiles.length === 0)
  const [captureType, setCaptureType] = useState<CaptureType>(initialFiles.length > 1 ? "single" : "single")
  const [batchChoice, setBatchChoice] = useState(initialFiles.length > 1)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const editing = pages.find((page) => page.id === editingId) ?? null
  const started = useRef(false)
  useEffect(() => {
    if (started.current || initialFiles.length === 0) return
    started.current = true
    void acceptFiles(initialFiles)
    // The chosen files are scanned once when the scanner opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const kind = captureType === "multi_page" ? "document" : "receipt"

  async function addBlob(blob: Blob, hashBlob = blob) {
    setStatus("Reading the photo")
    const hash = await sha256(hashBlob)
    const prepared = await fileToJpegBlob(blob)
    const source = await blobFromFile(prepared)
    const corners = detectCorners(source)
    const id = crypto.randomUUID()
    const draft: Draft = {
      id,
      hash,
      original: hashBlob,
      source,
      corners,
      filter: "bw",
      checks: emptyChecks,
      previewUrl: "",
      processed: null,
    }
    setPages((current) => [...current, draft].slice(0, 20))
    setEditingId(id)
    setCamera(false)
    setStatus(null)
    void refreshPreviews(draft)
  }

  async function refreshPreviews(draft: Draft) {
    const scanned = await scanPage(draft.source, draft.corners, "bw", kind)
    setPages((current) =>
      current.map((page) =>
        page.id === draft.id
          ? { ...page, filter: "bw", processed: scanned.image, checks: scanned.checks, previewUrl: previewUrl(scanned.image) }
          : page,
      ),
    )
  }

  async function acceptFiles(files: File[]) {
    if (files.length === 0) return
    const pdf = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
    if (pdf && files.length === 1) {
      setStatus("Reading the PDF")
      const rendered = await renderPdf(pdf)
      for (const page of rendered.pages) await addBlob(page.blob, page.blob)
      setStatus(null)
      return
    }
    if (files.length > 1) setBatchChoice(true)
    for (const file of files.slice(0, 20)) await addBlob(file)
  }

  const managed: ManagedPage[] = useMemo(
    () =>
      pages.map((page) => ({
        id: page.id,
        previewUrl: page.previewUrl || previewUrl(page.source),
        checks: page.checks,
      })),
    [pages],
  )

  async function blackAndWhitePdf(images: ImageData[]) {
    const pages = await Promise.all(images.map((image) => smallestBwPage(image)))
    const fileBlob = await imagesToPdf(pages)
    if (fileBlob.size > 15 * 1024 * 1024) setNote("This PDF is over 15 MB.")
    return fileBlob
  }

  async function buildResult(group: Draft[], type: CaptureType): Promise<ScanResult> {
    const kindForPages = type === "multi_page" ? "document" : "receipt"
    const scanned = await Promise.all(
      group.map((page) => scanPage(page.source, page.corners, "bw", kindForPages)),
    )
    const processed = scanned.map((item) => item.image)
    const fileBlob = await blackAndWhitePdf(processed)
    const thumbSource = processed[0]
    const thumbCanvas = document.createElement("canvas")
    thumbCanvas.width = 400
    thumbCanvas.height = Math.max(1, Math.round((thumbSource.height / thumbSource.width) * 400))
    const full = document.createElement("canvas")
    full.width = thumbSource.width
    full.height = thumbSource.height
    full.getContext("2d")?.putImageData(thumbSource, 0, 0)
    thumbCanvas.getContext("2d")?.drawImage(full, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
      thumbCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make a thumbnail"))), "image/webp", 0.75)
    })
    return {
      fileBlob,
      fileType: "pdf",
      pageCount: group.length,
      thumbnailBlob,
      originals: [],
      pageHashes: group.map((page) => page.hash),
      filter: "bw",
      captureType: type,
      pages: group.map((page, index) => ({
        width: processed[index].width,
        height: processed[index].height,
        cropCorners: page.corners,
        filter: "bw" as const,
        checks: scanned[index].checks,
      })),
      rerender: async () => fileBlob,
    }
  }

  async function confirm(chosen?: CaptureType) {
    if (pages.length === 0) return
    setBusy(true)
    try {
      const missing = pages.filter((page) => !page.processed)
      for (const page of missing) {
        const scanned = await scanPage(page.source, page.corners, "bw", kind)
        page.processed = scanned.image
        page.checks = scanned.checks
        page.filter = "bw"
      }
      const warnings = pages.flatMap((page) => checkLabels(page.checks))
      if (warnings.length && !note) {
        setNote(warnings[0])
        setBusy(false)
        return
      }
      if (!previewSrc) {
        const first = pages[0].processed
        if (first) setPreviewSrc(previewUrl(first))
        setBusy(false)
        return
      }
      const type = chosen ?? (pages.length === 1 ? "single" : captureType)
      if (type === "single" && pages.length > 1) {
        await onComplete(await separateResults())
        return
      }
      await onComplete([await buildResult(pages, type)])
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "The scan could not be saved")
    } finally {
      setBusy(false)
    }
  }

  async function separateResults() {
    const results: ScanResult[] = []
    for (const page of pages) {
      if (!page.processed) continue
      results.push(await buildResult([{ ...page }], "single"))
    }
    return results
  }

  const warning = editing ? checkLabels(editing.checks)[0] : note

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Scan receipt</h2>
        <button type="button" onClick={onCancel} className="text-sm underline">
          Cancel
        </button>
      </div>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {camera ? (
        <CameraCapture pageNumber={pages.length + 1} onCapture={(blob) => void addBlob(blob)} onClose={() => setCamera(false)} />
      ) : null}
      {batchChoice && pages.length > 1 ? (
        <div className="grid gap-2 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">
          <p>These photos can be separate receipts, one long receipt, or one multi-page document.</p>
          <div className="grid gap-2">
            <button type="button" className="min-h-11 rounded-lg border border-input" onClick={() => { setCaptureType("single"); setBatchChoice(false) }}>
              Separate receipts
            </button>
            <button type="button" className="min-h-11 rounded-lg border border-input" onClick={() => { setCaptureType("long"); setBatchChoice(false) }}>
              One long receipt
            </button>
            <button type="button" className="min-h-11 rounded-lg border border-input" onClick={() => { setCaptureType("multi_page"); setBatchChoice(false) }}>
              One multi-page document
            </button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="grid gap-3">
          <CornerAdjuster
            image={editing.source}
            corners={editing.corners}
            onChange={(corners) => {
              setPages((current) => current.map((page) => (page.id === editing.id ? { ...page, corners } : page)))
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-input px-3 text-sm"
              onClick={() => {
                const corners = detectCorners(editing.source)
                setPages((current) => current.map((page) => (page.id === editing.id ? { ...page, corners } : page)))
              }}
            >
              Auto
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-input px-3 text-sm"
              onClick={() => {
                const corners = [
                  { x: 0, y: 0 },
                  { x: editing.source.width - 1, y: 0 },
                  { x: editing.source.width - 1, y: editing.source.height - 1 },
                  { x: 0, y: editing.source.height - 1 },
                ]
                setPages((current) => current.map((page) => (page.id === editing.id ? { ...page, corners } : page)))
              }}
            >
              Full image
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-input px-3 text-sm"
              onClick={() => {
                const source = rotate(editing.source, 1)
                const corners = detectCorners(source)
                setPages((current) =>
                  current.map((page) => (page.id === editing.id ? { ...page, source, corners, processed: null } : page)),
                )
              }}
            >
              Rotate
            </button>
          </div>
          <p className="text-sm text-muted-foreground">Saved as a black-and-white PDF.</p>
          {warning ? <p className="text-sm text-red-700">{warning}</p> : null}
          <button
            type="button"
            className="min-h-11 rounded-lg bg-primary text-sm font-medium text-primary-foreground"
            onClick={() => {
              void refreshPreviews(editing)
              setEditingId(null)
            }}
          >
            Use this page
          </button>
        </div>
      ) : null}
      {pages.length > 0 ? (
        <PageManager
          pages={managed}
          onReorder={(next) => {
            setPages((current) => next.map((item) => current.find((page) => page.id === item.id)!).filter(Boolean))
          }}
          onDelete={(id) => setPages((current) => current.filter((page) => page.id !== id))}
          onEdit={(id) => {
            setEditingId(id)
            setPreviewSrc(null)
          }}
        />
      ) : null}
      {!editing && !camera ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => setCamera(true)}>
              Camera
            </button>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-input text-sm">
              Upload
              <input
                type="file"
                accept="image/*,.heic,.heif,application/pdf"
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
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => void confirm(pages.length === 1 ? "single" : captureType)}>
                Done
              </button>
              <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => { setCaptureType("long"); setCamera(true) }}>
                Add section
              </button>
              <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => { setCaptureType("multi_page"); setCamera(true) }}>
                Add page
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {previewSrc ? (
        <ScanPreview
          src={previewSrc}
          note={note ?? undefined}
          confirming={busy}
          onRetake={() => {
            setPages([])
            setPreviewSrc(null)
            setNote(null)
            setCamera(true)
          }}
          onAdjust={() => {
            setPreviewSrc(null)
            setEditingId(pages[0]?.id ?? null)
          }}
          onConfirm={() => void confirm()}
        />
      ) : null}
      {initialFiles.length > 0 && pages.length === 0 && !status ? (
        <button type="button" className="min-h-11 rounded-lg bg-primary text-sm text-primary-foreground" onClick={() => void acceptFiles(initialFiles)}>
          Scan {initialFiles.length} file{initialFiles.length === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  )
}

function smallestBwPage(image: ImageData) {
  return imageDataToBlob(image, "image/jpeg", 0.8)
}

function checkLabels(checks: PageChecks) {
  return [
    checks.blurry ? "Photo is blurry — retake?" : "",
    checks.tooSmall ? "Receipt too small in the photo — move closer and retake." : "",
    checks.glare ? "Glare detected — tilt the receipt or turn off the flash." : "",
    checks.dark ? "The photo is dark — turn on the flash." : "",
    checks.joins ? "Check the joins." : "",
  ].filter(Boolean)
}
