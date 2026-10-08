import "server-only"

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import { formatMoney, sumCents, centsToMoney } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ExpenseRow } from "@/lib/queries"

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN_X = 48
const RIGHT = PAGE_WIDTH - MARGIN_X
const DATE_X = MARGIN_X
const COMPANY_X = 158
const COMPANY_WIDTH = 286
const PRINT_MARGIN = 18

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function pdfSafe(value: string) {
  return value
    .replace(/\u2013|\u2014|\u2212/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\x20-\x7E]/g, "?")
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number) {
  const clean = pdfSafe(text)
  if (!clean) return ""
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean
  const ellipsis = "..."
  let end = clean.length
  while (end > 0 && font.widthOfTextAtSize(`${clean.slice(0, end)}${ellipsis}`, size) > maxWidth) {
    end -= 1
  }
  return end === 0 ? ellipsis : `${clean.slice(0, end)}${ellipsis}`
}

function formatDate(value: string | null) {
  if (!value) return "No date"
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return pdfSafe(value)
  const month = MONTHS[Number(match[2]) - 1]
  if (!month) return pdfSafe(value)
  return `${month} ${Number(match[3])}, ${match[1]}`
}

function drawRight(page: PDFPage, text: string, y: number, size: number, font: PDFFont) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: RIGHT - width, y, size, font })
}

function isPdf(bytes: Buffer, path: string, fileType: string) {
  if (fileType === "pdf" || path.toLowerCase().endsWith(".pdf")) return true
  return bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")
}

function isPng(bytes: Buffer) {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Math.min(limit, items.length)
  if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

function addNote(doc: PDFDocument, font: PDFFont, text: string) {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const lines = pdfSafe(text).split(" ").reduce<string[]>((rows, word) => {
    const current = rows[rows.length - 1] ?? ""
    const next = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(next, 12) > RIGHT - MARGIN_X) rows.push(word)
    else if (current) rows[rows.length - 1] = next
    else rows.push(word)
    return rows
  }, [])
  let y = 720
  for (const line of lines) {
    page.drawText(line, { x: MARGIN_X, y, size: 12, font })
    y -= 18
  }
}

