import "server-only"

import ExcelJS from "exceljs"

import { appBaseUrl } from "@/lib/queries"
import { centsToMoney, formatMoney, moneyToCents, sumCents } from "@/lib/money"
import { formatCategory } from "@/lib/format"
import { invoiceStatusLabel } from "@/lib/labels"
import { createAdminClient } from "@/lib/supabase/admin"
import type { CategoryTotalRow, ExpenseRow, InvoiceRow, ProjectRow, SummaryRow } from "@/lib/queries"

type ReceiptImage = { buffer: Buffer; extension: "jpeg" | "png" }

function rasterKind(bytes: Buffer): "jpeg" | "png" | null {
  if (bytes.length > 8 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png"
  }
  return null
}

async function loadPicture(path: string): Promise<ReceiptImage | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from("receipts").download(path)
  if (error || !data) return null
  const bytes = Buffer.from(await data.arrayBuffer())
  const extension = rasterKind(bytes)
  if (!extension) return null
  return { buffer: bytes, extension }
}

function pictureCandidates(row: ExpenseRow) {
  const file = row.receipt_file_path
  const lower = file.toLowerCase()
  const paths: string[] = []
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) paths.push(file)
  if (row.receipt_thumbnail_path && !paths.includes(row.receipt_thumbnail_path)) {
    paths.push(row.receipt_thumbnail_path)
  }
  return paths
}

async function loadPictures(rows: ExpenseRow[]) {
  const paths = [...new Set(rows.flatMap(pictureCandidates))]
  const images = new Map<string, ReceiptImage>()
  let cursor = 0
  async function worker() {
    while (cursor < paths.length) {
      const index = cursor
      cursor += 1
      const path = paths[index]
      const image = await loadPicture(path)
      if (image) images.set(path, image)
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, paths.length) }, () => worker()))
  return images
}

function sheetTitle(name: string) {
  return name.replace(/[\\/*?:\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet"
}

function fileName(name: string) {
  const safe = name.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "Project"
  return `${safe}_Expenses_${new Date().toISOString().slice(0, 10)}.xlsx`
}

function linkCell(url: string, label: string) {
  return {
    text: label,
    hyperlink: url,
  }
}

export async function buildWorkbook(input: {
  project: ProjectRow
  summary: SummaryRow | null
  categories: CategoryTotalRow[]
  expenses: ExpenseRow[]
  invoices: InvoiceRow[]
  invoiceCounts: Map<string, number>
  includeUnverified: boolean
  byCategory: boolean
}) {
  const rows = input.expenses

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Fibre"

  const summary = workbook.addWorksheet("Summary")
  summary.addRows([
    ["Project", input.project.name],
    ["Address", input.project.address ?? ""],
    ["Client", input.project.client_name ?? ""],
    [],
    ["Code", "Category", "Budget", "Spent", "Variance", "Receipts"],
  ])
  for (const category of input.categories) {
    summary.addRow([
      category.code,
      category.name,
      category.budget == null ? null : Number(category.budget),
      Number(category.total_spent),
      category.variance == null ? null : Number(category.variance),
      category.receipt_count,
    ])
  }
  const spent = input.summary ? moneyToCents(input.summary.total_spent) : 0
  summary.addRows([
    [],
    ["Grand total", null, null, Number(centsToMoney(spent))],
    ["Invoiced", Number(input.summary?.total_invoiced ?? 0)],
    ["Not invoiced", Number(input.summary?.total_not_invoiced ?? 0)],
    ["Paid", Number(input.summary?.total_paid ?? 0)],
    ["Pending", Number(input.summary?.total_pending ?? 0)],
  ])
  summary.getColumn(3).numFmt = '"$"#,##0.00'
  summary.getColumn(4).numFmt = '"$"#,##0.00'
  summary.getColumn(5).numFmt = '"$"#,##0.00'

  const addExpenseSheet = (name: string, sheetRows: ExpenseRow[]) => {
    const sheet = workbook.addWorksheet(sheetTitle(name))
    sheet.addRow(["Date", "Vendor", "Amount", "Invoice #", "Invoice status"])
    sheet.getColumn(3).numFmt = '"$"#,##0.00'
    sheet.getColumn(1).width = 14
    sheet.getColumn(2).width = 28
    sheet.getColumn(3).width = 16
    sheet.getColumn(4).width = 18
    sheet.getColumn(5).width = 18
    for (const row of sheetRows) {
      sheet.addRow([
        row.expense_date,
        row.vendor,
        Number(row.amount),
        row.invoice_number ?? "",
        invoiceStatusLabel(row.invoice_status),
      ])
    }
    const last = Math.max(sheet.rowCount, 2)
    const totalRow = sheet.addRow(["", "Total", { formula: `SUBTOTAL(109,C2:C${last})` }])
    totalRow.font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    if (sheet.rowCount > 1) {
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: 5 } }
    }
  }

  addExpenseSheet("Expenses", rows)

  const invoices = workbook.addWorksheet("Invoices")
  invoices.addRow(["Number", "Date", "Expenses", "Amount", "Status", "Paid"])
  for (const invoice of input.invoices) {
    invoices.addRow([
      invoice.invoice_number,
      invoice.invoice_date,
      input.invoiceCounts.get(invoice.id) ?? 0,
      Number(invoice.subtotal),
      invoice.status,
      Number(invoice.amount_paid),
    ])
  }
  ;[4, 6].forEach((column) => {
    invoices.getColumn(column).numFmt = '"$"#,##0.00'
  })
  invoices.views = [{ state: "frozen", ySplit: 1 }]
  if (invoices.rowCount > 1) {
    invoices.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: invoices.rowCount, column: 6 },
    }
  }

  const missing = input.expenses.filter(
    (row) => !row.invoice_id,
  )
  addExpenseSheet("Not Invoiced", missing)

  for (const category of input.categories) {
    const group = rows.filter((row) => row.category_id === category.category_id)
    addExpenseSheet(`${String(category.code).padStart(2, "0")} ${category.name}`, group)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    body: Buffer.from(buffer),
    filename: fileName(input.project.name),
    total: formatMoney(centsToMoney(sumCents(rows.map((row) => row.amount)))),
  }
}
