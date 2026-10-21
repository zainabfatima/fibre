import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getAdminUser, sessionCookieOptions } from "@/lib/app-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { SESSION_COOKIE } from "@/lib/session"
import { requestIsZainab } from "@/lib/zainab-request"

export async function requireAdmin() {
  const user = await getAdminUser()
  if (!user) {
    const jar = await cookies()
    if (jar.get(SESSION_COOKIE)?.value) {
      jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 })
    }
    redirect((await requestIsZainab()) ? "/zainab/login" : "/login")
  }
  return createAdminClient()
}

export async function requireAdminApi() {
  const user = await getAdminUser()
  if (!user) return null
  return createAdminClient()
}
