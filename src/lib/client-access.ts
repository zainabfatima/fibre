import "server-only"

import { clientCodeFromName } from "@/lib/client-code"
import { getClientProjectCode } from "@/lib/client-session"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/types/database"

type Project = Database["public"]["Tables"]["projects"]["Row"]

export type ClientProjectLookup =
  | { ok: true; project: Project }
  | { ok: false; reason: "none" | "ambiguous" }

async function projectIdsForCode(code: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.from("projects").select("id, name")
  if (error) throw new Error(error.message)
  return (data ?? []).filter((row) => clientCodeFromName(row.name) === code).map((row) => row.id)
}

export async function findProjectByClientCode(code: string): Promise<ClientProjectLookup> {
  const ids = await projectIdsForCode(code)
  if (ids.length !== 1) return { ok: false, reason: ids.length === 0 ? "none" : "ambiguous" }
  const admin = createAdminClient()
  const { data, error } = await admin.from("projects").select("*").eq("id", ids[0]).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ok: false, reason: "none" }
  return { ok: true, project: data }
}

/** True only when the client cookie matches exactly one project, and it is this one. */
export async function clientSessionOwnsProject(projectId: string) {
  const code = await getClientProjectCode()
  if (!code) return false
  try {
    const ids = await projectIdsForCode(code)
    return ids.length === 1 && ids[0] === projectId
  } catch {
    return false
  }
}
