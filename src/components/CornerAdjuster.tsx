"use client"

import { useEffect, useRef } from "react"

import type { Point } from "@/lib/receiptScanner"

export function CornerAdjuster({
  image,
  corners,
  onChange,
  onConfirm,
  onCancel,
  busy = false,
}: {
  image: HTMLCanvasElement
  corners: Point[]
  onChange: (corners: Point[]) => void
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<number | null>(null)
  const cornersRef = useRef(corners)

  useEffect(() => {
    cornersRef.current = corners
    draw(canvasRef.current, image, corners, null)
  }, [corners, image])

  function paint(next: Point[], pointer: { x: number; y: number } | null) {
    draw(canvasRef.current, image, next, pointer)
  }

  function toView(point: Point, width: number, height: number) {
    return { x: (point.x / image.width) * width, y: (point.y / image.height) * height }
  }

  function toImage(point: { x: number; y: number }, width: number, height: number) {
    return {
      x: (point.x / width) * image.width,
      y: (point.y / height) * image.height,
    }
  }

  function localPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height }
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const pointer = localPoint(event)
    const hit = cornersRef.current.findIndex((point) => {
      const view = toView(point, pointer.width, pointer.height)
      return Math.hypot(view.x - pointer.x, view.y - pointer.y) <= 22
    })
    dragRef.current = hit === -1 ? null : hit
    if (hit !== -1) event.currentTarget.setPointerCapture(event.pointerId)
    paint(cornersRef.current, pointer)
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const pointer = localPoint(event)
    const drag = dragRef.current
    if (drag == null) {
      paint(cornersRef.current, null)
      return
    }
    const imagePoint = toImage(pointer, pointer.width, pointer.height)
    const next = cornersRef.current.map((point, index) =>
      index === drag
        ? {
            x: Math.max(0, Math.min(image.width - 1, imagePoint.x)),
            y: Math.max(0, Math.min(image.height - 1, imagePoint.y)),
          }
        : point,
    )
    cornersRef.current = next
    onChange(next)
    paint(next, pointer)
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    paint(cornersRef.current, null)
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Drag the corners onto the receipt. The photo stays in the orientation you shot.</p>
      <canvas
        ref={canvasRef}
        className="w-full touch-none rounded-lg bg-white"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button type="button" className="min-h-11 rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : "Use these corners"}
        </button>
      </div>
    </div>
  )
}

function draw(
  canvas: HTMLCanvasElement | null,
  image: HTMLCanvasElement,
  next: Point[],
  pointer: { x: number; y: number } | null,
) {
  const context = canvas?.getContext("2d")
  if (!canvas || !context) return
  const width = canvas.clientWidth || image.width
  const height = Math.max(1, Math.round((image.height / image.width) * width))
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  context.strokeStyle = "#16a34a"
  context.lineWidth = 2
  context.beginPath()
  next.forEach((point, index) => {
    const view = { x: (point.x / image.width) * width, y: (point.y / image.height) * height }
    if (index === 0) context.moveTo(view.x, view.y)
    else context.lineTo(view.x, view.y)
  })
  context.closePath()
  context.stroke()
  for (const point of next) {
    const view = { x: (point.x / image.width) * width, y: (point.y / image.height) * height }
    context.fillStyle = "#ffffff"
    context.beginPath()
    context.arc(view.x, view.y, 8, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }
  if (!pointer) return
  context.save()
  context.beginPath()
  context.arc(pointer.x, pointer.y, 48, 0, Math.PI * 2)
  context.clip()
  context.drawImage(
    image,
    (pointer.x / width) * image.width - 36,
    (pointer.y / height) * image.height - 36,
    72,
    72,
    pointer.x - 48,
    pointer.y - 48,
    96,
    96,
  )
  context.restore()
  context.strokeStyle = "#ffffff"
  context.beginPath()
  context.arc(pointer.x, pointer.y, 48, 0, Math.PI * 2)
  context.stroke()
}
