import { NextResponse } from "next/server"

import { buildWorkbook } from "@/lib/excel-export"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionToken } from "@/lib/session"

export const maxDuration = 60

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params
  const url = new URL(request.url)
  const shareToken = url.searchParams.get("t")
  const session = await getSessionToken()
  const admin = createAdminClient()
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  if (!session && (!shareToken || project.share_token !== shareToken)) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  const [{ data: categories }, { data: expenses }] = await Promise.all([
    admin.from("v_project_category_totals").select("*").eq("project_id", projectId).order("code"),
    admin
      .from("v_expense_rows")
      .select("*")
      .eq("project_id", projectId)
      .eq("verification_status", "verified")
      .order("expense_date", { ascending: false, nullsFirst: false }),
  ])

  const workbook = await buildWorkbook({
    project,
    categories: categories ?? [],
    expenses: expenses ?? [],
  })
  return new NextResponse(new Uint8Array(workbook.body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
    },
  })
}
