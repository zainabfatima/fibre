"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import type { Point, Raster } from "@/lib/receiptCrop"

export function ReceiptCropper({
  image,
  corners,
  needsManualCrop,
  busy = false,
  locked = false,
  note,
  pageLabel,
  busyLabel,
  onChange,
  onUseCrop,
  onResetAuto,
  onUseOriginal,
  onRotate,
  onSave,
  saveLabel,
  onDone,
  onCancel,
}: {
  image: Raster
  corners: Point[]
  needsManualCrop: boolean
  busy?: boolean
  locked?: boolean
  note?: string | null
  pageLabel?: string | null
  busyLabel?: string | null
  onChange: (corners: Point[]) => void
  onUseCrop: () => void
  onResetAuto: () => void
  onUseOriginal: () => void
  onRotate?: () => void
  onSave?: () => void
  saveLabel?: string
  onDone?: () => void
  onCancel: () => void
}) {
  const unavailable = busy || locked
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<number | null>(null)
  const acted = useRef(0)
  const screenRef = useRef<HTMLDivElement>(null)
  const unavailableRef = useRef(unavailable)
  const actionsRef = useRef<Record<string, (() => void) | undefined>>({})
  unavailableRef.current = unavailable
  actionsRef.current = {
    cancel: onCancel,
    crop: onUseCrop,
    reset: onResetAuto,
    original: onUseOriginal,
    rotate: onRotate,
    save: onSave,
    done: onDone,
  }
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

  useEffect(() => {
    const html = document.documentElement
    const previousOverflow = html.style.overflow
    html.style.overflow = "hidden"
    function run(name: string | undefined) {
      if (!name || unavailableRef.current) return
      const action = actionsRef.current[name]
      if (!action) return
      const now = Date.now()
      if (now - acted.current < 500) return
      acted.current = now
      action()
    }
    function buttonName(x: number, y: number) {
      const buttons = screenRef.current?.querySelectorAll<HTMLButtonElement>("[data-crop]")
      if (!buttons) return
      for (const button of buttons) {
        if (button.disabled) continue
        const rect = button.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return button.dataset.crop
      }
    }
    function onTouchEnd(event: TouchEvent) {
      const touch = event.changedTouches[0]
      if (!touch) return
      const name = buttonName(touch.clientX, touch.clientY)
      if (!name) return
      event.preventDefault()
      run(name)
    }
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false })
    return () => {
      html.style.overflow = previousOverflow
      document.removeEventListener("touchend", onTouchEnd, true)
    }
  }, [])

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

  function tap(name: string) {
    return () => {
      if (unavailableRef.current) return
      const action = actionsRef.current[name]
      if (!action) return
      const now = Date.now()
      if (now - acted.current < 500) return
      acted.current = now
      action()
    }
  }

  const screen = (
    <div ref={screenRef} className="fixed inset-0 z-[80] grid grid-rows-[auto_minmax(0,1fr)_auto] bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div>
          <h2 className="font-medium">Crop receipt</h2>
          {pageLabel ? <p className="text-sm text-muted-foreground">{pageLabel}</p> : null}
        </div>
        <button type="button" data-crop="cancel" className="min-h-11 px-3 text-sm underline" onClick={tap("cancel")}>
          Cancel
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden px-3 py-3">
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
          className="mx-auto min-h-0 w-auto max-w-full flex-1 rounded-lg bg-neutral-950 object-contain"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
        {note ? <p className="mt-3 text-sm text-red-700">{note}</p> : null}
      </div>
      <div className="grid touch-manipulation gap-2 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={unavailable}
          className="min-h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          data-crop="crop"
          onClick={tap("crop")}
        >
          {busy && busyLabel ? busyLabel : "Use crop"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-crop="reset" disabled={unavailable} className="min-h-11 rounded-lg border border-input px-3 text-sm disabled:opacity-60" onClick={tap("reset")}>
            Reset to auto
          </button>
          <button type="button" data-crop="original" disabled={unavailable} className="min-h-11 rounded-lg border border-input px-3 text-sm disabled:opacity-60" onClick={tap("original")}>
            Use original
          </button>
        </div>
        {onRotate || onSave ? (
          <div className={onRotate && onSave ? "grid grid-cols-2 gap-2" : "grid"}>
            {onRotate ? (
              <button type="button" data-crop="rotate" disabled={unavailable} className="min-h-11 rounded-lg border border-input text-sm disabled:opacity-60" onClick={tap("rotate")}>
                Rotate
              </button>
            ) : null}
            {onSave ? (
              <button type="button" data-crop="save" disabled={unavailable} className="min-h-11 rounded-lg border border-input text-sm disabled:opacity-60" onClick={tap("save")}>
                {saveLabel ?? "Save"}
              </button>
            ) : null}
          </div>
        ) : null}
        {onDone ? (
          <button
            type="button"
            disabled={unavailable}
            className="min-h-11 w-full rounded-lg border border-input text-sm font-medium disabled:opacity-60"
            data-crop="done"
            onClick={tap("done")}
          >
            {busy ? "Saving…" : "Done"}
          </button>
        ) : null}
      </div>
    </div>
  )

  return createPortal(screen, document.body)
}
