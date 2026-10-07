"use client"

import { useEffect, useRef, useState } from "react"

declare class ImageCapture {
  constructor(track: MediaStreamTrack)
  takePhoto(): Promise<Blob>
}

import { detectCorners } from "@/lib/scanner/image"
import type { Point } from "@/lib/scanner/types"

export function CameraCapture({
  pageNumber,
  onCapture,
  onClose,
}: {
  pageNumber: number
  onCapture: (blob: Blob) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const stableRef = useRef<{ corners: Point[] | null; since: number }>({ corners: null, since: 0 })

  useEffect(() => {
    if (!window.isSecureContext) {
      const timer = window.setTimeout(() => {
        setError("The camera needs a secure https connection.")
      }, 0)
      return () => window.clearTimeout(timer)
    }
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 4096 },
            height: { ideal: 4096 },
          },
        })
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        timer = window.setInterval(() => {
          if (stopped) return
          void detectFrame(stream)
        }, 200)
      } catch {
        setError("The camera is not available. Choose a photo instead.")
      }
    }
    function detectFrame(current: MediaStream | null) {
      const video = videoRef.current
      const overlay = overlayRef.current
      if (!video || !overlay || video.readyState < 2) return
      const width = 320
      const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width))
      const sample = document.createElement("canvas")
      sample.width = width
      sample.height = height
      const context = sample.getContext("2d", { willReadFrequently: true })
      const draw = overlay.getContext("2d")
      if (!context || !draw) return
      context.drawImage(video, 0, 0, width, height)
      const corners = detectCorners(context.getImageData(0, 0, width, height))
      overlay.width = video.clientWidth
      overlay.height = video.clientHeight
      draw.clearRect(0, 0, overlay.width, overlay.height)
      const scaleX = overlay.width / width
      const scaleY = overlay.height / height
      draw.strokeStyle = "#22c55e"
      draw.lineWidth = 3
      draw.beginPath()
      corners.forEach((point, index) => {
        const x = point.x * scaleX
        const y = point.y * scaleY
        if (index === 0) draw.moveTo(x, y)
        else draw.lineTo(x, y)
      })
      draw.closePath()
      draw.stroke()
      const previous = stableRef.current.corners
      const moved = !previous || corners.some((point, index) => Math.hypot(point.x - previous[index].x, point.y - previous[index].y) > 8)
      if (moved) stableRef.current = { corners, since: Date.now() }
      else if (Date.now() - stableRef.current.since > 1000 && current) {
        stableRef.current.since = Date.now() + 5000
        void grab(current)
      }
    }
    void start()
    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
    // The camera starts once. `grab` reads refs and must not reopen the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function grab(stream?: MediaStream | null) {
    const video = videoRef.current
    const current = stream ?? (video?.srcObject as MediaStream | null)
    const track = current?.getVideoTracks()[0]
    if (!video || !track) return
    try {
      const capture = new ImageCapture(track)
      const blob = await capture.takePhoto()
      onCapture(blob)
      return
    } catch {
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext("2d")?.drawImage(video, 0, 0)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95))
      if (blob) onCapture(blob)
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
      setError("The flash is not available on this phone.")
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
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
              Close
            </button>
            <span className="rounded-full bg-black/50 px-3 py-1 text-sm">Page {pageNumber}</span>
            <button type="button" onClick={() => void toggleTorch()} className="min-h-11 rounded-lg bg-black/50 px-3 text-sm">
              {torch ? "Flash on" : "Flash"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void grab()}
            className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 h-16 w-16 -translate-x-1/2 rounded-full border-4 border-white bg-white/30"
            aria-label="Take photo"
          />
        </>
      )}
    </div>
  )
}
