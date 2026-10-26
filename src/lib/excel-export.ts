import "server-only"

import ExcelJS from "exceljs"

import { formatCategory } from "@/lib/format"
import { balanceCents, centsToMoney, formatFeePercent, moneyToCents, percentOfCents, sumCents, totalExpenseCents } from "@/lib/money"
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
  clientPaid?: Array<{ paid_date: string; amount: string | number; note: string | null }>
}) {
  const categories = [...input.categories].sort(
    (a, b) => a.code - b.code || a.category_id - b.category_id,
  )
  const billable = input.expenses
  const clientPaid = input.clientPaid ?? []
  const byCategory = new Map<number, ExpenseRow[]>()
  const uncategorized: ExpenseRow[] = []
  for (const expense of billable) {
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

  if (clientPaid.length > 0) {
    const title = sheet.addRow(["Expense paid by client", null, "Subtracted in the balance"])
    title.font = { bold: true, color: { argb: "FF5B21B6" } }
    for (const row of clientPaid) {
      const line = sheet.addRow([row.paid_date, dollars(row.amount), row.note])
      line.getCell(2).font = { color: { argb: "FF5B21B6" } }
    }
    const subtotal = sheet.addRow([
      "Expense paid by client subtotal",
      Number(centsToMoney(sumCents(clientPaid.map((row) => row.amount)))),
      "Subtracted in the balance",
    ])
    subtotal.font = { bold: true, color: { argb: "FF5B21B6" } }
  }

  const billableCents = sumCents(billable.map((row) => row.amount))
  const clientPaidCents = sumCents(clientPaid.map((row) => row.amount))
  const builderFeeCents = percentOfCents(billableCents + clientPaidCents, input.project.builder_fee_percent)
  const clientPaidFeeCents = percentOfCents(clientPaidCents, input.project.builder_fee_percent)
  const feeRow = sheet.addRow([
    "Builder fee",
    Number(centsToMoney(builderFeeCents)),
    "Included in the total",
  ])
  feeRow.font = { bold: true, color: { argb: "FF92400E" } }
  const clientFeeRow = sheet.addRow([
    "Builder fee on paid by client expense",
    Number(centsToMoney(clientPaidFeeCents)),
    "Included in the total",
  ])
  clientFeeRow.font = { bold: true, color: { argb: "FF9F1239" } }
  const totalRow = sheet.addRow([
    "Total expense",
    Number(centsToMoney(totalExpenseCents(billableCents, builderFeeCents))),
    null,
  ])
  totalRow.font = { bold: true, color: { argb: "FF065F46" } }

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    body: Buffer.from(buffer),
    filename: fileName(input.project.name),
  }
}

