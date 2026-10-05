import { NextResponse } from "next/server"

import { buildCategoryPacket } from "@/lib/category-packet"
import { requireAdminApi } from "@/lib/db"
import { getProject, listCategories, listExpenseRows } from "@/lib/queries"

export const maxDuration = 60

async function packet(projectId: string, categoryId: string) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const project = await getProject(projectId)
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  const [categories, expenses] = await Promise.all([
    listCategories(),
    listExpenseRows(projectId),
  ])
  const chosen =
    categoryId === "all"
      ? categories
      : categories.filter((category) => String(category.id) === categoryId)
  const sections = chosen
    .map((category) => ({
      code: category.code,
      name: category.name,
      expenses: expenses.filter((row) => row.category_id === category.id),
    }))
    .filter((section) => section.expenses.length > 0)
  const pdf = await buildCategoryPacket({
    projectName: project.name,
    sections,
  })
  const filename =
    categoryId === "all"
      ? `${project.name.replace(/[^\w]+/g, "_")}_All_Categories.pdf`
      : `${project.name.replace(/[^\w]+/g, "_")}_Category_${chosen[0]?.code ?? categoryId}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; categoryId: string }> },
) {
  const { projectId, categoryId } = await context.params
  return packet(projectId, categoryId)
}
