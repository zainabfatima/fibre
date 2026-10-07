import { NextResponse } from "next/server"

import { buildCategoryPacket } from "@/lib/category-packet"
import { requireAdminApi } from "@/lib/db"
import { formatCategory } from "@/lib/format"

export const maxDuration = 60

function slug(value: string) {
  return value.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "File"
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; categoryId: string }> },
) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: "Sign in required" }, { status: 401 })

  const { projectId, categoryId } = await context.params
  const needsOnly = new URL(request.url).searchParams.get("needs") === "1"
  const uncategorized = categoryId === "none"
  const categoryNumeric = Number(categoryId)
  if (!uncategorized && !Number.isInteger(categoryNumeric)) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  let expensesQuery = admin
    .from("v_expense_rows")
    .select("*")
    .eq("project_id", projectId)

  expensesQuery = uncategorized
    ? expensesQuery.is("category_id", null)
    : expensesQuery.eq("category_id", categoryNumeric)
  if (needsOnly) expensesQuery = expensesQuery.is("invoice_id", null)

  const [{ data: project, error: projectError }, categoryResult, { data: expenses, error: expenseError }] =
    await Promise.all([
      admin.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
      uncategorized
        ? Promise.resolve({ data: null, error: null })
        : admin.from("categories").select("id, code, name").eq("id", categoryNumeric).maybeSingle(),
      expensesQuery.order("expense_date", { ascending: false, nullsFirst: false }),
    ])

  if (projectError || categoryResult.error || expenseError) {
    return NextResponse.json({ error: "Could not build the PDF" }, { status: 500 })
  }
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  const category = categoryResult.data
  if (!uncategorized && !category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  const heading = category ? formatCategory(category.code, category.name) : "Uncategorized"
  let pdf: Buffer
  try {
    pdf = await buildCategoryPacket({
      projectName: project.name,
      heading,
      expenses: expenses ?? [],
    })
  } catch {
    return NextResponse.json({ error: "Could not build the PDF" }, { status: 500 })
  }

  const filename = category
    ? `${slug(project.name)}_${String(category.code).padStart(2, "0")}_${slug(category.name)}.pdf`
    : `${slug(project.name)}_Uncategorized.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
