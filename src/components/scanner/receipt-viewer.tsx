"use client"

import { useEffect, useState } from "react"

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
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    setPage(1)
    setZoom(1)
  }, [src])

  return (
    <div className="fixed inset-0 z-40 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-black/80 p-3" onClick={onClose}>
      <div className="flex items-center justify-between text-white" onClick={(event) => event.stopPropagation()}>
        <p className="text-sm">{fileType === "pdf" ? `Page ${page} of ${Math.max(pageCount, 1)}` : "Receipt"}</p>
        <button type="button" onClick={onClose} className="min-h-11 px-3">
          Close
        </button>
      </div>
      <div className="overflow-auto" onClick={(event) => event.stopPropagation()}>
        {fileType === "pdf" ? (
          <iframe title="Receipt PDF" src={`${src}#page=${page}`} className="h-[70vh] w-full rounded-lg bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Receipt" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} />
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-2" onClick={(event) => event.stopPropagation()}>
        {fileType === "pdf" ? (
          <>
            <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </button>
            <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
              Next
            </button>
          </>
        ) : (
          <>
            <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setZoom((current) => Math.max(1, current - 0.5))}>
              Zoom out
            </button>
            <button type="button" className="min-h-11 rounded-lg bg-white px-3 text-sm" onClick={() => setZoom((current) => Math.min(4, current + 0.5))}>
              Zoom in
            </button>
          </>
        )}
        <a href={src} download className="inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-sm">
          Download
        </a>
      </div>
    </div>
  )
}
