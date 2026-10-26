import "server-only"

import { clientCodeFromName } from "@/lib/client-code"
import { createAdminClient } from "@/lib/supabase/admin"

export type ClientPortalProject = {
  id: string
  name: string
  address: string | null
  code: string | null
}

export function mergeProjectIds(linked: string[] | undefined, legacyProjectId: string | null) {
  const ids = [...(linked ?? [])]
  if (legacyProjectId && !ids.includes(legacyProjectId)) ids.push(legacyProjectId)
  return ids
}

export async function projectIdsByUser() {
  const admin = createAdminClient()
  const { data, error } = await admin.from("app_user_projects").select("user_id, project_id")
  if (error) throw new Error(error.message)
  const map = new Map<string, string[]>()
  for (const row of data ?? []) {
    const list = map.get(row.user_id) ?? []
    list.push(row.project_id)
    map.set(row.user_id, list)
  }
  return map
}

/** Join-table assignments, plus a legacy project_id that has not been copied yet. */
export async function assignedProjectIds(userId: string, legacyProjectId: string | null) {
  const admin = createAdminClient()
  const { data, error } = await admin.from("app_user_projects").select("project_id").eq("user_id", userId)
  if (error) throw new Error(error.message)
  return mergeProjectIds((data ?? []).map((row) => row.project_id), legacyProjectId)
}

export async function projectsForClient(projectIds: string[]): Promise<ClientPortalProject[]> {
  if (projectIds.length === 0) return []
  const admin = createAdminClient()
  const { data, error } = await admin.from("projects").select("id, name, address").in("id", projectIds)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      code: clientCodeFromName(row.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function replaceUserProjects(userId: string, projectIds: string[]) {
  const admin = createAdminClient()
  const existing = await admin.from("app_user_projects").select("project_id").eq("user_id", userId)
  if (existing.error) throw new Error(existing.error.message)
  const current = new Set((existing.data ?? []).map((row) => row.project_id))
  const next = new Set(projectIds)
  const toAdd = projectIds.filter((id) => !current.has(id))
  const toRemove = [...current].filter((id) => !next.has(id))
  if (toAdd.length > 0) {
    const inserted = await admin.from("app_user_projects").insert(toAdd.map((project_id) => ({ user_id: userId, project_id })))
    if (inserted.error) throw new Error(inserted.error.message)
  }
  if (toRemove.length > 0) {
    const removed = await admin.from("app_user_projects").delete().eq("user_id", userId).in("project_id", toRemove)
    if (removed.error) throw new Error(removed.error.message)
  }
}
