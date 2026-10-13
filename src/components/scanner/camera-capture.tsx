"use client"

import { useEffect, useRef, useState } from "react"

import { decodeReceiptFile, fullFrameCorners, loadOpenCv, rasterToJpegBlob, renderCrop } from "@/lib/receiptCrop"
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
const SCANNER_WAIT_MS = 1500
const CLEAN_LONG_SIDE = 2000

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
  const cvPromiseRef = useRef<Promise<ScannerCv | null> | null>(null)
  const cvStateRef = useRef<"loading" | "ready" | "failed">("loading")
  const cameraReadyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [status, setStatus] = useState("Opening the camera")

  function stopCamera() {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function loadScanner() {
    if (!cvPromiseRef.current) {
      cvPromiseRef.current = loadOpenCv(Number.POSITIVE_INFINITY)
        .then((cv) => (cv as unknown as ScannerCv | null) ?? null)
        .catch(() => null)
    }
    return cvPromiseRef.current
  }

  function onScannerReady(cv: ScannerCv | null) {
    if (cv) cvRef.current = cv
    cvStateRef.current = cv ? "ready" : "failed"
    if (!cameraReadyRef.current || busyRef.current || deliveredRef.current) return
    setStatus(cv ? "Looking for the receipt" : "Tap Capture now.")
  }

  async function scannerWhenReady(waitMs: number) {
    if (cvRef.current) return cvRef.current
    const cv = await Promise.race([
      loadScanner(),
      new Promise<ScannerCv | null>((resolve) => {
        window.setTimeout(() => resolve(cvRef.current), waitMs)
      }),
    ])
    if (cv) cvRef.current = cv
    return cvRef.current
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!window.isSecureContext) {
      const timer = window.setTimeout(() => setError("The camera needs a secure https connection."), 0)
      return () => window.clearTimeout(timer)
    }
    let cancelled = false
    function previewStatus() {
      if (cvStateRef.current === "ready") return "Looking for the receipt"
      if (cvStateRef.current === "failed") return "Tap Capture now."
      return "Starting edge detection"
    }
    async function openCamera() {
      try {
        const stream = await openRearCamera()
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
              width: { ideal: Math.min(1920, caps.width.max) },
              height: { ideal: Math.min(1920, caps.height.max) },
            })
          } catch {
            // Live preview is enough when the phone rejects a second constraint.
          }
        }
        const player = videoRef.current
        if (!player) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        player.srcObject = stream
        await playCamera(player)
        if (cancelled) {
          stopCamera()
          return
        }
        cameraReadyRef.current = true
        setReady(true)
        if (!busyRef.current && !deliveredRef.current) setStatus(previewStatus())
        // Edge detection starts after the live preview is showing. Missing cv is not a camera error.
        void loadScanner().then((cv) => {
          if (!cancelled) onScannerReady(cv)
        })
      } catch (cause) {
        if (!cancelled) {
          stopCamera()
          setError(cause instanceof Error ? cause.message : "The camera is not available. Choose a photo instead.")
          void loadScanner().then((cv) => {
            if (!cancelled) onScannerReady(cv)
          })
        }
      }
    }
    void openCamera()
    return () => {
      cancelled = true
      stopCamera()
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
      try {
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
      } catch {
        // One bad frame must not close the camera.
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
    if (!video || video.videoWidth < 2) return
    if (!manual && !cvRef.current) return
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
      let cv = cvRef.current
      if (!cv && manual && cvStateRef.current !== "failed") {
        setStatus("Finishing the scanner")
        cv = await scannerWhenReady(SCANNER_WAIT_MS)
      }
      const deliver = (blob: Blob, photo: Blob, verified: boolean) => {
        if (deliveredRef.current) return
        deliveredRef.current = true
        onCapture({ blob, original: photo, verified })
      }
      if (cv) {
        try {
          const scan = await processReceipt(cv, frame)
          if (manual || scan.verified || scan.corners == null) {
            deliver(scan.blob, original, scan.corners == null ? false : scan.verified)
            return
          }
          const previous = bestRef.current
          if (!previous || scan.borderDark < previous.scan.borderDark) bestRef.current = { scan, original }
          attemptsRef.current += 1
          if (attemptsRef.current >= AUTO_TRIES) {
            const best = bestRef.current ?? { scan, original }
            deliver(best.scan.blob, best.original, false)
            return
          }
          setStatus(`Still seeing the table. Trying again (${attemptsRef.current} of ${AUTO_TRIES}).`)
          stableRef.current = 0
          return
        } catch {
          // OpenCV ran but this frame could not be warped. Keep the photo.
        }
      }
      deliver(await cleanedFullFrame(frame), original, false)
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
    if (busyRef.current || deliveredRef.current) return
    busyRef.current = true
    setCapturing(true)
    setStatus("Finding the receipt")
    try {
      const canvas = await fileToCanvas(file)
      const cv = cvRef.current ?? (await scannerWhenReady(SCANNER_WAIT_MS))
      if (cv) {
        try {
          const scan = await processReceipt(cv, canvas)
          if (deliveredRef.current) return
          deliveredRef.current = true
          onCapture({ blob: scan.blob, original: file, verified: scan.verified })
          return
        } catch {
          // Fall through to a cleaned full-frame photo.
        }
      }
      const blob = await cleanedFullFrame(canvas)
      if (deliveredRef.current) return
      deliveredRef.current = true
      onCapture({ blob, original: file, verified: false })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This photo could not be opened.")
    } finally {
      busyRef.current = false
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
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            controls={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
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
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-white/15 px-4 text-sm">
              Choose a photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void useChosenPhoto(file)
                }}
              />
            </label>
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

async function playCamera(video: HTMLVideoElement) {
  video.muted = true
  video.defaultMuted = true
  video.autoplay = true
  video.playsInline = true
  video.controls = false
  video.setAttribute("muted", "true")
  video.setAttribute("autoplay", "true")
  video.setAttribute("playsinline", "true")
  video.setAttribute("webkit-playsinline", "true")
  const waited = new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth > 0) {
      resolve()
      return
    }
    let timer = 0
    const finish = () => {
      window.clearTimeout(timer)
      video.removeEventListener("loadedmetadata", onReady)
      video.removeEventListener("loadeddata", onReady)
      video.removeEventListener("playing", onReady)
      video.removeEventListener("error", onError)
    }
    const onReady = () => {
      if (video.videoWidth < 1 && video.readyState < 2) return
      finish()
      resolve()
    }
    const onError = () => {
      finish()
      reject(new Error("The camera is not available. Choose a photo instead."))
    }
    timer = window.setTimeout(() => {
      finish()
      if (video.videoWidth > 0 || video.readyState >= 2) resolve()
      else reject(new Error("The camera is not available. Choose a photo instead."))
    }, 8000)
    video.addEventListener("loadedmetadata", onReady)
    video.addEventListener("loadeddata", onReady)
    video.addEventListener("playing", onReady)
    video.addEventListener("error", onError)
  })
  try {
    await video.play()
  } catch {
    // Safari can start playback from the muted autoPlay attribute instead of play().
  }
  await waited
}

