"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { replaceScannedFile } from "@/app/actions/expenses"
import { CornerAdjuster } from "@/components/CornerAdjuster"
import { canvasFromBlob, detectCanvas, insetCorners, renderCanvas, type Point } from "@/lib/receiptScanner"
import { imagesToPdf, renderPdf } from "@/lib/scanner/pdf"

type PageShot = {
  canvas: HTMLCanvasElement
  corners: Point[]
  detected: boolean
}

export function ReceiptRecrop({
  projectId,
  expenseId,
  src,
  onClose,
  onSaved,
}: {
  projectId: string
  expenseId: string
  src: string
  onClose: () => void
  onSaved: () => void
}) {
  const [pages, setPages] = useState<PageShot[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const page = pages[index] ?? null

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(src, { cache: "no-store" })
        if (!response.ok) throw new Error("Could not open the receipt")
        const blob = await response.blob()
        const type = `${response.headers.get("content-type") ?? ""} ${blob.type}`.toLowerCase()
        const sources = await sourceCanvases(blob, type)
        const loaded: PageShot[] = []
        for (const canvas of sources) {
          if (cancelled) return
          const found = await detectCanvas(canvas)
          loaded.push({
            canvas,
            corners: found ?? insetCorners(canvas.width, canvas.height),
            detected: Boolean(found),
          })
        }
        if (!cancelled) setPages(loaded)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open the receipt")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src])

  async function confirm(corners: Point[]) {
    if (!page) return
    setBusy(true)
    try {
      const next = pages.map((item, pageIndex) => (pageIndex === index ? { ...item, corners, detected: true } : item))
      setPages(next)
      if (index < next.length - 1) {
        setIndex(index + 1)
        setBusy(false)
        return
      }
      const rendered = []
      for (const item of next) {
        rendered.push(await renderCanvas(item.canvas, item.corners, "scan", false))
      }
      const first = rendered[0]
      if (!first) throw new Error("A page is missing")
      const asPdf = rendered.length > 1
      const fileBlob = asPdf ? await imagesToPdf(rendered.map((item) => item.blob)) : first.blob
      const thumb = await thumbnail(first.blob)
      const body = new FormData()
      body.set("projectId", projectId)
      body.set("expenseId", expenseId)
      body.set("pageCount", String(rendered.length))
      body.set("cropMethod", "manual")
      body.set("cropCorners", JSON.stringify(rendered.map((item) => item.corners)))
      body.set("file", new File([fileBlob], asPdf ? "receipt.pdf" : "receipt.jpg", { type: asPdf ? "application/pdf" : "image/jpeg" }))
      body.set("thumb", new File([thumb], "thumb.webp", { type: "image/webp" }))
      const result = await replaceScannedFile(body)
      if (result.error) throw new Error(result.error)
      toast.success("Saved the cropped receipt")
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the cropped receipt")
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h2 className="font-medium">Crop receipt</h2>
        <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm underline">
          Cancel
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {!error && !page ? <p className="text-sm text-muted-foreground">Finding the receipt…</p> : null}
        {page ? (
          <div className="mx-auto grid max-w-3xl gap-3">
            {pages.length > 1 ? <p className="text-sm text-muted-foreground">Page {index + 1} of {pages.length}</p> : null}
            {!page.detected ? <p className="text-sm text-muted-foreground">The receipt was not found. Drag the corners onto the paper.</p> : null}
            <CornerAdjuster
              image={page.canvas}
              corners={page.corners}
              busy={busy}
              onChange={(corners) => {
                setPages((current) => current.map((item, pageIndex) => (pageIndex === index ? { ...item, corners } : item)))
              }}
              onCancel={onClose}
              onConfirm={() => void confirm(page.corners)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

async function sourceCanvases(blob: Blob, type: string) {
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  const pdf = type.includes("pdf") || String.fromCharCode(...header).startsWith("%PDF")
  if (!pdf) return [await canvasFromBlob(blob)]
  const rendered = await renderPdf(blob, { maxLongSide: 2400 })
  const canvases: HTMLCanvasElement[] = []
  for (const page of rendered.pages) canvases.push(await canvasFromBlob(page.blob))
  return canvases
}

async function thumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = 400
  canvas.height = Math.max(1, Math.round((bitmap.height / bitmap.width) * 400))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.75))
  if (!thumb) throw new Error("Could not make a thumbnail")
  return thumb
}
