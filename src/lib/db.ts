import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getAdminUser } from "@/lib/app-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { SESSION_COOKIE } from "@/lib/session"
import { requestIsZainab } from "@/lib/zainab-request"

export async function requireAdmin() {
  const user = await getAdminUser()
  if (!user) {
    const jar = await cookies()
    const zainab = await requestIsZainab()
    if (jar.get(SESSION_COOKIE)?.value) {
      redirect(zainab ? "/api/session/end?next=zainab" : "/api/session/end")
    }
    redirect(zainab ? "/zainab/login" : "/login")
  }
  return createAdminClient()
}

export async function requireAdminApi() {
  const user = await getAdminUser()
  if (!user) return null
  return createAdminClient()
}
