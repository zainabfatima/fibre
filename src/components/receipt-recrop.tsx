"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { replaceScannedFile } from "@/app/actions/expenses"
import { ReceiptCropper } from "@/components/ReceiptCropper"
import {
  cropReceipt,
  decodeReceiptFile,
  fullFrameCorners,
  loadOpenCv,
  rasterToJpegBlob,
  renderCrop,
  rotateRaster,
  type CropMethod,
  type Point,
  type Raster,
} from "@/lib/receiptCrop"
import { imagesToPdf, renderPdf } from "@/lib/scanner/pdf"

type LoadedPage = {
  source: Raster
  corners: Point[]
  autoCorners: Point[]
  autoMethod: CropMethod
  confidence: number
  moved: boolean
}

type Accepted = {
  blob: Blob
  corners: Point[]
  method: CropMethod
  image: Raster | null
}

function resolveMethod(page: LoadedPage): CropMethod {
  if (page.moved) return "manual"
  if (page.autoMethod === "none") return "none"
  return page.autoMethod
}

function combinedMethod(methods: CropMethod[]): CropMethod {
  if (methods.includes("manual")) return "manual"
  if (methods.includes("none")) return "none"
  if (methods.includes("fallback")) return "fallback"
  return "auto"
}

async function thumbnailBlob(raster: Raster) {
  const width = 400
  const height = Math.max(1, Math.round((raster.height / raster.width) * width))
  const full = document.createElement("canvas")
  full.width = raster.width
  full.height = raster.height
  const source = full.getContext("2d")
  if (!source) throw new Error("Could not prepare the receipt image")
  source.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  const thumb = document.createElement("canvas")
  thumb.width = width
  thumb.height = height
  thumb.getContext("2d")?.drawImage(full, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => thumb.toBlob(resolve, "image/webp", 0.75))
  if (!blob) throw new Error("Could not make a thumbnail")
  return blob
}

