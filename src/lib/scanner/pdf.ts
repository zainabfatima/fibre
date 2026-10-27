import { PDFDocument } from "pdf-lib"

export const RECEIPT_UPLOAD_ACCEPT = "image/*,.heic,.heif,.pdf,application/pdf"

export function isPdfFile(file: { type?: string; name?: string }) {
  const type = file.type ?? ""
  const name = file.name ?? ""
  return type === "application/pdf" || name.toLowerCase().endsWith(".pdf")
}

/** A picked file is a PDF even when a phone leaves the type blank or generic. */
export async function isPdfUpload(file: File) {
  if (isPdfFile(file)) return true
  if (file.type.startsWith("image/")) return false
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return bytes.length >= 4 && String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) === "%PDF"
}

/** Same PDF bytes, with a type and name the upload action accepts. */
export function asPdfFile(file: File) {
  if (file.type === "application/pdf" && file.name.toLowerCase().endsWith(".pdf")) return file
  const name = file.name.toLowerCase().endsWith(".pdf") ? file.name : "receipt.pdf"
  return new File([file], name, { type: "application/pdf", lastModified: file.lastModified })
}

export async function pdfPageCount(file: Blob) {
  try {
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
    const count = doc.getPageCount()
    return count > 0 ? Math.min(20, count) : 1
  } catch {
    return 1
  }
}

export async function imagesToPdf(pages: Blob[]) {
  const pdf = await PDFDocument.create()
  for (const pageBlob of pages) {
    const bytes = new Uint8Array(await pageBlob.arrayBuffer())
    const image = pageBlob.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const page = pdf.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  const saved = await pdf.save()
  return new Blob([saved.buffer as ArrayBuffer], { type: "application/pdf" })
}

type PdfTextChunk = { items?: Array<{ str?: string }> }

/**
 * Read page text without `page.getTextContent()`.
 * pdf.js walks that result with `for await` on a ReadableStream. Safari has no
 * `ReadableStream` async iterator, so the call throws
 * "undefined is not a function (near '...t of e...')".
 */
export async function readPdfPageText(page: { streamTextContent: () => ReadableStream<PdfTextChunk> }) {
  const reader = page.streamTextContent().getReader()
  const parts: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const item of value?.items ?? []) {
        if (typeof item?.str === "string" && item.str) parts.push(item.str)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

function ensureReadableStreamAsyncIterator() {
  const prototype = ReadableStream.prototype as ReadableStream<unknown> & {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
  }
  if (typeof prototype[Symbol.asyncIterator] === "function") return
  prototype[Symbol.asyncIterator] = async function* readableStreamIterator(this: ReadableStream<unknown>) {
    const reader = this.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
}

export async function renderPdf(file: Blob, options?: { maxLongSide?: number }) {
  ensureReadableStreamAsyncIterator()
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: Array<{ blob: Blob; text: string }> = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number)
    const text = await readPdfPageText(page)
    const base = page.getViewport({ scale: 1 })
    const longSide = Math.max(base.width, base.height)
    const scale = options?.maxLongSide
      ? Math.min(4, Math.max(1, options.maxLongSide / longSide))
      : 2
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not read the PDF")
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
    if (!blob) throw new Error("Could not read a PDF page")
    pages.push({ blob, text })
  }
  const hasText = pages.some((page) => page.text.length > 40)
  return { pages, hasText }
}
