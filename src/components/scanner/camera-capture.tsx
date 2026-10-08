"use client"

import { useEffect, useId, useRef, useState } from "react"

import { cornersAreUsable, orderCorners, pointInPolygon, rasterToJpegBlob, renderCrop, type Raster } from "@/lib/receiptCrop"
import {
  defaultViewFrame,
  dragFrameCorner,
  moveFrame,
  viewCornersToSource,
} from "@/lib/scanner/view-frame"
import type { Point } from "@/lib/scanner/types"

const CAPTURE_LONG_SIDE = 2400

export function CameraCapture({
  pageNumber,
  onCapture,
  onClose,
}: {
  pageNumber: number
  onCapture: (blob: Blob, framed?: boolean) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<Point[]>(defaultViewFrame)
  const maskId = `frame${useId().replace(/:/g, "")}`
  const dragRef = useRef<{ kind: "corner"; index: number } | { kind: "move"; x: number; y: number; origin: Point[] } | null>(null)
  const grabbing = useRef(false)
  const [frame, setFrame] = useState<Point[]>(defaultViewFrame)
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)

  function updateFrame(next: Point[]) {
    frameRef.current = next
    setFrame(next)
  }

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
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) {
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          setError("The camera is not available. Choose a photo instead.")
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

  async function grab() {
    const video = videoRef.current
    if (!video || grabbing.current || video.videoWidth < 2 || video.clientWidth < 2) return
    grabbing.current = true
    setCapturing(true)
    try {
      const scale = Math.min(1, CAPTURE_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.max(1, Math.round(video.videoWidth * scale))
      const height = Math.max(1, Math.round(video.videoHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) throw new Error("Could not read the camera")
      context.drawImage(video, 0, 0, width, height)
      const image = context.getImageData(0, 0, width, height)
      const raster: Raster = { width, height, data: image.data }
      const corners = viewCornersToSource(
        frameRef.current,
        video.videoWidth,
        video.videoHeight,
        video.clientWidth,
        video.clientHeight,
      ).map((point) => ({ x: point.x * scale, y: point.y * scale }))
      const ordered = orderCorners(corners)
      const cropped = cornersAreUsable(ordered) ? renderCrop(raster, ordered, "manual", 1).image : raster
      const framed = cornersAreUsable(ordered)
      onCapture(await rasterToJpegBlob(cropped, 0.92), framed)
    } catch (cause) {
      stopCamera()
      setError(cause instanceof Error ? cause.message : "The photo could not be taken.")
    } finally {
      grabbing.current = false
      setCapturing(false)
    }
  }

  async function toggleTorch() {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
    if (!track) return
    const next = !torch
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorch(next)
    } catch {
      stopCamera()
      setError("The flash is not available on this phone.")
    }
  }

  function pointerPoint(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      y: (event.clientY - rect.top) / Math.max(1, rect.height),
      rect,
    }
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (capturing) return
    const { x, y, rect } = pointerPoint(event)
    const px = x * rect.width
    const py = y * rect.height
    let hit = -1
    let best = 44
    frameRef.current.forEach((corner, index) => {
      const distance = Math.hypot(corner.x * rect.width - px, corner.y * rect.height - py)
      if (distance < best) {
        best = distance
        hit = index
      }
    })
    if (hit !== -1) dragRef.current = { kind: "corner", index: hit }
    else if (pointInPolygon({ x, y }, frameRef.current)) {
      dragRef.current = { kind: "move", x, y, origin: frameRef.current }
    } else dragRef.current = null
    if (dragRef.current) event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = pointerPoint(event)
    if (drag.kind === "corner") updateFrame(dragFrameCorner(frameRef.current, drag.index, { x, y }))
    else updateFrame(moveFrame(drag.origin, x - drag.x, y - drag.y))
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const polygon = frame.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")

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
                if (file) onCapture(file)
              }}
            />
          </label>
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm underline">
            Close
          </button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div
            className="absolute inset-0 z-10 touch-none"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          >
            <svg className="pointer-events-none h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <mask id={maskId}>
                  <rect width="100" height="100" fill="white" />
                  <polygon points={polygon} fill="black" />
                </mask>
              </defs>
              <rect width="100" height="100" fill="black" opacity="0.55" mask={`url(#${maskId})`} />
              <polygon points={polygon} fill="none" stroke="#22c55e" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </svg>
            {frame.map((point, index) => (
              <span
                key={index}
                className="pointer-events-none absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-orange-500"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              />
            ))}
          </div>
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto flex items-center justify-between">
              <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
                Close
              </button>
              <span className="rounded-full bg-black/50 px-3 py-1 text-sm">Page {pageNumber}</span>
              <button type="button" onClick={() => void toggleTorch()} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
                {torch ? "Flash on" : "Flash"}
              </button>
            </div>
            <p className="mx-auto mt-3 max-w-sm rounded-lg bg-black/50 px-3 py-2 text-center text-sm">
              Drag the corners onto the receipt. Anything outside the frame is left out.
            </p>
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                className="pointer-events-auto min-h-11 rounded-lg bg-black/50 px-3 text-sm"
                onClick={() => updateFrame(defaultViewFrame)}
              >
                Reset frame
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={!ready || capturing}
            onClick={() => void grab()}
            className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 z-20 h-16 w-16 -translate-x-1/2 rounded-full border-4 border-white bg-white/30 disabled:opacity-50"
            aria-label={capturing ? "Cropping photo" : "Take photo"}
          />
        </>
      )}
    </div>
  )
}
