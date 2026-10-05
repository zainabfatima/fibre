import "server-only"

import ExcelJS from "exceljs"

import { appBaseUrl } from "@/lib/queries"
import { centsToMoney, formatMoney, moneyToCents, sumCents } from "@/lib/money"
import { formatCategory } from "@/lib/format"
import { invoiceStatusLabel } from "@/lib/labels"
import { createAdminClient } from "@/lib/supabase/admin"
import type { CategoryTotalRow, ExpenseRow, InvoiceRow, ProjectRow, SummaryRow } from "@/lib/queries"

type ReceiptImage = { buffer: Buffer; extension: "jpeg" | "png" }

function picturePath(row: ExpenseRow) {
  const file = row.receipt_file_path.toLowerCase()
  if (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".jpeg")) {
    return row.receipt_file_path
  }
  return row.receipt_thumbnail_path
}

async function loadPicture(path: string): Promise<ReceiptImage | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from("receipts").download(path)
  if (error || !data) return null
  const bytes = Buffer.from(await data.arrayBuffer())
  const extension = path.toLowerCase().endsWith(".png") ? "png" : "jpeg"
  return { buffer: bytes, extension }
}

async function loadPictures(rows: ExpenseRow[]) {
  const paths = [...new Set(rows.map(picturePath).filter((path): path is string => Boolean(path)))]
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
  const base = appBaseUrl()
  const token = input.project.share_token
  const href = (path: string) => `${base}${path}${token ? `?t=${token}` : ""}`
  const rows = input.expenses
  const pictures = await loadPictures(rows)

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

  const imageIds = new Map<string, number>()
  const imageIdFor = (path: string) => {
    const existing = imageIds.get(path)
    if (existing != null) return existing
    const image = pictures.get(path)
    if (!image) return null
    const id = workbook.addImage({
      buffer: image.buffer as unknown as ExcelJS.Buffer,
      extension: image.extension,
    })
    imageIds.set(path, id)
    return id
  }

  const addExpenseSheet = (name: string, sheetRows: ExpenseRow[], withPictures: boolean) => {
    const sheet = workbook.addWorksheet(sheetTitle(name))
    sheet.addRow([
      "#",
      "Date",
      "Vendor",
      "Description",
      "Category",
      "Amount",
      "Receipt",
      "Invoice #",
      "Invoice",
      "Invoice status",
    ])
    sheetRows.forEach((row, index) => {
      const added = sheet.addRow([
        index + 1,
        row.expense_date,
        row.vendor,
        row.description,
        row.category_code && row.category_name
          ? formatCategory(row.category_code, row.category_name)
          : "",
        Number(row.amount),
        "Open receipt",
        row.invoice_number ?? "",
        row.invoice_id ? "Open invoice" : "",
        invoiceStatusLabel(row.invoice_status),
      ])
      const receipt = added.getCell(7)
      receipt.value = linkCell(href(`/r/${row.id}`), "Open receipt")
      receipt.font = { color: { argb: "FF1D4E89" }, underline: true }
      if (row.invoice_id) {
        const invoice = added.getCell(9)
        invoice.value = linkCell(href(`/i/${row.invoice_id}`), "Open invoice")
        invoice.font = { color: { argb: "FF1D4E89" }, underline: true }
      }
      const path = picturePath(row)
      const imageId = withPictures && path ? imageIdFor(path) : null
      if (imageId != null) {
        added.height = 90
        sheet.addImage(imageId, {
          tl: { col: 6, row: added.number - 1 },
          ext: { width: 96, height: 96 },
          editAs: "oneCell",
        })
      }
    })
    const last = Math.max(sheet.rowCount, 2)
    const totalRow = sheet.addRow([
      "",
      "",
      "",
      "",
      "Total",
      { formula: `SUBTOTAL(109,F2:F${last})` },
    ])
    totalRow.font = { bold: true }
    sheet.getColumn(6).numFmt = '"$"#,##0.00'
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: 10 } }
    sheet.columns.forEach((column) => {
      column.width = 18
    })
    sheet.getColumn(4).width = 36
    if (withPictures) sheet.getColumn(7).width = 16
  }

  addExpenseSheet("Expenses", rows, true)

  const invoices = workbook.addWorksheet("Invoices")
  invoices.addRow([
    "Number",
    "Date",
    "Expenses",
    "Amount",
    "Status",
    "Paid",
    "File",
  ])
  for (const invoice of input.invoices) {
    const added = invoices.addRow([
      invoice.invoice_number,
      invoice.invoice_date,
      input.invoiceCounts.get(invoice.id) ?? 0,
      Number(invoice.subtotal),
      invoice.status,
      Number(invoice.amount_paid),
      invoice.file_path ? "Open invoice" : "",
    ])
    if (invoice.file_path) {
      const cell = added.getCell(7)
      cell.value = linkCell(href(`/i/${invoice.id}`), "Open invoice")
      cell.font = { color: { argb: "FF1D4E89" }, underline: true }
    }
  }
  ;[4, 6].forEach((column) => {
    invoices.getColumn(column).numFmt = '"$"#,##0.00'
  })
  invoices.views = [{ state: "frozen", ySplit: 1 }]
  if (invoices.rowCount > 1) {
    invoices.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: invoices.rowCount, column: 7 },
    }
  }

  const missing = input.expenses.filter(
    (row) => !row.invoice_id,
  )
  addExpenseSheet("Not Invoiced", missing, true)

  for (const category of input.categories) {
    const group = rows.filter((row) => row.category_id === category.category_id)
    addExpenseSheet(
      `${String(category.code).padStart(2, "0")} ${category.name}`,
      group,
      true,
    )
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    body: Buffer.from(buffer),
    filename: fileName(input.project.name),
    total: formatMoney(centsToMoney(sumCents(rows.map((row) => row.amount)))),
  }
}
