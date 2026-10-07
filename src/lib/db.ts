import "server-only"

import { redirect } from "next/navigation"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionToken } from "@/lib/session"
import { requestIsZainab } from "@/lib/zainab-request"

export async function requireAdmin() {
  const token = await getSessionToken()
  if (!token) redirect((await requestIsZainab()) ? "/zainab/login" : "/login")
  return createAdminClient()
}

export async function requireAdminApi() {
  const token = await getSessionToken()
  if (!token) return null
  return createAdminClient()
}
