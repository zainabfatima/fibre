"use client"

import { useZainab } from "@/components/view-mode"
import {
  PRINT_ANALYSIS_EDGE,
  PRINT_OUTPUT_EDGE,
  cropDarkOuterBorder,
  mapPrintCrop,
} from "@/lib/print-crop"

const PRINT_FRAME_ID = "receipt-print-frame"
const PRINT_ROOT_ID = "receipt-print-root"
const PRINT_STYLE_ID = "receipt-print-style"

let closePrint: (() => void) | null = null

const PRINT_CSS = `
@page { margin: 0.4in; }
#${PRINT_ROOT_ID} {
  position: fixed;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  background: #fff;
  color-scheme: light;
}
@media print {
  html, body {
    background: #fff !important;
    color-scheme: light !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
    height: auto !important;
    display: block !important;
  }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} {
    display: block !important;
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  #${PRINT_ROOT_ID} img {
    display: block !important;
    width: 100% !important;
    height: auto !important;
    background: #fff !important;
  }
}
`

export async function printReceipt(expenseId: string) {
  if (!/^[\w-]+$/.test(expenseId)) return
  closePrint?.()
  const fileUrl = `/r/${expenseId}`
  try {
    const response = await fetch(fileUrl, { credentials: "same-origin" })
    if (!response.ok) return
    const type = `${response.headers.get("content-type") || ""}`.toLowerCase()
    const blob = await response.blob()
    if (type.includes("pdf") || blob.type.includes("pdf") || (await looksLikePdf(blob))) {
      printPdfBlob(blob)
      return
    }
    const cropped = await cropImageForPrint(blob)
    printImageBlob(cropped ?? blob)
  } catch {
    printPdfFrame(fileUrl)
  }
}

async function looksLikePdf(blob: Blob) {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
}

async function cropImageForPrint(blob: Blob) {
  const decoded = await decodeReceipt(blob)
  try {
    const { source, width, height } = decoded
    if (width < 8 || height < 8) return blob
    const scale = Math.min(1, PRINT_ANALYSIS_EDGE / Math.max(width, height))
    const analysisWidth = Math.max(1, Math.round(width * scale))
    const analysisHeight = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = analysisWidth
    canvas.height = analysisHeight
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return blob
    context.drawImage(source, 0, 0, analysisWidth, analysisHeight)
    let frame: ImageData
    try {
      frame = context.getImageData(0, 0, analysisWidth, analysisHeight)
    } catch {
      return blob
    }
    const found = cropDarkOuterBorder(frame.data, analysisWidth, analysisHeight, 4)
    const rect = mapPrintCrop(found, width, height, analysisWidth, analysisHeight)
    if (rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height) return blob
    const printScale = Math.min(1, PRINT_OUTPUT_EDGE / Math.max(rect.width, rect.height))
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(rect.width * printScale))
    out.height = Math.max(1, Math.round(rect.height * printScale))
    const outContext = out.getContext("2d")
    if (!outContext) return blob
    outContext.fillStyle = "#ffffff"
    outContext.fillRect(0, 0, out.width, out.height)
    outContext.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height)
    const jpeg = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92))
    return jpeg ?? blob
  } finally {
    decoded.close()
  }
}

async function decodeReceipt(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      try {
        const bitmap = await createImageBitmap(blob)
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
      } catch {
        // Fall through to an Image element when the bitmap decoder rejects the file.
      }
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Could not read the receipt"))
      image.src = url
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function printImageBlob(blob: Blob) {
  closePrint?.()
  const url = URL.createObjectURL(blob)
  const style = document.createElement("style")
  style.id = PRINT_STYLE_ID
  style.textContent = PRINT_CSS
  const root = document.createElement("div")
  root.id = PRINT_ROOT_ID
  root.setAttribute("aria-hidden", "true")
  const image = document.createElement("img")
  image.alt = "Receipt"
  image.src = url
  root.appendChild(image)

  const media = window.matchMedia("print")
  const cleanup = () => {
    window.removeEventListener("afterprint", onAfterPrint)
    media.removeEventListener("change", onMedia)
    style.remove()
    root.remove()
    URL.revokeObjectURL(url)
    if (closePrint === cleanup) closePrint = null
  }
  const onAfterPrint = () => window.setTimeout(cleanup, 400)
  const onMedia = () => {
    if (!media.matches) window.setTimeout(cleanup, 400)
  }
  closePrint = cleanup
  window.addEventListener("afterprint", onAfterPrint)
  media.addEventListener("change", onMedia)
  document.head.appendChild(style)
  document.body.appendChild(root)

  const start = () => {
    window.focus()
    window.print()
  }
  if (image.complete && image.naturalWidth) start()
  else image.addEventListener("load", start, { once: true })
  image.addEventListener("error", () => cleanup(), { once: true })
  window.setTimeout(cleanup, 120_000)
}

function printPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  printPdfFrame(url, () => URL.revokeObjectURL(url))
}

function printPdfFrame(fileUrl: string, onClose?: () => void) {
  closePrint?.()
  const iframe = document.createElement("iframe")
  iframe.id = PRINT_FRAME_ID
  iframe.title = "Print receipt"
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText =
    "position:fixed;left:0;top:0;width:816px;height:1056px;border:0;background:#fff;opacity:0;pointer-events:none;"
  const cleanup = () => {
    iframe.remove()
    onClose?.()
    if (closePrint === cleanup) closePrint = null
  }
  closePrint = cleanup
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
    <button type="button" className={className} onClick={() => void printReceipt(expenseId)}>
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
