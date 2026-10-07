"use client"

import { useEffect, useRef, useState } from "react"

import type { Point, Raster } from "@/lib/receiptCrop"

export function ReceiptCropper({
  image,
  corners,
  needsManualCrop,
  busy = false,
  note,
  onChange,
  onUseCrop,
  onResetAuto,
  onUseOriginal,
  onRotate,
  onDone,
  onCancel,
}: {
  image: Raster
  corners: Point[]
  needsManualCrop: boolean
  busy?: boolean
  note?: string | null
  onChange: (corners: Point[]) => void
  onUseCrop: () => void
  onResetAuto: () => void
  onUseOriginal: () => void
  onRotate?: () => void
  onDone?: () => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const displayWidth = Math.max(1, Math.min(image.width, 1000))
  const displayHeight = Math.max(1, Math.round(image.height * (displayWidth / image.width)))

  useEffect(() => {
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")
    if (!context) return
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    sourceRef.current = canvas
    paint(corners)
  }, [image])

  useEffect(() => {
    paint(corners)
  }, [corners, drag])

  function paint(next: Point[]) {
    const canvas = canvasRef.current
    const source = sourceRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !source || !context) return
    context.clearRect(0, 0, displayWidth, displayHeight)
    context.drawImage(source, 0, 0, displayWidth, displayHeight)
    context.beginPath()
    next.forEach((point, index) => {
      const [x, y] = toDisplay(point, canvas)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.strokeStyle = "#ea580c"
    context.lineWidth = 2
    context.stroke()
    next.forEach((point, index) => {
      const [x, y] = toDisplay(point, canvas)
      context.beginPath()
      context.arc(x, y, index === drag ? 16 : 13, 0, Math.PI * 2)
      context.fillStyle = "#fff"
      context.fill()
      context.lineWidth = 3
      context.strokeStyle = "#ea580c"
      context.stroke()
    })
  }

  function toDisplay(point: Point, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width / image.width
    const scaleY = rect.height / image.height
    return [
      Math.max(0, Math.min(rect.width, point.x * scaleX)) * (displayWidth / rect.width),
      Math.max(0, Math.min(rect.height, point.y * scaleY)) * (displayHeight / rect.height),
    ]
  }

  function toImage(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * image.width
    const y = ((event.clientY - rect.top) / rect.height) * image.height
    return {
      x: Math.max(0, Math.min(image.width - 1, x)),
      y: Math.max(0, Math.min(image.height - 1, y)),
    }
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = toImage(event)
    const reach = Math.max(28, (44 * image.width) / rect.width)
    let hit = -1
    let best = reach
    corners.forEach((corner, index) => {
      const distance = Math.hypot(corner.x - point.x, corner.y - point.y)
      if (distance < best) {
        best = distance
        hit = index
      }
    })
    dragRef.current = hit === -1 ? null : hit
    setDrag(hit === -1 ? null : hit)
    if (hit !== -1) event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current == null) return
    const point = toImage(event)
    const next = corners.map((corner, index) => (index === dragRef.current ? point : corner))
    onChange(next)
    paint(next)
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex h-dvh max-w-[100vw] flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h2 className="font-medium">Crop receipt</h2>
        <button type="button" onClick={onCancel} className="min-h-11 px-3 text-sm underline">
          Cancel
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {needsManualCrop ? (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950" role="status">
            The paper edges were not clear. Drag the four corners onto the receipt, or use the original photo.
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">
            Drag a corner if the outline misses the paper. The scan is saved in black and white.
          </p>
        )}
        <canvas
          ref={canvasRef}
          width={displayWidth}
          height={displayHeight}
          className="mx-auto block h-auto w-full max-w-full touch-none rounded-lg bg-neutral-950"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
        {note ? <p className="mt-3 text-sm text-red-700">{note}</p> : null}
      </div>
      <div className="grid shrink-0 gap-2 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={busy}
          className="min-h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          onClick={onUseCrop}
        >
          Use crop
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="min-h-11 rounded-lg border border-input px-3 text-sm" onClick={onResetAuto}>
            Reset to auto
          </button>
          <button type="button" className="min-h-11 rounded-lg border border-input px-3 text-sm" onClick={onUseOriginal}>
            Use original
          </button>
        </div>
        {onRotate ? (
          <button type="button" className="min-h-11 rounded-lg border border-input text-sm" onClick={onRotate}>
            Rotate
          </button>
        ) : null}
        {onDone ? (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 w-full rounded-lg border border-input text-sm font-medium disabled:opacity-60"
            onClick={onDone}
          >
            {busy ? "Saving…" : "Done"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
