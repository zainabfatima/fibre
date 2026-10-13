"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { replaceScannedFile } from "@/app/actions/expenses"
import {
  decodeReceiptFile,
  rasterToJpegBlob,
  rotateRaster,
  scaleLongSide,
  type Raster,
} from "@/lib/receiptCrop"
import { imagesToPdf, renderPdf } from "@/lib/scanner/pdf"

type LoadedReceipt = {
  pages: Raster[]
  pdf: boolean
}

export type ReceiptTurn = {
  expenseId: string | null
  quarters: number
  previewUrl: string | null
  busy: "rotate" | "save" | null
  busyExpenseId: string | null
  rotate: (expenseId: string) => Promise<void>
  save: (projectId: string, expenseId: string) => Promise<boolean>
}

export function receiptTurnSrc(turn: ReceiptTurn, expenseId: string, thumbUrl: string | null) {
  if (turn.expenseId === expenseId && turn.previewUrl) return turn.previewUrl
  return thumbUrl
}

export function useReceiptTurn(): ReceiptTurn {
  const [expenseId, setExpenseId] = useState<string | null>(null)
  const [quarters, setQuarters] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<"rotate" | "save" | null>(null)
  const [busyExpenseId, setBusyExpenseId] = useState<string | null>(null)
  const loadedRef = useRef<({ id: string } & LoadedReceipt) | null>(null)
  const quartersRef = useRef(0)
  const previewRef = useRef<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  function showPreview(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
    setPreviewUrl(url)
  }

  async function rotate(nextId: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy("rotate")
    setBusyExpenseId(nextId)
    try {
      if (!loadedRef.current || loadedRef.current.id !== nextId) {
        loadedRef.current = { id: nextId, ...(await loadReceiptRasters(`/r/${nextId}`)) }
        quartersRef.current = 0
      }
      const loaded = loadedRef.current
      const next = (quartersRef.current + 1) % 4
      quartersRef.current = next
      setExpenseId(nextId)
      setQuarters(next)
      if (next === 0) {
        showPreview(null)
        return
      }
      const turned = rotateRaster(loaded.pages[0], next)
      const blob = await rasterToJpegBlob(scaleLongSide(turned, 1600), 0.85)
      showPreview(URL.createObjectURL(blob))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not rotate the photo")
    } finally {
      busyRef.current = false
      setBusy(null)
      setBusyExpenseId(null)
    }
  }

  async function save(projectId: string, nextId: string) {
    const loaded = loadedRef.current
    const turns = quartersRef.current
    if (busyRef.current || !loaded || loaded.id !== nextId || turns % 4 === 0) return false
    busyRef.current = true
    setBusy("save")
    setBusyExpenseId(nextId)
    setExpenseId(nextId)
    try {
      const turned = loaded.pages.map((page) => rotateRaster(page, turns))
      await uploadRotatedReceipt(projectId, nextId, turned, loaded.pdf)
      const blob = await rasterToJpegBlob(scaleLongSide(turned[0], 1600), 0.85)
      showPreview(URL.createObjectURL(blob))
      loadedRef.current = null
      quartersRef.current = 0
      setQuarters(0)
      toast.success("Saved the new orientation")
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the receipt")
      return false
    } finally {
      busyRef.current = false
      setBusy(null)
      setBusyExpenseId(null)
    }
  }

  return { expenseId, quarters, previewUrl, busy, busyExpenseId, rotate, save }
}

export function ReceiptRotateSave({
  projectId,
  expenseId,
  className,
  turn,
  onRotate,
  onSaved,
}: {
  projectId: string
  expenseId: string
  className: string
  turn: ReceiptTurn
  onRotate?: () => void
  onSaved?: () => void
}) {
  const pending = turn.expenseId === expenseId && turn.quarters % 4 !== 0
  const active = turn.busyExpenseId === expenseId ? turn.busy : null
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={active != null}
        onClick={() => {
          onRotate?.()
          void turn.rotate(expenseId)
        }}
      >
        {active === "rotate" ? "Rotating…" : "Rotate"}
      </button>
      {pending ? (
        <button
          type="button"
          className={className}
          disabled={active != null}
          onClick={() => {
            void turn.save(projectId, expenseId).then((saved) => {
              if (saved) onSaved?.()
            })
          }}
        >
          {active === "save" ? "Saving…" : "Save"}
        </button>
      ) : null}
    </>
  )
}

export async function loadReceiptRasters(src: string): Promise<LoadedReceipt> {
  const response = await fetch(src, { cache: "no-store" })
  if (!response.ok) throw new Error("Could not open the receipt")
  const blob = await response.blob()
  const type = `${response.headers.get("content-type") ?? ""} ${blob.type}`.toLowerCase()
  if (type.includes("pdf")) {
    const rendered = await renderPdf(blob, { maxLongSide: 2400 })
    const pages: Raster[] = []
    for (const item of rendered.pages) pages.push(await decodeReceiptFile(item.blob))
    if (pages.length === 0) throw new Error("Could not open the receipt")
    return { pages, pdf: true }
  }
  return { pages: [await decodeReceiptFile(blob)], pdf: false }
}

export async function uploadRotatedReceipt(projectId: string, expenseId: string, pages: Raster[], pdf: boolean) {
  if (pages.length === 0) throw new Error("Could not save the receipt image")
  const jpegs = await Promise.all(pages.map((page) => rasterToJpegBlob(page, 0.92)))
  const asPdf = pdf || jpegs.length > 1
  const fileBlob = asPdf ? await imagesToPdf(jpegs) : jpegs[0]
  const thumb = await thumbnailBlob(pages[0])
  const body = new FormData()
  body.set("projectId", projectId)
  body.set("expenseId", expenseId)
  body.set("pageCount", String(pages.length))
  body.set(
    "file",
    new File([fileBlob], asPdf ? "receipt.pdf" : "receipt.jpg", {
      type: asPdf ? "application/pdf" : "image/jpeg",
    }),
  )
  body.set("thumb", new File([thumb], "thumb.webp", { type: "image/webp" }))
  const result = await replaceScannedFile(body)
  if (result.error) throw new Error(result.error)
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
  const context = thumb.getContext("2d")
  if (!context) throw new Error("Could not make a thumbnail")
  context.drawImage(full, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => thumb.toBlob(resolve, "image/webp", 0.75))
  if (!blob) throw new Error("Could not make a thumbnail")
  return blob
}
