"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/db"

const MAX_BYTES = 20 * 1024 * 1024

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/progress`)
}

export async function saveProgressPicture(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim()
  const categoryId = Number(formData.get("categoryId"))
  const file = formData.get("file")
  if (!projectId || !Number.isInteger(categoryId) || categoryId <= 0) {
    return { error: "Pick a category before taking a picture." }
  }
  if (!(file instanceof File) || file.size === 0 || file.type !== "image/jpeg") {
    return { error: "The picture must be a photo." }
  }
  if (file.size > MAX_BYTES) return { error: "That picture is too large." }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { error: "The picture must be a photo." }
  }

  const supabase = await requireAdmin()
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) return { error: projectError.message }
  if (!project) return { error: "That project was not found." }

  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id, is_active")
    .eq("id", categoryId)
    .maybeSingle()
  if (categoryError) return { error: categoryError.message }
  if (!category?.is_active) return { error: "Pick a category before taking a picture." }

  const id = crypto.randomUUID()
  const path = `${projectId}/${id}.jpg`
  const uploaded = await supabase.storage.from("progress-pictures").upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  const { error } = await supabase.from("progress_pictures").insert({
    id,
    project_id: projectId,
    category_id: categoryId,
    file_path: path,
  })
  if (error) {
    await supabase.storage.from("progress-pictures").remove([path])
    return { error: error.message }
  }
  refresh(projectId)
  return { id }
}

export async function deleteProgressPicture(projectId: string, pictureId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("progress_pictures")
    .select("id, file_path")
    .eq("id", pictureId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "That picture was not found." }

  await supabase.storage.from("progress-pictures").remove([data.file_path])
  const deleted = await supabase.from("progress_pictures").delete().eq("id", pictureId).eq("project_id", projectId)
  if (deleted.error) return { error: deleted.error.message }
  refresh(projectId)
  return { ok: true as const }
}
