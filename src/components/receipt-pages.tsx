"use client"

import { useEffect, useState } from "react"

export function ReceiptPages({
  src,
  fileType,
  pageCount = 1,
  zoom = 1,
  rotation = 0,
}: {
  src: string
  fileType: "image" | "pdf"
  pageCount?: number
  zoom?: number
  rotation?: number
}) {
  const [pages, setPages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(fileType === "pdf")

  useEffect(() => {
    if (fileType !== "pdf") return
    let cancelled = false
    const urls: string[] = []
    setPages([])
    setError(null)
    setLoading(true)

    ;(async () => {
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error("Could not open the receipt")
        const data = new Uint8Array(await response.arrayBuffer())
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
        const pdf = await pdfjs.getDocument({ data }).promise
        const targetWidth = Math.min(1600, Math.max(1000, window.innerWidth * 2))
        for (let number = 1; number <= pdf.numPages; number += 1) {
          if (cancelled) break
          const page = await pdf.getPage(number)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: targetWidth / base.width })
          const canvas = document.createElement("canvas")
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext("2d")
          if (!context) throw new Error("Could not draw the receipt")
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
          if (!blob) throw new Error("Could not draw a receipt page")
          urls.push(URL.createObjectURL(blob))
        }
        if (cancelled) {
          urls.forEach((url) => URL.revokeObjectURL(url))
          return
        }
        setPages(urls.slice())
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not open the receipt")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [src, fileType])

  const turn = rotation ? { transform: `rotate(${rotation}deg)` } : undefined

  if (fileType === "image") {
    return (
      <div style={{ width: `${zoom * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Receipt" style={turn} className="h-auto w-full bg-white" />
      </div>
    )
  }

  if (loading) {
    return (
      <p className="rounded-lg bg-white p-6 text-center text-sm text-neutral-900">
        Loading {pageCount > 1 ? `${pageCount} pages` : "receipt"}…
      </p>
    )
  }

  if (error || pages.length === 0) {
    return (
      <p className="rounded-lg bg-white p-6 text-center text-sm text-neutral-900">
        {error ?? "Could not open the receipt"}.{" "}
        <a href={src} target="_blank" rel="noreferrer" className="underline">
          Open receipt file
        </a>
      </p>
    )
  }

  const total = pages.length
  return (
    <div className="flex flex-col gap-4" style={{ width: `${zoom * 100}%` }}>
      {pages.map((url, index) => (
        <figure key={url} className="rounded-lg bg-white p-2 text-neutral-900">
          {total > 1 ? (
            <figcaption className="mb-2 text-center text-sm font-medium">
              Page {index + 1} of {total}
            </figcaption>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Receipt page ${index + 1} of ${total}`}
            style={turn}
            className="h-auto w-full"
          />
        </figure>
      ))}
    </div>
  )
}
