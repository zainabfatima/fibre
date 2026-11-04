"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { CornerAdjuster } from "@/components/CornerAdjuster"
import { glareRatioInQuad, insetCorners } from "@/lib/receiptScanner/geometry"
import {
  canvasFromBlob,
  canvasToJpeg,
  detectCanvas,
  renderCanvas,
} from "@/lib/receiptScanner/session"
import type { Point, ScanMode, ScanReceiptResult } from "@/lib/receiptScanner/types"

export type UsedScan = ScanReceiptResult & {
  originalBlob: Blob
  warpedBlob: Blob | null
  method: "auto" | "manual" | "none"
}

export function ReceiptCamera({
  file = null,
  onCancel,
  onUse,
  onFinished,
}: {
  file?: File | null
  onCancel: () => void
  onUse: (result: UsedScan) => void
  onFinished?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stableRef = useRef<{ corners: Point[] | null; count: number }>({ corners: null, count: 0 })
  const capturingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState("Place receipt on a dark flat surface")
  const [torchSupported, setTorchSupported] = useState(false)
  const [torch, setTorch] = useState(false)
  const [ready, setReady] = useState(false)
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null)
  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [detected, setDetected] = useState(false)
  const [method, setMethod] = useState<"auto" | "manual" | "none">("none")
  const [mode, setMode] = useState<ScanMode>("scan")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ScanReceiptResult | null>(null)
  const [warpedBlob, setWarpedBlob] = useState<Blob | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<File[]>([])
  const openedFile = useRef<File | null>(null)
  const openFileRef = useRef<(next: File) => Promise<void>>(async () => {})
  const captureRef = useRef<() => Promise<void>>(async () => {})
  const secure = useSyncExternalStore(
    () => () => {},
    () => window.isSecureContext,
    () => true,
  )

  useEffect(() => {
    if (!file || openedFile.current === file) return
    openedFile.current = file
    void openFileRef.current(file)
  }, [file])

  useEffect(() => {
    if (shot || !secure) return
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
        setTorchSupported(Boolean(capabilities?.torch))
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) setError("The camera is not available. Choose a photo instead.")
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [shot, secure])

  useEffect(() => {
    if (!ready || shot) return
    let timer = 0
    let stopped = false
    let busyFrame = false
    const tick = async () => {
      if (stopped) return
      timer = window.setTimeout(tick, 150)
      const video = videoRef.current
      if (!video || busyFrame || capturingRef.current || video.videoWidth < 2) return
      busyFrame = true
      try {
        const frame = document.createElement("canvas")
        frame.width = 640
        frame.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * 640))
        const context = frame.getContext("2d", { willReadFrequently: true })
        if (!context) return
        context.drawImage(video, 0, 0, frame.width, frame.height)
        const found = await detectCanvas(frame)
        if (stopped) return
        const image = context.getImageData(0, 0, frame.width, frame.height)
        const glare = found ? glareRatioInQuad(image, found) : 0
        drawQuad(found, glare > 0.03 ? "#f97316" : "#16a34a")
        if (!found) {
          stableRef.current = { corners: null, count: 0 }
          setHint("Place receipt on a dark flat surface")
          return
        }
        if (glare > 0.03) {
          stableRef.current = { corners: found, count: 0 }
          setHint("Glare – tilt phone slightly")
          return
        }
        const stable = stableRef.current
        const held =
          stable.corners != null &&
          found.every((point, index) => {
            const previous = stable.corners?.[index]
            return previous != null && Math.hypot(point.x - previous.x, point.y - previous.y) < frame.width * 0.02
          })
        const count = held ? stable.count + 1 : 1
        stableRef.current = { corners: found, count }
        setHint(count >= 8 ? "Holding still" : "Receipt found")
        if (count >= 8) void captureRef.current()
      } finally {
        busyFrame = false
      }
    }
    timer = window.setTimeout(tick, 150)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [ready, shot])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function drawQuad(points: Point[] | null, color: string) {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return
    const bounds = overlay.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    overlay.width = Math.max(1, Math.round(bounds.width * ratio))
    overlay.height = Math.max(1, Math.round(bounds.height * ratio))
    const context = overlay.getContext("2d")
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, bounds.width, bounds.height)
    if (!points || video.videoWidth < 2) return
    const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight)
    const offsetX = (bounds.width - video.videoWidth * scale) / 2
    const offsetY = (bounds.height - video.videoHeight * scale) / 2
    const frameScaleX = video.videoWidth / 640
    const frameScaleY = video.videoHeight / Math.max(1, Math.round((video.videoHeight / video.videoWidth) * 640))
    context.strokeStyle = color
    context.lineWidth = 3
    context.beginPath()
    points.forEach((point, index) => {
      const x = offsetX + point.x * frameScaleX * scale
      const y = offsetY + point.y * frameScaleY * scale
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.stroke()
  }

  async function capture() {
    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video || !track || capturingRef.current) return
    capturingRef.current = true
    stableRef.current = { corners: null, count: 0 }
    setBusy(true)
    try {
      const photo = await takePhoto(track, video)
      const canvas = photo instanceof HTMLCanvasElement ? photo : await canvasFromBlob(photo)
      await showSource(canvas)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The photo could not be taken.")
    } finally {
      capturingRef.current = false
      setBusy(false)
    }
  }

  async function openFile(next: File) {
    setBusy(true)
    setError(null)
    try {
      await showSource(await canvasFromBlob(next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This photo could not be opened")
    } finally {
      setBusy(false)
    }
  }

  async function showSource(canvas: HTMLCanvasElement) {
    const found = await detectCanvas(canvas)
    const original = await canvasToJpeg(canvas)
    setShot(canvas)
    setOriginalBlob(original)
    setCorners(found)
    setDetected(Boolean(found))
    setMethod(found ? "auto" : "none")
    setAdjusting(!found)
    await refresh(canvas, found, mode, Boolean(found))
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  async function refresh(canvas: HTMLCanvasElement, nextCorners: Point[] | null, nextMode: ScanMode, wasDetected: boolean) {
    const rendered = await renderCanvas(canvas, nextCorners, nextMode, false)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(rendered.blob)
    setPreviewUrl(url)
    setWarpedBlob(rendered.warpedBlob)
    setResult({ ...rendered, detected: wasDetected && Boolean(nextCorners) })
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torch
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorch(next)
    } catch {
      setTorchSupported(false)
    }
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setShot(null)
    setResult(null)
    setCorners(null)
    setDetected(false)
    setAdjusting(false)
    setReady(false)
    stableRef.current = { corners: null, count: 0 }
  }

  function useScan() {
    if (!result || !originalBlob) return
    const saved = result
    const original = originalBlob
    const warped = warpedBlob
    onUse({ ...saved, originalBlob: original, warpedBlob: warped, method })
    if (queue.length > 0) {
      const [next, ...rest] = queue
      setQueue(rest)
      retake()
      if (next) void openFile(next)
      return
    }
    onFinished?.()
  }

  openFileRef.current = openFile
  captureRef.current = capture

  const adjustCorners = corners ?? (shot ? insetCorners(shot.width, shot.height) : [])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
          Close
        </button>
        <p className="text-sm">{shot ? (detected ? "Receipt found" : "Adjust the corners") : hint}</p>
        {torchSupported && !shot ? (
          <button type="button" onClick={() => void toggleTorch()} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
            {torch ? "Torch on" : "Torch"}
          </button>
        ) : (
          <span className="w-16" />
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {shot && adjusting ? (
          <div className="h-full overflow-auto bg-background p-4 text-foreground">
            <CornerAdjuster
              image={shot}
              corners={adjustCorners}
              busy={busy}
              onChange={setCorners}
              onCancel={() => setAdjusting(false)}
                onConfirm={() => {
                setBusy(true)
                const chosen = corners ?? adjustCorners
                void refresh(shot, chosen, mode, true)
                  .then(() => {
                    setCorners(chosen)
                    setMethod("manual")
                    setDetected(true)
                    setAdjusting(false)
                  })
                  .finally(() => setBusy(false))
              }}
            />
          </div>
        ) : shot && previewUrl ? (
          <div className="flex h-full flex-col bg-white text-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Scanned receipt" className="min-h-0 flex-1 bg-white object-contain" />
            <div className="grid gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`min-h-11 rounded-lg text-sm ${mode === "scan" ? "bg-primary text-primary-foreground" : "border border-input"}`} onClick={() => { setMode("scan"); void refresh(shot, corners, "scan", detected) }}>
                  Scan
                </button>
                <button type="button" className={`min-h-11 rounded-lg text-sm ${mode === "color" ? "bg-primary text-primary-foreground" : "border border-input"}`} onClick={() => { setMode("color"); void refresh(shot, corners, "color", detected) }}>
                  Color
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={retake}>Retake</button>
                <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={() => setAdjusting(true)}>Adjust corners</button>
                <button type="button" className="min-h-11 rounded-lg bg-primary text-sm font-medium text-primary-foreground" onClick={useScan}>Use</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-contain" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            {!secure || error ? <p className="absolute inset-x-6 top-6 rounded-lg bg-black/70 p-3 text-center text-sm">{secure ? error : "The camera needs a secure https connection."}</p> : null}
            {busy ? <p className="absolute inset-x-6 bottom-28 text-center text-sm">Reading the receipt…</p> : null}
          </>
        )}
      </div>
      {!shot ? (
        <div className="flex items-center justify-between gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-white/15 px-3 text-sm">
            Upload from gallery
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ""
                const [first, ...rest] = files
                if (!first) return
                setQueue(rest)
                void openFile(first)
              }}
            />
          </label>
          <button
            type="button"
            aria-label="Take photo"
            disabled={!ready || busy}
            onClick={() => void capture()}
            className="h-16 w-16 rounded-full border-4 border-white bg-white/30 disabled:opacity-50"
          />
          <span className="w-28" />
        </div>
      ) : null}
    </div>
  )
}

async function takePhoto(track: MediaStreamTrack, video: HTMLVideoElement) {
  const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture
  if (ImageCaptureCtor) {
    try {
      return await new ImageCaptureCtor(track).takePhoto()
    } catch {
      // Some phones expose ImageCapture but reject takePhoto. The video frame is the fallback.
    }
  }
  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not read the camera")
  context.drawImage(video, 0, 0)
  return canvas
}
