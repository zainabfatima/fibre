import "server-only"

import ExcelJS from "exceljs"

import { formatCategory } from "@/lib/format"
import { centsToMoney, moneyToCents, sumCents } from "@/lib/money"
import type { CategoryTotalRow, ExpenseRow, ProjectRow } from "@/lib/queries"

function dollars(value: string | number) {
  return Number(centsToMoney(moneyToCents(value)))
}

function fileName(name: string) {
  const safe = name.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "Project"
  return `${safe}_Expenses_${new Date().toISOString().slice(0, 10)}.xlsx`
}

function companyName(vendor: string | null) {
  const name = vendor?.trim()
  return name ? name : null
}

export async function buildWorkbook(input: {
  project: ProjectRow
  categories: CategoryTotalRow[]
  expenses: ExpenseRow[]
}) {
  const categories = [...input.categories].sort(
    (a, b) => a.code - b.code || a.category_id - b.category_id,
  )
  const byCategory = new Map<number, ExpenseRow[]>()
  const uncategorized: ExpenseRow[] = []
  for (const expense of input.expenses) {
    if (expense.category_id == null) {
      uncategorized.push(expense)
      continue
    }
    const group = byCategory.get(expense.category_id)
    if (group) group.push(expense)
    else byCategory.set(expense.category_id, [expense])
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Fibre"
  const sheet = workbook.addWorksheet("Expenses")
  sheet.getColumn(1).width = 42
  sheet.getColumn(2).width = 16
  sheet.getColumn(2).numFmt = '"$"#,##0.00'
  sheet.getColumn(3).width = 36
  sheet.getColumn(1).alignment = { vertical: "middle", wrapText: true }
  sheet.getColumn(2).alignment = { horizontal: "right", vertical: "middle" }
  sheet.getColumn(3).alignment = { vertical: "middle", wrapText: true }

  const header = sheet.addRow(["Category", "Amount", "Company"])
  header.font = { bold: true }
  header.alignment = { vertical: "middle" }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  }

  const addSection = (title: string, rows: ExpenseRow[]) => {
    const categoryRow = sheet.addRow([title, null, null])
    categoryRow.font = { bold: true }
    for (const row of rows) {
      sheet.addRow([null, dollars(row.amount), companyName(row.vendor)])
    }
    const subtotal = sheet.addRow([
      "Subtotal",
      Number(centsToMoney(sumCents(rows.map((row) => row.amount)))),
      null,
    ])
    subtotal.font = { bold: true }
  }

  for (const category of categories) {
    addSection(
      formatCategory(category.code, category.name),
      byCategory.get(category.category_id) ?? [],
    )
  }
  if (uncategorized.length > 0) addSection("Uncategorized", uncategorized)

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    body: Buffer.from(buffer),
    filename: fileName(input.project.name),
  }
}
