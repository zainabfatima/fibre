"use client"

import { useEffect } from "react"

import { formatMoney } from "@/lib/money"

export function ReturnNotice({
  amount,
  onConfirm,
  onCorrect,
}: {
  amount: string
  onConfirm: () => void
  onCorrect: () => void
}) {
  return (
    <div className="mb-3 grid gap-3 rounded-lg bg-red-100 p-3 text-sm text-red-950 dark:bg-red-950 dark:text-red-50 md:mb-0">
      <div>
        <p className="font-medium">Possible return</p>
        <p>
          This amount is <span className="font-semibold tabular-nums">{formatMoney(amount)}</span>. Confirm it is a
          return and the minus sign stays. If this is a regular charge, edit the amount. Dismissing does not change
          the number.
        </p>
      </div>
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-base font-medium text-primary-foreground sm:w-auto sm:text-sm"
        >
          This is a return
        </button>
        <label className="inline-flex min-h-11 w-full items-center gap-2 sm:w-auto">
          <input
            type="checkbox"
            onChange={(event) => {
              if (event.target.checked) onConfirm()
            }}
            className="size-5"
          />
          Confirmed
        </label>
        <button
          type="button"
          onClick={onCorrect}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-input bg-background px-3 text-base font-medium text-foreground sm:w-auto sm:text-sm"
        >
          Not a return
        </button>
      </div>
    </div>
  )
}

export function ReturnConfirmDialog({
  amount,
  onConfirm,
  onCorrect,
  onDismiss,
}: {
  amount: string
  onConfirm: () => void
  onCorrect: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onDismiss])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-confirm-title"
        className="max-h-[min(85vh,640px)] w-full max-w-md overflow-y-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-red-300"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rounded-lg bg-red-100 p-3 text-sm text-red-950 dark:bg-red-950 dark:text-red-50">
          <p id="return-confirm-title" className="font-medium">
            Possible return
          </p>
          <p className="mt-1">
            This amount is <span className="font-semibold tabular-nums">{formatMoney(amount)}</span>. Confirm it is a
            return and the minus sign stays. If this is a regular charge, edit the amount. Dismissing does not change
            the number.
          </p>
        </div>
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-base font-medium text-primary-foreground"
          >
            This is a return
          </button>
          <button
            type="button"
            onClick={onCorrect}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-input bg-background px-3 text-base font-medium"
          >
            Not a return
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-base font-medium text-muted-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

/** Move the caret to the visible amount field so the user can edit the number. */
export function focusAmountField(id: string) {
  window.setTimeout(() => {
    const nodes = document.querySelectorAll<HTMLInputElement>(`[data-amount-for="${CSS.escape(id)}"]`)
    const visible = Array.from(nodes).find((node) => node.getClientRects().length > 0) ?? nodes[0]
    if (!visible) return
    visible.focus()
    visible.select()
  }, 50)
}
