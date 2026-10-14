"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { decodeReceiptFile, loadOpenCv, rasterToJpegBlob, type Raster } from "@/lib/receiptCrop"
import {
  flattenPage,
  processReceipt,
  rotateGray,
  trimReceiptFrame,
  uprightQuarter,
  type ScannerCv,
} from "@/lib/scanner/process-receipt"

export type CameraScan = {
  blob: Blob
  original: Blob
  verified: boolean
}

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"

function emptySubscribe() {
  return () => {}
}

function clientSnapshot() {
  return true
}

function serverSnapshot() {
  return false
}

const FRAME_LONG_SIDE = 2000

export function ReceiptPhotoButton({
  label,
  className,
  disabled,
  onPhoto,
  onVideo,
}: {
  label: string
  className?: string
  disabled?: boolean
  onPhoto: (file: File) => void
  onVideo?: () => void
}) {
  return (
    <label className={`relative ${disabled ? "pointer-events-none opacity-60" : ""} ${className ?? ""}`}>
      {label}
      <input
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        disabled={disabled}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          if (file.type.startsWith("video/")) {
            onVideo?.()
            return
          }
          onPhoto(file)
        }}
      />
    </label>
  )
}

export function CameraCapture({
  pageNumber,
  onCapture,
  onClose,
}: {
  pageNumber: number
  onCapture: (scan: CameraScan) => void
  onClose: () => void
}) {
  const busyRef = useRef(false)
  const mounted = useSyncExternalStore(emptySubscribe, clientSnapshot, serverSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("Take a photo of the receipt")

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    void loadOpenCv(Number.POSITIVE_INFINITY)
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  async function takePhoto(file: File) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setStatus("Setting the frame to the receipt")
    try {
      const canvas = fitCanvas(await fileToCanvas(file), FRAME_LONG_SIDE)
      const cv = await loadOpenCv(12000)
      if (cv) {
        const scan = await processReceipt(cv as unknown as ScannerCv, canvas)
        onCapture({ blob: scan.blob, original: file, verified: scan.verified })
        return
      }
      onCapture({ blob: await frameStill(canvas), original: file, verified: false })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This photo could not be opened.")
      setStatus("Take a photo of the receipt")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const screen = (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="min-h-11 touch-manipulation rounded-lg bg-white/15 px-3 text-sm">
          Close
        </button>
        <span className="rounded-full bg-white/15 px-3 py-1 text-sm">Page {pageNumber}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-sm text-base">{error ?? status}</p>
        <p className="max-w-sm text-sm text-white/70">
          Photo only. The frame is set to the paper, so the table and glare stay out.
        </p>
      </div>
      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <ReceiptPhotoButton
          label={busy ? "Cropping the receipt…" : "Take photo"}
          disabled={busy}
          onPhoto={(file) => void takePhoto(file)}
          onVideo={() => setError("Take a photo of the receipt. Video is not used.")}
          className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground"
        />
      </div>
    </div>
  )

  if (!mounted) return null
  return createPortal(screen, document.body)
}

async function fileToCanvas(file: Blob) {
  const raster = await decodeReceiptFile(file)
  const canvas = document.createElement("canvas")
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not read the photo")
  context.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  return canvas
}

function fitCanvas(canvas: HTMLCanvasElement, longSide: number) {
  const long = Math.max(canvas.width, canvas.height)
  if (long <= longSide) return canvas
  const scale = longSide / long
  const fitted = document.createElement("canvas")
  fitted.width = Math.max(1, Math.round(canvas.width * scale))
  fitted.height = Math.max(1, Math.round(canvas.height * scale))
  const context = fitted.getContext("2d")
  if (!context) return canvas
  context.drawImage(canvas, 0, 0, fitted.width, fitted.height)
  return fitted
}

async function frameStill(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Could not read the photo")
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let pixel = 0, index = 0; pixel < gray.length; pixel += 1, index += 4) {
    gray[pixel] = Math.round(image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114)
  }
  const framed = trimReceiptFrame(gray, canvas.width, canvas.height)
  const turned = rotateGray(framed.data, framed.width, framed.height, uprightQuarter(framed.data, framed.width, framed.height))
  flattenPage(turned.data, turned.width, turned.height)
  return rasterToJpegBlob(grayRaster(turned.data, turned.width, turned.height), 0.9)
}

function grayRaster(pixels: Uint8Array, width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index]
    const offset = index * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  return { width, height, data }
}
