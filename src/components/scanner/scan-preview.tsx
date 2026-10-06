"use client"

export function ScanPreview({
  src,
  note,
  onRetake,
  onAdjust,
  onConfirm,
  confirming,
}: {
  src: string
  note?: string
  onRetake: () => void
  onAdjust: () => void
  onConfirm: () => void
  confirming: boolean
}) {
  return (
    <div className="grid gap-3">
      <div className="max-h-[70vh] overflow-auto rounded-lg bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Scanned receipt" className="w-full" />
      </div>
      {note ? <p className="text-sm text-red-700">{note}</p> : null}
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onRetake} className="min-h-11 rounded-lg border border-input text-sm">
          Retake
        </button>
        <button type="button" onClick={onAdjust} className="min-h-11 rounded-lg border border-input text-sm">
          Adjust
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="min-h-11 rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {confirming ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  )
}
