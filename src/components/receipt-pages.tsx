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
  const turn = rotation ? { transform: `rotate(${rotation}deg)` } : undefined

  if (fileType === "image") {
    return (
      <div style={{ width: `${zoom * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Receipt" style={turn} className="h-auto w-full bg-white" />
      </div>
    )
  }

  const label = pageCount > 1 ? `Receipt PDF, ${pageCount} pages` : "Receipt PDF"
  return (
    <div className="flex flex-col gap-3" style={{ width: `${zoom * 100}%` }}>
      <object
        data={src}
        type="application/pdf"
        aria-label={label}
        className="h-[70vh] min-h-80 w-full rounded-lg bg-white"
        style={turn}
      >
        <a href={src} target="_blank" rel="noreferrer" className="underline">
          Open the PDF
        </a>
      </object>
      <a href={src} target="_blank" rel="noreferrer" className="text-center text-sm text-neutral-900 underline">
        Open the PDF
      </a>
    </div>
  )
}
