import "server-only"

import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import { formatCategory } from "@/lib/format"
import { formatMoney, sumCents, centsToMoney } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ExpenseRow } from "@/lib/queries"

async function download(path: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from("receipts").download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

export async function buildCategoryPacket(input: {
  projectName: string
  sections: Array<{ code: number; name: string; expenses: ExpenseRow[] }>
}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const section of input.sections) {
    let page = doc.addPage([612, 792])
    let y = 740
    const title = formatCategory(section.code, section.name)
    page.drawText(input.projectName, { x: 48, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) })
    y -= 28
    page.drawText(title, { x: 48, y, size: 20, font: bold })
    y -= 28
    const total = formatMoney(centsToMoney(sumCents(section.expenses.map((row) => row.amount))))
    page.drawText(`${section.expenses.length} receipts · ${total}`, {
      x: 48,
      y,
      size: 12,
      font,
    })
    y -= 24

    for (const expense of section.expenses) {
      const line = [
        expense.expense_date ?? "No date",
        expense.vendor ?? "Unknown vendor",
        formatMoney(expense.amount),
        expense.description ?? "",
      ].join("  ·  ")
      if (y < 72) {
        page = doc.addPage([612, 792])
        y = 740
      }
      page.drawText(line.slice(0, 110), { x: 48, y, size: 10, font })
      y -= 16
    }

    for (const expense of section.expenses) {
      const bytes = await download(expense.receipt_file_path)
      if (!bytes) continue
      if (expense.receipt_file_path.endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF") {
        const source = await PDFDocument.load(bytes)
        const copied = await doc.copyPages(source, source.getPageIndices())
        copied.forEach((copiedPage) => doc.addPage(copiedPage))
        continue
      }
      const image = expense.receipt_file_path.endsWith(".png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes)
      const sheet = doc.addPage([612, 792])
      const caption = `${expense.vendor ?? "Receipt"} · ${formatMoney(expense.amount)}`
      sheet.drawText(caption, { x: 36, y: 760, size: 11, font: bold })
      const scale = Math.min(540 / image.width, 700 / image.height)
      const width = image.width * scale
      const height = image.height * scale
      sheet.drawImage(image, {
        x: (612 - width) / 2,
        y: 40,
        width,
        height,
      })
    }
  }

  if (doc.getPageCount() === 0) {
    const page = doc.addPage([612, 792])
    page.drawText("No receipts in this packet.", { x: 48, y: 740, size: 16, font })
  }

  return Buffer.from(await doc.save())
}
