"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { ReceiptCropper } from "@/components/ReceiptCropper"
import { CameraCapture } from "@/components/scanner/camera-capture"
import { PageManager, type ManagedPage } from "@/components/scanner/page-manager"
import { ScanPreview } from "@/components/scanner/scan-preview"
import {
  cornersNear,
  cropReceipt,
  decodeReceiptFile,
  fullFrameCorners,
  loadOpenCv,
  rasterToDataUrl,
  rasterToJpegBlob,
  renderCrop,
  rotateRaster,
  type CropMethod,
  type Point,
  type Raster,
} from "@/lib/receiptCrop"
import { sha256 } from "@/lib/scanner/hash"
import { checksFor } from "@/lib/scanner/image"
import { imagesToPdf, renderPdf } from "@/lib/scanner/pdf"
import type { CaptureType, PageChecks, ScanResult } from "@/lib/scanner/types"

type Choice = "auto" | "manual" | "original"

type Draft = {
  id: string
  hash: string
  original: Blob
  source: Raster
  corners: Point[]
  autoCorners: Point[]
  autoMethod: CropMethod
  choice: Choice
  confidence: number
  checks: PageChecks
  previewUrl: string
  processed: Raster | null
}

const emptyChecks: PageChecks = { blurry: false, tooSmall: false, glare: false, dark: false, joins: false }

function asImageData(raster: Raster) {
  return new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height)
}

function pageMethod(page: Draft): CropMethod {
  if (page.choice === "original") return "none"
  const tolerance = Math.max(6, Math.max(page.source.width, page.source.height) * 0.012)
  if (page.choice === "manual" || !cornersNear(page.corners, page.autoCorners, tolerance)) return "manual"
  return page.autoMethod
}

function paintPage(page: Draft): Draft {
  const method = pageMethod(page)
  const corners = page.choice === "original" ? fullFrameCorners(page.source.width, page.source.height) : page.corners
  const rendered = renderCrop(page.source, corners, method, page.confidence)
  return {
    ...page,
    corners: page.choice === "original" ? corners : rendered.corners,
    processed: rendered.image,
    checks: checksFor(asImageData(rendered.image), rendered.image.width),
    previewUrl: rasterToDataUrl(rendered.image),
  }
}

