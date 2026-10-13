"use client"

import { useEffect, useRef, useState } from "react"

import { decodeReceiptFile, loadOpenCv } from "@/lib/receiptCrop"
import {
  detectReceiptQuad,
  processReceipt,
  quadIsStable,
  quadShift,
  type ProcessedReceipt,
  type ScannerCv,
  type ScanPoint,
} from "@/lib/scanner/process-receipt"

export type CameraScan = {
  blob: Blob
  original: Blob
  verified: boolean
}

const DETECT_LONG_SIDE = 640
const DETECT_INTERVAL_MS = 125
const STABLE_FRAMES = 10
const AUTO_TRIES = 3

export function CameraCapture({
  pageNumber,
  onCapture,
  onClose,
}: {
  pageNumber: number
  onCapture: (scan: CameraScan) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sampleRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cvRef = useRef<ScannerCv | null>(null)
  const busyRef = useRef(false)
  const deliveredRef = useRef(false)
  const stableRef = useRef(0)
  const attemptsRef = useRef(0)
  const lastQuadRef = useRef<ScanPoint[] | null>(null)
  const bestRef = useRef<{ scan: ProcessedReceipt; original: Blob } | null>(null)
  const captureRef = useRef<(manual: boolean) => Promise<void>>(async () => {})
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [status, setStatus] = useState("Opening the camera")

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!window.isSecureContext) {
      const timer = window.setTimeout(() => setError("The camera needs a secure https connection."), 0)
      return () => window.clearTimeout(timer)
    }
    let cancelled = false
    async function start() {
      try {
        const cv = await loadOpenCv()
        if (!cv) throw new Error("The scanner could not load. Choose a photo instead.")
        if (cancelled) return
        cvRef.current = cv as unknown as ScannerCv
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 4096 },
            height: { ideal: 4096 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = track?.getCapabilities?.()
        if (track && caps?.width?.max && caps.height?.max) {
          try {
            await track.applyConstraints({
              width: { ideal: caps.width.max },
              height: { ideal: caps.height.max },
            })
          } catch {
            // The ideal 4096 request is enough when the phone rejects a second constraint.
          }
        }
        if (!video) return
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        if (!cancelled) {
          setReady(true)
          setStatus("Looking for the receipt")
        }
      } catch (cause) {
        if (!cancelled) {
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          setError(cause instanceof Error ? cause.message : "The camera is not available. Choose a photo instead.")
        }
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let stopped = false
    let timer = 0
    const tick = () => {
      if (stopped) return
      timer = window.setTimeout(() => void run(), DETECT_INTERVAL_MS)
    }
    async function run() {
      if (stopped) return
      tick()
      const cv = cvRef.current
      const video = videoRef.current
      if (!cv || !video || busyRef.current || deliveredRef.current || video.videoWidth < 2) return
      const longSide = Math.max(video.videoWidth, video.videoHeight)
      const scale = Math.min(1, DETECT_LONG_SIDE / longSide)
      const sample = sampleRef.current ?? document.createElement("canvas")
      sampleRef.current = sample
      sample.width = Math.max(1, Math.round(video.videoWidth * scale))
      sample.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = sample.getContext("2d", { willReadFrequently: true })
      if (!context) return
      context.drawImage(video, 0, 0, sample.width, sample.height)
      const mat = cv.imread(sample)
      try {
        const found = detectReceiptQuad(cv, mat)
        if (!found) {
          stableRef.current = 0
          lastQuadRef.current = null
          drawQuad(null)
          setStatus("Looking for the receipt")
          return
        }
        const corners = found.corners.map((point) => ({ x: point.x / scale, y: point.y / scale }))
        drawQuad(corners)
        const previous = lastQuadRef.current
        if (previous && quadIsStable(quadShift(previous, corners, video.videoWidth))) stableRef.current += 1
        else stableRef.current = 1
        lastQuadRef.current = corners
        setStatus(stableRef.current >= STABLE_FRAMES ? "Capturing" : "Hold steady")
        if (stableRef.current >= STABLE_FRAMES) {
          stableRef.current = 0
          void captureRef.current(false)
        }
      } finally {
        mat.delete()
      }
    }
    tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [ready])

  function drawQuad(corners: ScanPoint[] | null) {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return
    const width = video.clientWidth
    const height = video.clientHeight
    if (width < 2 || height < 2) return
    const ratio = window.devicePixelRatio || 1
    overlay.width = Math.round(width * ratio)
    overlay.height = Math.round(height * ratio)
    const context = overlay.getContext("2d")
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    if (!corners) return
    const view = corners.map((point) => sourceToView(point, video))
    context.beginPath()
    context.moveTo(view[0].x, view[0].y)
    view.slice(1).forEach((point) => context.lineTo(point.x, point.y))
    context.closePath()
    context.fillStyle = "rgba(34,197,94,0.18)"
    context.strokeStyle = "#22c55e"
    context.lineWidth = 3
    context.fill()
    context.stroke()
  }

  async function capture(manual: boolean) {
    if (busyRef.current || deliveredRef.current) return
    const video = videoRef.current
    const cv = cvRef.current
    if (!video || !cv || video.videoWidth < 2) return
    busyRef.current = true
    setCapturing(true)
    setStatus(manual ? "Capturing" : "Cropping the receipt")
    try {
      const frame = document.createElement("canvas")
      frame.width = video.videoWidth
      frame.height = video.videoHeight
      const context = frame.getContext("2d", { willReadFrequently: true })
      if (!context) throw new Error("Could not read the camera")
      context.drawImage(video, 0, 0, frame.width, frame.height)
      const original = await canvasToJpeg(frame, 0.85)
      const scan = await processReceipt(cv, frame)
      const deliver = (chosen: ProcessedReceipt, photo: Blob, verified: boolean) => {
        if (deliveredRef.current) return
        deliveredRef.current = true
        onCapture({ blob: chosen.blob, original: photo, verified })
      }
      if (manual || scan.verified || scan.corners == null) {
        deliver(scan, original, scan.corners == null ? false : scan.verified)
        return
      }
      const previous = bestRef.current
      if (!previous || scan.borderDark < previous.scan.borderDark) bestRef.current = { scan, original }
      attemptsRef.current += 1
      if (attemptsRef.current >= AUTO_TRIES) {
        const best = bestRef.current ?? { scan, original }
        deliver(best.scan, best.original, false)
        return
      }
      setStatus(`Still seeing the table. Trying again (${attemptsRef.current} of ${AUTO_TRIES}).`)
      stableRef.current = 0
    } catch (cause) {
      stopCamera()
      setError(cause instanceof Error ? cause.message : "The photo could not be taken.")
    } finally {
      busyRef.current = false
      setCapturing(false)
    }
  }

  captureRef.current = capture

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torch
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorch(next)
    } catch {
      setStatus("The flash is not available on this phone.")
    }
  }

  async function useChosenPhoto(file: File) {
    setCapturing(true)
    setStatus("Finding the receipt")
    try {
      const cv = cvRef.current ?? ((await loadOpenCv()) as unknown as ScannerCv | null)
      if (!cv) throw new Error("The scanner could not load.")
      const canvas = await fileToCanvas(file)
      const scan = await processReceipt(cv, canvas)
      if (deliveredRef.current) return
      deliveredRef.current = true
      onCapture({ blob: scan.blob, original: file, verified: scan.verified })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This photo could not be opened.")
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p>{error}</p>
          <label className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">
            Choose a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void useChosenPhoto(file)
              }}
            />
          </label>
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm underline">
            Close
          </button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto flex items-center justify-between">
              <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
                Close
              </button>
              <span className="rounded-full bg-black/50 px-3 py-1 text-sm">Page {pageNumber}</span>
              <button type="button" onClick={() => void toggleTorch()} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
                {torch ? "Flash on" : "Flash"}
              </button>
            </div>
            <p className="mx-auto mt-3 max-w-sm rounded-lg bg-black/50 px-3 py-2 text-center text-sm">{status}</p>
          </div>
          <div className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-3">
            <button
              type="button"
              disabled={!ready || capturing}
              onClick={() => void capture(true)}
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Capture now
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function sourceToView(point: ScanPoint, video: HTMLVideoElement) {
  const viewWidth = video.clientWidth
  const viewHeight = video.clientHeight
  const scale = Math.max(viewWidth / video.videoWidth, viewHeight / video.videoHeight)
  const displayedWidth = video.videoWidth * scale
  const displayedHeight = video.videoHeight * scale
  return {
    x: point.x * scale + (viewWidth - displayedWidth) / 2,
    y: point.y * scale + (viewHeight - displayedHeight) / 2,
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the photo"))), "image/jpeg", quality)
  })
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
