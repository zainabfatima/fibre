"use client"

import { useZainab } from "@/components/view-mode"

const PRINT_FRAME_ID = "receipt-print-frame"
let closePrintFrame: (() => void) | null = null

export function printReceipt(expenseId: string) {
  if (!/^[\w-]+$/.test(expenseId)) return
  closePrintFrame?.()

  const fileUrl = `/r/${expenseId}`
  const iframe = document.createElement("iframe")
  iframe.id = PRINT_FRAME_ID
  iframe.title = "Print receipt"
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;"

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.source !== iframe.contentWindow) return
    const data = event.data as { source?: string; kind?: string } | null
    if (!data || data.source !== "receipt-print") return
    if (data.kind === "pdf") {
      printPdfFrame(fileUrl, cleanup)
      return
    }
    window.setTimeout(cleanup, 400)
  }
  const cleanup = () => {
    window.removeEventListener("message", onMessage)
    iframe.remove()
    if (closePrintFrame === cleanup) closePrintFrame = null
  }
  closePrintFrame = cleanup
  window.addEventListener("message", onMessage)

  iframe.srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt</title>
<style>
  @page { margin: 0.4in; }
  html, body { margin: 0; background: #fff; }
  img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
<img id="shot" alt="Receipt" src="${fileUrl}">
<script>
  const img = document.getElementById("shot")
  img.addEventListener("load", function () {
    window.addEventListener("afterprint", function () {
      parent.postMessage({ source: "receipt-print" }, location.origin)
    })
    window.focus()
    window.print()
  })
  img.addEventListener("error", function () {
    parent.postMessage({ source: "receipt-print", kind: "pdf" }, location.origin)
  })
</script>
</body>
</html>`

  document.body.appendChild(iframe)
  window.setTimeout(cleanup, 120_000)
}

function printPdfFrame(fileUrl: string, closeImageFrame: () => void) {
  closeImageFrame()
  const iframe = document.createElement("iframe")
  iframe.id = PRINT_FRAME_ID
  iframe.title = "Print receipt"
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;"
  const cleanup = () => {
    iframe.remove()
    if (closePrintFrame === cleanup) closePrintFrame = null
  }
  closePrintFrame = cleanup
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) return
    win.addEventListener("afterprint", () => window.setTimeout(cleanup, 400))
    win.focus()
    win.print()
  }
  iframe.src = fileUrl
  document.body.appendChild(iframe)
  window.setTimeout(cleanup, 120_000)
}

export function ReceiptPrintButton({
  expenseId,
  className,
}: {
  expenseId: string
  className: string
}) {
  return (
    <button type="button" className={className} onClick={() => printReceipt(expenseId)}>
      Print
    </button>
  )
}

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