export async function buildSummaryWorkbook(input: {
  project: ProjectRow
  expenses: Array<{
    expense_date: string | null
    vendor: string | null
    amount: string | number
    category_code: number | null
    category_name: string | null
  }>
  clientPaid: Array<{ paid_date: string; amount: string | number; note: string | null }>
  payments: Array<{ received_date: string; amount: string | number; note: string | null }>
}) {
  const percent = input.project.builder_fee_percent
  const percentLabel = formatFeePercent(percent)
  const billableCents = sumCents(input.expenses.map((row) => row.amount))
  const clientPaidCents = sumCents(input.clientPaid.map((row) => row.amount))
  const receivedCents = sumCents(input.payments.map((row) => row.amount))
  const builderFeeCents = percentOfCents(billableCents + clientPaidCents, percent)
  const clientPaidFeeCents = percentOfCents(clientPaidCents, percent)
  const usualFeeCents = builderFeeCents - clientPaidFeeCents
  const totalCents = totalExpenseCents(billableCents, builderFeeCents)
  const leftCents = balanceCents(totalCents, receivedCents, clientPaidCents)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Fibre"
  const sheet = workbook.addWorksheet("Detailed summary")
  sheet.getColumn(1).width = 42
  sheet.getColumn(2).width = 18
  sheet.getColumn(3).width = 36
  sheet.getColumn(2).numFmt = '"$"#,##0.00'
  for (const column of [1, 2, 3]) sheet.getColumn(column).alignment = { vertical: "middle", wrapText: true }
  sheet.getColumn(2).alignment = { horizontal: "right", vertical: "middle" }

  const title = sheet.addRow(["Detailed expense summary"])
  title.font = { bold: true, size: 16 }
  sheet.addRow([])
  const notes = [
    "Total expense = project expenses + builder fee + builder fee on expenses the client paid.",
    `Builder fee = ${percentLabel}% of the project expenses, rounded to the cent.`,
    `Builder fee on paid by client expense = ${percentLabel}% of the amounts the client paid directly.`,
    `The builder fee is ${percentLabel}% of each category total, not of each expense. Adding the category fees can differ by a few cents from ${percentLabel}% of all project expenses together.`,
    "Balance = total expense − Funds Received − expense paid by client.",
  ]
  for (const note of notes) {
    const row = sheet.addRow([note])
    row.font = { italic: true, color: { argb: "FF57534E" } }
  }
  sheet.addRow([])

  const grouped = new Map<string, { sort: number; rows: typeof input.expenses }>()
  for (const expense of input.expenses) {
    const name = expense.category_code != null && expense.category_name
      ? formatCategory(expense.category_code, expense.category_name)
      : "Uncategorized"
    const group = grouped.get(name) ?? { sort: expense.category_code ?? 9999, rows: [] }
    group.rows.push(expense)
    grouped.set(name, group)
  }
  const categories = [...grouped.entries()].sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
  const categoryFeeSum = categories.reduce((sum, [, group]) => {
    const categoryCents = group.rows.reduce((total, row) => total + moneyToCents(row.amount), 0)
    return sum + percentOfCents(categoryCents, percent)
  }, 0)

  const expenseTotal = sheet.addRow(["Builder fee on all categories", Number(centsToMoney(usualFeeCents)), `${percentLabel}% of all project expenses together`])
  expenseTotal.font = { bold: true, color: { argb: "FF92400E" } }
  if (usualFeeCents !== categoryFeeSum) {
    sheet.addRow(["Rounding to the combined total", Number(centsToMoney(usualFeeCents - categoryFeeSum)), `Category fees add to ${centsToMoney(categoryFeeSum)}`])
  }
  sheet.addRow([])

  const clientHead = sheet.addRow(["Expense paid by client"])
  clientHead.font = { bold: true, color: { argb: "FF5B21B6" } }
  sheet.addRow(["Date and note", "Amount", null]).font = { bold: true }
  for (const row of [...input.clientPaid].sort((a, b) => a.paid_date.localeCompare(b.paid_date))) {
    sheet.addRow([[row.paid_date, row.note].filter(Boolean).join(" · ") || "—", Number(centsToMoney(moneyToCents(row.amount))), null])
  }
  const clientTotal = sheet.addRow([
    "Expense paid by client",
    Number(centsToMoney(clientPaidCents)),
    Number(centsToMoney(clientPaidFeeCents)),
  ])
  clientTotal.font = { bold: true, color: { argb: "FF5B21B6" } }
  sheet.addRow(["Builder fee on paid by client expense", null, "Included in the total. The amount is subtracted in the balance."])
  sheet.addRow([])

  const both = sheet.addRow(["Both builder fees", Number(centsToMoney(builderFeeCents)), "Added together in the total expense"])
  both.font = { bold: true, color: { argb: "FF92400E" } }
  const total = sheet.addRow(["Total expense", Number(centsToMoney(totalCents)), "Project expenses + both builder fees"])
  total.font = { bold: true, color: { argb: "FF065F46" } }
  sheet.addRow([])

  const receivedHead = sheet.addRow(["Funds Received", null, "Subtracted in the balance"])
  receivedHead.font = { bold: true }
  sheet.addRow(["Date and note", "Amount", null]).font = { bold: true }
  for (const payment of [...input.payments].sort((a, b) => a.received_date.localeCompare(b.received_date))) {
    sheet.addRow([
      [payment.received_date, payment.note].filter(Boolean).join(" · "),
      Number(centsToMoney(moneyToCents(payment.amount))),
      null,
    ])
  }
  const receivedTotal = sheet.addRow(["Funds Received", Number(centsToMoney(receivedCents)), null])
  receivedTotal.font = { bold: true }
  const balance = sheet.addRow([
    "Remaining Balance",
    Number(centsToMoney(leftCents)),
    "Total expense − Funds Received − expense paid by client",
  ])
  balance.font = { bold: true, color: { argb: leftCents > 0 ? "FFB91C1C" : "FF065F46" } }
  sheet.addRow([])

  for (const [name, group] of categories) {
    const head = sheet.addRow([name])
    head.font = { bold: true }
    sheet.addRow(["Date and company", "Amount", null]).font = { bold: true }
    const rows = [...group.rows].sort((a, b) => (a.expense_date ?? "9999").localeCompare(b.expense_date ?? "9999"))
    let categoryCents = 0
    for (const row of rows) {
      const amountCents = moneyToCents(row.amount)
      categoryCents += amountCents
      sheet.addRow([[row.expense_date, row.vendor].filter(Boolean).join(" · ") || "—", Number(centsToMoney(amountCents)), null])
    }
    const feeCents = percentOfCents(categoryCents, percent)
    const categoryTotal = sheet.addRow(["Category total", Number(centsToMoney(categoryCents)), null])
    categoryTotal.font = { bold: true }
    const fee = sheet.addRow([`Builder fee (${percentLabel}%)`, Number(centsToMoney(feeCents)), "Percent of this category total. Included in the total."])
    fee.font = { bold: true, color: { argb: "FF92400E" } }
    sheet.addRow([])
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const safe = input.project.name.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "Project"
  return {
    body: Buffer.from(buffer),
    filename: `${safe}_Detailed_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`,
  }
}
