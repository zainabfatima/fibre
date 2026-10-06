"use client"

import { useRef, useState } from "react"

import type { Point } from "@/lib/scanner/types"

export function CornerAdjuster({
  image,
  corners,
  onChange,
}: {
  image: ImageData
  corners: Point[]
  onChange: (corners: Point[]) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null)
  const scale = Math.min(1, 360 / image.width)
  const width = Math.round(image.width * scale)
  const height = Math.round(image.height * scale)

  function paint(next = corners, pointer?: { x: number; y: number }) {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const source = document.createElement("canvas")
    source.width = image.width
    source.height = image.height
    source.getContext("2d")?.putImageData(image, 0, 0)
    context.clearRect(0, 0, width, height)
    context.drawImage(source, 0, 0, width, height)
    context.strokeStyle = "#ea580c"
    context.lineWidth = 2
    context.beginPath()
    next.forEach((point, index) => {
      const x = point.x * scale
      const y = point.y * scale
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.stroke()
    next.forEach((point) => {
      context.fillStyle = "#fff"
      context.beginPath()
      context.arc(point.x * scale, point.y * scale, 8, 0, Math.PI * 2)
      context.fill()
    })
    if (pointer) {
      context.save()
      context.beginPath()
      context.arc(pointer.x, pointer.y, 42, 0, Math.PI * 2)
      context.clip()
      context.drawImage(
        source,
        (pointer.x / scale) - 40,
        (pointer.y / scale) - 40,
        80,
        80,
        pointer.x - 42,
        pointer.y - 42,
        84,
        84,
      )
      context.restore()
      context.strokeStyle = "#fff"
      context.strokeRect(pointer.x - 42, pointer.y - 42, 84, 84)
    }
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const hit = corners.findIndex((point) => Math.hypot(point.x * scale - x, point.y * scale - y) < 22)
    setDrag(hit === -1 ? null : hit)
    setLoupe({ x, y })
    paint(corners, { x, y })
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (drag == null) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(width, event.clientX - rect.left))
    const y = Math.max(0, Math.min(height, event.clientY - rect.top))
    const next = corners.map((point, index) =>
      index === drag ? { x: x / scale, y: y / scale } : point,
    )
    onChange(next)
    setLoupe({ x, y })
    paint(next, { x, y })
  }

  return (
    <canvas
      ref={(node) => {
        canvasRef.current = node
        if (node) paint(corners, loupe ?? undefined)
      }}
      width={width}
      height={height}
      className="mx-auto max-w-full touch-none rounded-lg bg-black"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={() => {
        setDrag(null)
        setLoupe(null)
      }}
    />
  )
}
