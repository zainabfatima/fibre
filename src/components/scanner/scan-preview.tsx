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
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-background px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="grid grid-cols-2 gap-2">
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
            className="col-span-2 min-h-11 rounded-lg border border-input text-sm font-medium disabled:opacity-60"
          >
            Confirm
          </button>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="mt-2 min-h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {confirming ? "Saving…" : "Done"}
        </button>
        {note ? <p className="mt-2 text-sm text-red-700">{note}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Scanned receipt" className="w-full" />
      </div>
    </div>
  )
}