function Shell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex h-dvh max-w-[100vw] flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h2 className="font-medium">{title}</h2>
        <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm underline">
          Cancel
        </button>
      </div>
      <div className="grid flex-1 place-items-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  )
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
  const [sourceIsPdf, setSourceIsPdf] = useState(false)
  const [pages, setPages] = useState<LoadedPage[]>([])
  const [index, setIndex] = useState(0)
  const [accepted, setAccepted] = useState<Array<Accepted | null>>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [turning, setTurning] = useState(false)
  const [working, setWorking] = useState(false)
  const [saving, setSaving] = useState(false)
  const lockRef = useRef(false)
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
        await loadOpenCv()
        const response = await fetch(src, { cache: "no-store" })
        if (!response.ok) throw new Error("Could not open the receipt")
        const blob = await response.blob()
        const type = `${response.headers.get("content-type") ?? ""} ${blob.type}`.toLowerCase()
        const sources = type.includes("pdf")
          ? (await renderPdf(blob, { maxLongSide: 2400 })).pages.map((item) => item.blob)
          : [blob]
        const loaded: LoadedPage[] = []
        for (const sourceBlob of sources) {
          if (cancelled) return
          const source = await decodeReceiptFile(sourceBlob)
          const detected = await cropReceipt(source)
          loaded.push({
            source,
            corners: detected.corners,
            autoCorners: detected.corners,
            autoMethod: detected.method,
            confidence: detected.confidence,
            moved: false,
          })
        }
        if (cancelled) return
        if (loaded.length === 0) throw new Error("Could not open the receipt")
        setSourceIsPdf(type.includes("pdf"))
        setPages(loaded)
        setAccepted(loaded.map(() => null))
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open the receipt")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src])

  async function rotate() {
    if (!page || lockRef.current) return
    lockRef.current = true
    setTurning(true)
    setNote(null)
    try {
      const source = rotateRaster(page.source, 1)
      const detected = await cropReceipt(source)
      setPages((current) =>
        current.map((item, pageIndex) =>
          pageIndex === index
            ? {
                ...item,
                source,
                corners: detected.corners,
                autoCorners: detected.corners,
                autoMethod: detected.method,
                confidence: detected.confidence,
                moved: false,
              }
            : item,
        ),
      )
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Could not rotate the photo")
    } finally {
      lockRef.current = false
      setTurning(false)
    }
  }

  async function commit(choice: "crop" | "original") {
    if (!page || lockRef.current) return
    const method = choice === "original" ? "none" : resolveMethod(page)
    if (choice === "crop" && method === "none") {
      setNote("Drag the four corners onto the receipt, or use the original photo.")
      return
    }
    lockRef.current = true
    setWorking(true)
    setNote(null)
    try {
      const corners = method === "none" ? fullFrameCorners(page.source.width, page.source.height) : page.corners
      const rendered = renderCrop(page.source, corners, method, page.confidence)
      const blob = await rasterToJpegBlob(rendered.image, 0.85)
      const record: Accepted = {
        blob,
        corners: rendered.corners,
        method: rendered.method,
        image: index === 0 ? rendered.image : null,
      }
      const next = accepted.slice()
      next[index] = record
      setAccepted(next)
      if (index < pages.length - 1) {
        setIndex(index + 1)
        setWorking(false)
        lockRef.current = false
        return
      }
      const complete = next.filter((item): item is Accepted => item != null)
      const first = complete[0]
      if (complete.length !== pages.length || !first?.image) throw new Error("A page is missing")
      setSaving(true)
      const asPdf = sourceIsPdf || complete.length > 1
      const fileBlob = asPdf ? await imagesToPdf(complete.map((item) => item.blob)) : first.blob
      const thumb = await thumbnailBlob(first.image)
      const body = new FormData()
      body.set("projectId", projectId)
      body.set("expenseId", expenseId)
      body.set("pageCount", String(complete.length))
      body.set("cropMethod", combinedMethod(complete.map((item) => item.method)))
      body.set("cropCorners", JSON.stringify(complete.map((item) => item.corners)))
      body.set(
        "file",
        new File([fileBlob], asPdf ? "receipt.pdf" : "receipt.jpg", {
          type: asPdf ? "application/pdf" : "image/jpeg",
        }),
      )
      body.set("thumb", new File([thumb], "thumb.webp", { type: "image/webp" }))
      const result = await replaceScannedFile(body)
      if (result.error) throw new Error(result.error)
      toast.success("Saved the cropped receipt")
      onSaved()
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Could not save the cropped receipt")
      setSaving(false)
      setWorking(false)
      lockRef.current = false
    }
  }

  if (error) {
    return (
      <Shell title="Crop receipt" onClose={onClose}>
        <p className="max-w-sm text-center text-sm text-red-700">{error}</p>
      </Shell>
    )
  }

  if (!page) {
    return (
      <Shell title="Crop receipt" onClose={onClose}>
        <p className="text-sm text-muted-foreground">Finding the receipt…</p>
      </Shell>
    )
  }

  return (
    <ReceiptCropper
      image={page.source}
      corners={page.corners}
      needsManualCrop={page.autoMethod === "none" && !page.moved}
      busy={saving || working || turning}
      busyLabel={saving ? "Saving…" : null}
      note={note}
      pageLabel={pages.length > 1 ? `Page ${index + 1} of ${pages.length}` : null}
      onCancel={onClose}
      onChange={(corners) => {
        setPages((current) =>
          current.map((item, pageIndex) => (pageIndex === index ? { ...item, corners, moved: true } : item)),
        )
      }}
      onUseCrop={() => void commit("crop")}
      onResetAuto={() => {
        setNote(null)
        setPages((current) =>
          current.map((item, pageIndex) =>
            pageIndex === index ? { ...item, corners: item.autoCorners, moved: false } : item,
          ),
        )
      }}
      onUseOriginal={() => void commit("original")}
      onRotate={() => void rotate()}
    />
  )
}
