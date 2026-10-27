import "server-only"

import { clientSessionOwnsProject } from "@/lib/client-access"
import { listSignedProgressPictures } from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"

export type ClientProgressPicture = {
  id: string
  categoryId: number
  categoryCode: number
  categoryName: string
  createdAt: string
  url: string | null
}

/** Pictures for one project the current client session is already allowed to open. */
export async function listClientProgressPictures(projectId: string): Promise<ClientProgressPicture[]> {
  if (!(await clientSessionOwnsProject(projectId))) return []

  const admin = createAdminClient()
  const pictures = await listSignedProgressPictures(admin, projectId)
  const categoryIds = [...new Set(pictures.map((picture) => picture.categoryId))]
  const categories = new Map<number, { code: number; name: string }>()
  if (categoryIds.length > 0) {
    const { data, error } = await admin.from("categories").select("id, code, name").in("id", categoryIds)
    if (error) throw new Error(error.message)
    for (const category of data ?? []) categories.set(category.id, category)
  }

  return pictures.map((picture) => {
    const category = categories.get(picture.categoryId)
    return {
      id: picture.id,
      categoryId: picture.categoryId,
      categoryCode: category?.code ?? 0,
      categoryName: category?.name ?? "Category",
      createdAt: picture.createdAt,
      url: picture.url,
    }
  })
}