function combinedMethod(methods: CropMethod[]): CropMethod {
  if (methods.includes("manual")) return "manual"
  if (methods.includes("none")) return "none"
  if (methods.includes("fallback")) return "fallback"
  return "auto"
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
    void loadOpenCv()
  }, [])
  useEffect(() => {
    if (started.current || initialFiles.length === 0) return
    started.current = true
    void acceptFiles(initialFiles)
    // The chosen files are scanned once when the scanner opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!editingId && !previewSrc) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [editingId, previewSrc])
  async function addBlob(blob: Blob, hashBlob = blob) {
    setStatus("Finding the receipt")
    try {
      const hash = await sha256(hashBlob)
      const source = await decodeReceiptFile(blob)
      const detected = await cropReceipt(source)
      const original = await rasterToJpegBlob(source, 0.85)
      const id = crypto.randomUUID()
      const draft = paintPage({
        id,
        hash,
        original,
        source,
        corners: detected.corners,
        autoCorners: detected.corners,
        autoMethod: detected.method,
        choice: detected.method === "none" ? "original" : "auto",
        confidence: detected.confidence,
        checks: emptyChecks,
        previewUrl: "",
        processed: null,
      })
      setPages((current) => [...current, draft].slice(0, 20))
      setEditingId(id)
      setCamera(false)
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "This photo could not be opened")
    } finally {
      setStatus(null)
    }
  }

  async function rotateEditing() {
    if (!editing) return
    setStatus("Turning the photo")
    try {
      const source = rotateRaster(editing.source, 1)
      const detected = await cropReceipt(source)
      const original = await rasterToJpegBlob(source, 0.85)
      const next = paintPage({
        ...editing,
        source,
        original,
        corners: detected.corners,
        autoCorners: detected.corners,
        autoMethod: detected.method,
        choice: detected.method === "none" ? "original" : "auto",
        confidence: detected.confidence,
        processed: null,
      })
      setPages((current) => current.map((page) => (page.id === editing.id ? next : page)))
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Could not rotate the photo")
    } finally {
      setStatus(null)
    }
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
        previewUrl: page.previewUrl || rasterToDataUrl(page.source),
        checks: page.checks,
      })),
    [pages],
  )

  async function buildResult(group: Draft[], type: CaptureType): Promise<ScanResult> {
    const painted = group.map((page) => (page.processed ? page : paintPage(page)))
    const images = painted.map((page) => page.processed).filter((image): image is Raster => Boolean(image))
    const jpegs = await Promise.all(images.map((image) => rasterToJpegBlob(image, 0.85)))
    const multi = type !== "single" && painted.length > 1
    const fileBlob = multi ? await imagesToPdf(jpegs) : jpegs[0]
    if (!fileBlob) throw new Error("The scan could not be saved")
    if (fileBlob.size > 15 * 1024 * 1024) setNote("This scan is over 15 MB.")
    const thumbSource = images[0]
    const thumbCanvas = document.createElement("canvas")
    thumbCanvas.width = 400
    thumbCanvas.height = Math.max(1, Math.round((thumbSource.height / thumbSource.width) * 400))
    const full = document.createElement("canvas")
    full.width = thumbSource.width
    full.height = thumbSource.height
    full.getContext("2d")?.putImageData(asImageData(thumbSource), 0, 0)
    thumbCanvas.getContext("2d")?.drawImage(full, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
      thumbCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make a thumbnail"))), "image/webp", 0.75)
    })
    const methods = painted.map(pageMethod)
    return {
      fileBlob,
      fileType: multi ? "pdf" : "image",
      pageCount: group.length,
      thumbnailBlob,
      originals: painted.map((page) => page.original),
      pageHashes: painted.map((page) => page.hash),
      filter: "bw",
      captureType: type,
      cropMethod: combinedMethod(methods),
      needsManualCrop: methods.some((method) => method === "none"),
      pages: painted.map((page, index) => ({
        width: images[index].width,
        height: images[index].height,
        cropCorners: page.corners,
        filter: "bw" as const,
        checks: page.checks,
      })),
      rerender: async () => fileBlob,
    }
  }

  async function confirm(chosen?: CaptureType, direct = false) {
    if (pages.length === 0) return
    setBusy(true)
    try {
      const group = pages.map((page) => paintPage(editing && page.id === editing.id ? editing : page))
      setPages(group)
      const warnings = group.flatMap((page) => checkLabels(page.checks))
      if (warnings.length && !note && !direct) {
        setNote(warnings[0])
        return
      }
      if (!direct && !previewSrc) {
        const first = group[0]?.previewUrl
        if (first) setPreviewSrc(first)
        return
      }
      const type = chosen ?? (group.length === 1 ? "single" : captureType)
      if (type === "single" && group.length > 1) {
        await onComplete(await separateResults(group))
        return
      }
      await onComplete([await buildResult(group, type)])
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "The scan could not be saved")
    } finally {
      setBusy(false)
    }
  }

  async function separateResults(group: Draft[]) {
    const results: ScanResult[] = []
    for (const page of group) {
      if (!page.processed) continue
      results.push(await buildResult([page], "single"))
    }
    return results
  }

  const warning = (editing ? checkLabels(editing.checks)[0] : null) || note

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
        <ReceiptCropper
          image={editing.source}
          corners={editing.corners}
          needsManualCrop={editing.autoMethod === "none" && editing.choice !== "manual"}
          busy={busy}
          note={warning}
          onCancel={onCancel}
          onChange={(corners) => {
            setPages((current) =>
              current.map((page) => (page.id === editing.id ? { ...page, corners, choice: "manual" } : page)),
            )
          }}
          onUseCrop={() => {
            const next = paintPage({ ...editing, choice: pageMethod(editing) === "none" ? "original" : editing.choice })
            setPages((current) => current.map((page) => (page.id === editing.id ? next : page)))
            setEditingId(null)
          }}
          onResetAuto={() => {
            const next = paintPage({
              ...editing,
              corners: editing.autoCorners,
              choice: editing.autoMethod === "none" ? "original" : "auto",
            })
            setPages((current) => current.map((page) => (page.id === editing.id ? next : page)))
          }}
          onUseOriginal={() => {
            const next = paintPage({
              ...editing,
              choice: "original",
              corners: fullFrameCorners(editing.source.width, editing.source.height),
            })
            setPages((current) => current.map((page) => (page.id === editing.id ? next : page)))
          }}
          onRotate={() => void rotateEditing()}
          onDone={() => void confirm(pages.length === 1 ? "single" : captureType, true)}
        />
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
            <div className="sticky bottom-0 z-20 grid gap-2 border-t border-border bg-background/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
              <button
                type="button"
                disabled={busy}
                className="min-h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
                onClick={() => void confirm(pages.length === 1 ? "single" : captureType)}
              >
                {busy ? "Saving…" : "Done"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => { setCaptureType("long"); setCamera(true) }}>
                  Add section
                </button>
                <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => { setCaptureType("multi_page"); setCamera(true) }}>
                  Add page
                </button>
              </div>
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
          onConfirm={() => void confirm(pages.length === 1 ? "single" : captureType, true)}
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

function checkLabels(checks: PageChecks) {
  return [
    checks.blurry ? "Photo is blurry — retake?" : "",
    checks.tooSmall ? "Receipt too small in the photo — move closer and retake." : "",
    checks.glare ? "Glare detected — tilt the receipt or turn off the flash." : "",
    checks.dark ? "The photo is dark — turn on the flash." : "",
    checks.joins ? "Check the joins." : "",
  ].filter(Boolean)
}
