import "server-only"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/app-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { SESSION_COOKIE } from "@/lib/session"
import { staffOfficeDestination } from "@/lib/staff-route"
import { requestIsZainab } from "@/lib/zainab-request"

export async function requireAdmin() {
  const user = await getSessionUser()
  if (user?.role === "admin") return createAdminClient()
  if (user?.role === "staff") {
    const headerList = await headers()
    redirect(staffOfficeDestination(headerList.get("x-fibre-path") ?? "", user.project_ids))
  }
  const jar = await cookies()
  const zainab = await requestIsZainab()
  if (jar.get(SESSION_COOKIE)?.value) {
    redirect(zainab ? "/api/session/end?next=zainab" : "/api/session/end")
  }
  redirect(zainab ? "/zainab/login" : "/login")
}

export async function requireAdminApi() {
  const user = await getSessionUser()
  if (user?.role !== "admin") return null
  return createAdminClient()
}
