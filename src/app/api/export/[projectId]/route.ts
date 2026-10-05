import { NextResponse } from "next/server"

import { requireAdminApi } from "@/lib/db"
import { buildWorkbook } from "@/lib/excel-export"
import {
  getProject,
  getSummary,
  listCategoryTotals,
  listExpenseRows,
  listInvoices,
} from "@/lib/queries"

export const maxDuration = 60

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { projectId } = await context.params
  const project = await getProject(projectId)
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  const url = new URL(request.url)
  const [summary, categories, expenses, invoices] = await Promise.all([
    getSummary(projectId),
    listCategoryTotals(projectId),
    listExpenseRows(projectId),
    listInvoices(projectId),
  ])
  const invoiceCounts = new Map<string, number>()
  for (const expense of expenses) {
    if (!expense.invoice_id) continue
    invoiceCounts.set(expense.invoice_id, (invoiceCounts.get(expense.invoice_id) ?? 0) + 1)
  }
  const workbook = await buildWorkbook({
    project,
    summary,
    categories,
    expenses,
    invoices,
    invoiceCounts,
    includeUnverified: url.searchParams.get("includeUnverified") === "1",
    byCategory: url.searchParams.get("byCategory") === "1",
  })
  return new NextResponse(new Uint8Array(workbook.body), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
    },
  })
}