function drawFitted(
  doc: PDFDocument,
  sourceWidth: number,
  sourceHeight: number,
  paint: (page: PDFPage, x: number, y: number, width: number, height: number) => void,
) {
  if (!sourceWidth || !sourceHeight) return
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const maxW = PAGE_WIDTH - PRINT_MARGIN * 2
  const maxH = PAGE_HEIGHT - PRINT_MARGIN * 2
  const scale = Math.min(maxW / sourceWidth, maxH / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  paint(page, (PAGE_WIDTH - width) / 2, (PAGE_HEIGHT - height) / 2, width, height)
}

export async function buildCategoryPacket(input: {
  projectName: string
  heading: string
  expenses: ExpenseRow[]
}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const title = pdfSafe(input.heading) || "Category"
  const project = fitText(font, input.projectName, 11, RIGHT - MARGIN_X)
  const titleLines = wrap(bold, title, 16, RIGHT - MARGIN_X)
  const total = formatMoney(centsToMoney(sumCents(input.expenses.map((row) => row.amount))))

  const startPage = (isContinued: boolean) => {
    const next = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    let cursor = 744
    if (project) {
      next.drawText(project, { x: MARGIN_X, y: cursor, size: 11, font, color: rgb(0.28, 0.28, 0.28) })
      cursor -= 22
    }
    for (const line of titleLines) {
      next.drawText(line, { x: MARGIN_X, y: cursor, size: 16, font: bold })
      cursor -= 20
    }
    if (isContinued) {
      next.drawText("Continued", { x: MARGIN_X, y: cursor, size: 10, font, color: rgb(0.4, 0.4, 0.4) })
      cursor -= 16
    }
    cursor -= 6
    next.drawText("Date", { x: DATE_X, y: cursor, size: 10, font: bold })
    next.drawText("Company", { x: COMPANY_X, y: cursor, size: 10, font: bold })
    drawRight(next, "Amount", cursor, 10, bold)
    cursor -= 6
    next.drawLine({
      start: { x: MARGIN_X, y: cursor },
      end: { x: RIGHT, y: cursor },
      thickness: 0.75,
      color: rgb(0.55, 0.55, 0.55),
    })
    cursor -= 18
    return { next, cursor }
  }

  const first = startPage(false)
  let page = first.next
  let y = first.cursor

  const openPage = () => {
    const started = startPage(true)
    page = started.next
    y = started.cursor
  }

  if (input.expenses.length === 0) {
    page.drawText("No expenses", { x: MARGIN_X, y, size: 11, font, color: rgb(0.35, 0.35, 0.35) })
    y -= 22
  }

  for (const expense of input.expenses) {
    if (y < 96) openPage()
    const date = formatDate(expense.expense_date)
    const company = fitText(font, expense.vendor?.trim() || "", 10, COMPANY_WIDTH)
    const amount = formatMoney(expense.amount)
    page.drawText(date, { x: DATE_X, y, size: 10, font })
    if (company) page.drawText(company, { x: COMPANY_X, y, size: 10, font })
    drawRight(page, amount, y, 10, font)
    y -= 16
  }

  if (y < 72) openPage()
  y -= 4
  page.drawLine({
    start: { x: MARGIN_X, y: y + 12 },
    end: { x: RIGHT, y: y + 12 },
    thickness: 0.75,
    color: rgb(0.2, 0.2, 0.2),
  })
  page.drawText("Category total", { x: MARGIN_X, y, size: 12, font: bold })
  drawRight(page, total, y, 12, bold)

  const receipts: Array<{ path: string; fileType: string; label: string }> = []
  const seen = new Set<string>()
  for (const expense of input.expenses) {
    const path = expense.receipt_file_path
    if (!path || seen.has(path)) continue
    seen.add(path)
    const vendor = expense.vendor?.trim() || "Receipt"
    receipts.push({
      path,
      fileType: expense.file_type,
      label: `${vendor} ${formatMoney(expense.amount)} ${formatDate(expense.expense_date)}`,
    })
  }

  const supabase = createAdminClient()
  const files = await mapPool(receipts, 4, async (receipt) => {
    const { data, error } = await supabase.storage.from("receipts").download(receipt.path)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  })

  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index]
    const bytes = files[index]
    if (!bytes) {
      addNote(doc, font, `${receipt.label}. Receipt file missing.`)
      continue
    }
    try {
      if (isPdf(bytes, receipt.path, receipt.fileType)) {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const indices = source.getPageIndices()
        if (indices.length === 0) {
          addNote(doc, font, `${receipt.label}. Receipt had no pages.`)
          continue
        }
        const embedded = await doc.embedPdf(source, indices)
        for (const embeddedPage of embedded) {
          drawFitted(doc, embeddedPage.width, embeddedPage.height, (sheet, x, yPos, width, height) => {
            sheet.drawPage(embeddedPage, { x, y: yPos, width, height })
          })
        }
        continue
      }
      const image = isPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      drawFitted(doc, image.width, image.height, (sheet, x, yPos, width, height) => {
        sheet.drawImage(image, { x, y: yPos, width, height })
      })
    } catch {
      addNote(doc, font, `${receipt.label}. Receipt could not be printed.`)
    }
  }

  doc.setTitle(pdfSafe(`${input.projectName} ${title}`).slice(0, 120))
  doc.setCreator("Fibre")
  return Buffer.from(await doc.save())
}

export async function buildReceiptPdf(input: {
  bytes: Buffer
  path: string
  fileType: string
  title: string
}) {
  if (isPdf(input.bytes, input.path, input.fileType)) return input.bytes
  const doc = await PDFDocument.create()
  const image = isPng(input.bytes) ? await doc.embedPng(input.bytes) : await doc.embedJpg(input.bytes)
  drawFitted(doc, image.width, image.height, (sheet, x, y, width, height) => {
    sheet.drawImage(image, { x, y, width, height })
  })
  doc.setTitle(pdfSafe(input.title).slice(0, 120))
  doc.setCreator("Fibre")
  return Buffer.from(await doc.save())
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = pdfSafe(text).split(" ").filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next
    else {
      if (current) lines.push(current)
      current = fitText(font, word, size, maxWidth)
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [""]
}
