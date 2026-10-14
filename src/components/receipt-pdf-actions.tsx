"use client"

import { useZainab } from "@/components/view-mode"

export function ReceiptFileActions({
  expenseId,
  className,
}: {
  expenseId: string
  className?: string
}) {
  const zainab = useZainab()
  if (!zainab) return null
  const button =
    className ??
    "inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
  return (
    <>
      <a
        href={`/api/receipt/${expenseId}?print=1`}
        target="_blank"
        rel="noreferrer"
        className={button}
      >
        Print
      </a>
      <a href={`/api/receipt/${expenseId}`} className={button}>
        Download
      </a>
    </>
  )
}
