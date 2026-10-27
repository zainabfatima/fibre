import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/app-session"
import { buildSummaryWorkbook, buildWorkbook } from "@/lib/excel-export"
import { clientSessionOwnsProject } from "@/lib/client-access"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params
  const url = new URL(request.url)
  const shareToken = url.searchParams.get("t")
  const summary = url.searchParams.get("kind") === "summary"
  const sessionUser = await getSessionUser()
  if (sessionUser?.role === "staff") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }
  const office = sessionUser?.role === "admin"
  const clientOwns = await clientSessionOwnsProject(projectId)
  const admin = createAdminClient()
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  const shareAllowed = Boolean(shareToken && project.share_token === shareToken)
  if (!office && !clientOwns && !shareAllowed) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  let expensesQuery = admin
    .from("v_expense_rows")
    .select("*")
    .eq("project_id", projectId)
    .order("expense_date", { ascending: false, nullsFirst: false })
  if (!office && !clientOwns) expensesQuery = expensesQuery.eq("verification_status", "verified")

  const [{ data: categories }, { data: expenses }, { data: clientPaid }, { data: payments }] = await Promise.all([
    summary ? Promise.resolve({ data: [] }) : admin.from("v_project_category_totals").select("*").eq("project_id", projectId).order("code"),
    expensesQuery,
    admin.from("client_paid_expenses").select("paid_date, amount, note").eq("project_id", projectId).order("paid_date"),
    summary
      ? admin.from("client_payments").select("received_date, amount, note").eq("project_id", projectId).order("received_date")
      : Promise.resolve({ data: [] }),
  ])

  const workbook = summary
    ? await buildSummaryWorkbook({
        project,
        expenses: expenses ?? [],
        clientPaid: clientPaid ?? [],
        payments: payments ?? [],
      })
    : await buildWorkbook({
        project,
        categories: categories ?? [],
        expenses: expenses ?? [],
        clientPaid: clientPaid ?? [],
      })
  return new NextResponse(new Uint8Array(workbook.body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
    },
  })
}
