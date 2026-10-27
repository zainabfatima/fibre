import "server-only"

import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/app-session"
import { listSignedProgressPictures } from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"

export async function requireStaff() {
  const user = await getSessionUser()
  if (user?.role === "admin") redirect("/")
  if (!user || user.role !== "staff") redirect("/login")
  return user
}

export async function listStaffProjects(projectIds: string[]) {
  if (projectIds.length === 0) return []
  const admin = createAdminClient()
  const { data, error } = await admin.from("projects").select("id, name, address").in("id", projectIds)
  if (error) throw new Error(error.message)
  return (data ?? []).sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadStaffProgress(projectId: string) {
  const user = await requireStaff()
  if (!user.project_ids.includes(projectId)) redirect("/staff")

  const admin = createAdminClient()
  const projectResult = await admin.from("projects").select("id, name, address").eq("id", projectId).maybeSingle()
  if (projectResult.error) throw new Error(projectResult.error.message)
  if (!projectResult.data) redirect("/staff")

  const [categoriesResult, pictures] = await Promise.all([
    admin.from("categories").select("id, code, name, is_active").order("sort_order"),
    listSignedProgressPictures(admin, projectId),
  ])
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)
  const categories = categoriesResult.data ?? []
  const byId = new Map(categories.map((category) => [category.id, category]))

  return {
    project: projectResult.data,
    categories: categories
      .filter((category) => category.is_active)
      .map((category) => ({ id: category.id, code: category.code, name: category.name }))
      .sort((a, b) => a.code - b.code),
    pictures: pictures.map((picture) => {
      const category = byId.get(picture.categoryId)
      return {
        id: picture.id,
        categoryId: picture.categoryId,
        categoryCode: category?.code ?? 0,
        categoryName: category?.name ?? "Category",
        createdAt: picture.createdAt,
        url: picture.url,
      }
    }),
  }
}
