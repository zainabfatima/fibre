import { PDFDocument } from "pdf-lib"

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

export async function renderPdf(file: Blob) {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: Array<{ blob: Blob; text: string }> = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number)
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim()
    const viewport = page.getViewport({ scale: 2 })
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
