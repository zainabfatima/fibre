import "server-only"

import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"

import { assignedProjectIds } from "@/lib/client-projects"
import { CLIENT_ACCOUNT_COOKIE } from "@/lib/client-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionToken } from "@/lib/session"

export type AppRole = "admin" | "client"
export type AppUserStatus = "pending" | "active" | "rejected"

export type SessionUser = {
  id: string
  login_id: string
  email: string | null
  role: AppRole
  status: AppUserStatus
  project_ids: string[]
}

const SESSION_SECONDS = 60 * 60 * 24 * 30

export function sessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    ...(maxAge === undefined ? {} : { maxAge }),
  }
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()
  const admin = createAdminClient()
  const { error } = await admin.from("app_sessions").insert({
    token,
    user_id: userId,
    expires_at: expiresAt,
  })
  if (error) throw new Error(error.message)
  return token
}

async function userForToken(token: string | null): Promise<SessionUser | null> {
  if (!token) return null
  const admin = createAdminClient()
  const { data: session, error } = await admin
    .from("app_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle()
  if (error || !session) return null
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await admin.from("app_sessions").delete().eq("token", token)
    return null
  }
  const { data: user, error: userError } = await admin
    .from("app_users")
    .select("id, login_id, email, role, status, project_id")
    .eq("id", session.user_id)
    .maybeSingle()
  if (userError || !user || user.status !== "active") return null
  const project_ids = user.role === "client" ? await assignedProjectIds(user.id, user.project_id) : []
  return {
    id: user.id,
    login_id: user.login_id,
    email: user.email,
    role: user.role,
    status: user.status,
    project_ids,
  }
}

export async function getAdminUser() {
  const user = await userForToken(await getSessionToken())
  if (!user || user.role !== "admin") return null
  return user
}

export async function getClientAccountUser() {
  const jar = await cookies()
  const user = await userForToken(jar.get(CLIENT_ACCOUNT_COOKIE)?.value ?? null)
  if (!user || user.role !== "client") return null
  return user
}

export async function deleteSession(token: string | null | undefined) {
  if (!token) return
  const admin = createAdminClient()
  await admin.from("app_sessions").delete().eq("token", token)
}
