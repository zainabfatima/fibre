"use client"

import { useEffect, useState } from "react"

import { ReceiptPages } from "@/components/receipt-pages"

export function ReceiptViewer({
  src,
  fileType,
  pageCount = 1,
  onClose,
}: {
  src: string
  fileType: "image" | "pdf"
  pageCount?: number
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    setZoom(1)
  }, [src])

  return (
    <div className="fixed inset-0 z-40 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-black/80 p-3" onClick={onClose}>
      <div className="flex items-center justify-between text-white" onClick={(event) => event.stopPropagation()}>
        <p className="text-sm">{fileType === "pdf" && pageCount > 1 ? `${pageCount} pages` : "Receipt"}</p>
        <button type="button" onClick={onClose} className="min-h-11 px-3">
          Close
        </button>
      </div>
      <div className="min-h-0 min-w-0 overflow-auto" onClick={(event) => event.stopPropagation()}>
        <ReceiptPages src={src} fileType={fileType} pageCount={pageCount} zoom={zoom} />
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setZoom((current) => Math.max(1, current - 0.5))}>
          Zoom out
        </button>
        <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setZoom((current) => Math.min(4, current + 0.5))}>
          Zoom in
        </button>
        <a href={src} download className="inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-sm">
          Download
        </a>
      </div>
    </div>
  )
}