async function openRearCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("The camera is not available. Choose a photo instead.")
  }
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ]
  let last: unknown
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      return await preferRearCamera(stream)
    } catch (cause) {
      last = cause
    }
  }
  throw last instanceof Error ? last : new Error("The camera is not available. Choose a photo instead.")
}

async function preferRearCamera(stream: MediaStream) {
  const current = stream.getVideoTracks()[0]
  if (current?.getSettings?.().facingMode === "environment") return stream
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const rear = devices.find(
      (device) => device.kind === "videoinput" && /back|rear|environment/i.test(device.label),
    )
    if (!rear?.deviceId || rear.deviceId === current?.getSettings?.().deviceId) return stream
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: rear.deviceId } },
    })
    stream.getTracks().forEach((track) => track.stop())
    return next
  } catch {
    return stream
  }
}

async function cleanedFullFrame(canvas: HTMLCanvasElement) {
  const longSide = Math.max(canvas.width, canvas.height)
  const scale = Math.min(1, CLEAN_LONG_SIDE / Math.max(longSide, 1))
  const width = Math.max(1, Math.round(canvas.width * scale))
  const height = Math.max(1, Math.round(canvas.height * scale))
  const fitted = document.createElement("canvas")
  fitted.width = width
  fitted.height = height
  const context = fitted.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Could not read the camera")
  context.drawImage(canvas, 0, 0, width, height)
  const image = context.getImageData(0, 0, width, height)
  const cleaned = renderCrop({ width, height, data: image.data }, fullFrameCorners(width, height), "none")
  return rasterToJpegBlob(cleaned.image, 0.85)
}
