"use client"

import { useState } from "react"

import { canvasFromBlob, detectCanvas, renderCanvas } from "@/lib/receiptScanner"

type Row = {
  id: string
  name: string
  originalUrl: string
  quadUrl: string
  warpedUrl: string | null
  scanUrl: string
  glareRatio: number
  detected: boolean
  ms: number
  width: number
  height: number
}

export default function ScannerTestPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState<string | null>(null)

  async function openFiles(files: File[]) {
    setNote(null)
    const next: Row[] = []
    for (const file of files.slice(0, 12)) {
      const started = performance.now()
      const source = await canvasFromBlob(file)
      const corners = await detectCanvas(source)
      const rendered = await renderCanvas(source, corners, "scan", false)
      const quad = document.createElement("canvas")
      quad.width = source.width
      quad.height = source.height
      const context = quad.getContext("2d")
      if (!context) continue
      context.drawImage(source, 0, 0)
      if (corners) {
        context.strokeStyle = "#16a34a"
        context.lineWidth = Math.max(4, source.width / 200)
        context.beginPath()
        corners.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        })
        context.closePath()
        context.stroke()
      }
      next.push({
        id: crypto.randomUUID(),
        name: file.name || "Receipt",
        originalUrl: source.toDataURL("image/jpeg", 0.8),
        quadUrl: quad.toDataURL("image/jpeg", 0.8),
        warpedUrl: rendered.warpedBlob ? URL.createObjectURL(rendered.warpedBlob) : null,
        scanUrl: URL.createObjectURL(rendered.blob),
        glareRatio: rendered.glareRatio,
        detected: Boolean(corners),
        ms: Math.round(performance.now() - started),
        width: rendered.width,
        height: rendered.height,
      })
    }
    setRows(next)
    if (next.length === 0) setNote("Drop receipt photos to test the scanner.")
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Scanner test</h1>
      <p className="text-sm text-muted-foreground">
        Drop receipt photos. Each row shows the original with the detected outline, the warped crop, and the scan. Nothing is saved.
      </p>
      <label
        className="grid min-h-32 cursor-pointer place-items-center rounded-xl border border-dashed border-border bg-card p-6 text-sm"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void openFiles([...event.dataTransfer.files])
        }}
      >
        Drop photos here or choose files
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ""
            void openFiles(files)
          }}
        />
      </label>
      {note ? <p className="text-sm text-destructive">{note}</p> : null}
      {rows.map((row) => (
        <section key={row.id} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">{row.name}</h2>
          <p className="text-sm text-muted-foreground">
            {row.detected ? "Detected" : "Not detected"} · glare {(row.glareRatio * 100).toFixed(1)}% · {row.ms} ms · {row.width}×{row.height}
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <Figure label="Original" src={row.originalUrl} />
            <Figure label="Detected quad" src={row.quadUrl} />
            <Figure label="Warped crop" src={row.warpedUrl} />
            <Figure label="Scan" src={row.scanUrl} />
          </div>
        </section>
      ))}
    </main>
  )
}

function Figure({ label, src }: { label: string; src: string | null }) {
  return (
    <figure className="grid gap-1">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-64 w-full bg-white object-contain" />
      ) : (
        <p className="grid h-64 place-items-center bg-white text-sm text-muted-foreground">No crop</p>
      )}
    </figure>
  )
}
