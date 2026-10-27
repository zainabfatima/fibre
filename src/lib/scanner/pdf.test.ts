import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { PDFDocument, StandardFonts } from "pdf-lib"

import { asPdfFile, isPdfFile, isPdfUpload, pdfPageCount, readPdfPageText } from "./pdf.ts"

async function samplePdf(text: string) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 24, y: 100, size: 18, font })
  return new Uint8Array(await doc.save())
}

describe("PDF receipts stay the original file", () => {
  it("keeps a laptop PDF file and its bytes", async () => {
    const bytes = await samplePdf("Laptop receipt")
    const file = new File([bytes], "receipt.pdf", { type: "application/pdf" })
    assert.equal(isPdfFile(file), true)
    assert.equal(await isPdfUpload(file), true)
    assert.equal(asPdfFile(file), file)
    assert.equal(await pdfPageCount(file), 1)
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes)
  })

  it("accepts a phone PDF with a blank type and no .pdf name", async () => {
    const bytes = await samplePdf("Phone receipt")
    const phone = new File([bytes], "scan", { type: "" })
    assert.equal(isPdfFile(phone), false)
    assert.equal(await isPdfUpload(phone), true)
    const ready = asPdfFile(phone)
    assert.equal(ready.type, "application/pdf")
    assert.equal(ready.name, "receipt.pdf")
    assert.deepEqual(new Uint8Array(await ready.arrayBuffer()), bytes)
    assert.equal(await pdfPageCount(ready), 1)
  })

  it("does not treat a photo as a PDF", async () => {
    const photo = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0x00])], "receipt.jpg", { type: "image/jpeg" })
    assert.equal(await isPdfUpload(photo), false)
    assert.equal(isPdfFile(photo), false)
  })

  it("reads a real PDF when pdf.js cannot use for-await", async () => {
    const bytes = await samplePdf("Office supply 18.40")
    const prototype = ReadableStream.prototype as ReadableStream<unknown> & {
      [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
    }
    const original = prototype[Symbol.asyncIterator]
    delete prototype[Symbol.asyncIterator]
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
      const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false }).promise
      const page = await pdf.getPage(1)
      await assert.rejects(() => page.getTextContent(), /not async iterable|not a function/)
      assert.equal(await readPdfPageText(page), "Office supply 18.40")
    } finally {
      if (original) prototype[Symbol.asyncIterator] = original
    }
  })

  it("reads page text when a ReadableStream has no async iterator", async () => {
    const prototype = ReadableStream.prototype as ReadableStream<unknown> & {
      [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
    }
    const original = prototype[Symbol.asyncIterator]
    delete prototype[Symbol.asyncIterator]
    const chunks = [{ items: [{ str: "Store" }, { str: "42.15" }] }, { items: [{ str: "tax" }] }]
    const page = {
      streamTextContent() {
        let index = 0
        return new ReadableStream({
          pull(controller) {
            if (index >= chunks.length) {
              controller.close()
              return
            }
            controller.enqueue(chunks[index])
            index += 1
          },
        })
      },
    }
    try {
      await assert.rejects(async () => {
        for await (const value of page.streamTextContent()) void value
      })
      assert.equal(await readPdfPageText(page), "Store 42.15 tax")
    } finally {
      if (original) prototype[Symbol.asyncIterator] = original
    }
  })
})
