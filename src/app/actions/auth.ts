"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  createSession,
  deleteSession,
  sessionCookieOptions,
} from "@/lib/app-session"
import { assignedProjectIds, projectsForClient } from "@/lib/client-projects"
import {
  CLIENT_ACCOUNT_COOKIE,
  CLIENT_PROJECT_COOKIE,
  clientCookieOptions,
} from "@/lib/client-session"
import { verifyPassword } from "@/lib/passwords"
import { SESSION_COOKIE } from "@/lib/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { requestIsZainab } from "@/lib/zainab-request"

const SESSION_SECONDS = 60 * 60 * 24 * 30

export type LoginState = {
  error: string | null
}

async function findLogin(loginId: string) {
  const admin = createAdminClient()
  const byLogin = await admin
    .from("app_users")
    .select("id, login_id, role, status, project_id, password_hash")
    .eq("login_id", loginId)
    .maybeSingle()
  if (byLogin.error) throw new Error(byLogin.error.message)
  if (byLogin.data) return byLogin.data
  const byEmail = await admin
    .from("app_users")
    .select("id, login_id, role, status, project_id, password_hash")
    .eq("email", loginId)
    .maybeSingle()
  if (byEmail.error) throw new Error(byEmail.error.message)
  return byEmail.data
}

export async function signIn(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim().toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!loginId || !password) return { error: "Enter your user ID and password." }

  let user: Awaited<ReturnType<typeof findLogin>>
  try {
    user = await findLogin(loginId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not check the login." }
  }
  if (!user?.password_hash || !verifyPassword(password, user.password_hash)) {
    return { error: "Unknown user ID or password." }
  }
  if (user.status === "pending") return { error: "This signup is waiting for approval." }
  if (user.status !== "active") return { error: "This account is not active." }

  const jar = await cookies()
  if (user.role === "admin") {
    const token = await createSession(user.id)
    jar.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_SECONDS))
    jar.set(CLIENT_ACCOUNT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
    jar.set(CLIENT_PROJECT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
    redirect((await requestIsZainab()) ? "/zainab" : "/")
  }

  if (user.role === "staff") {
    const token = await createSession(user.id)
    jar.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_SECONDS))
    jar.set(CLIENT_ACCOUNT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
    jar.set(CLIENT_PROJECT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
    redirect("/staff")
  }

  const projectIds = await assignedProjectIds(user.id, user.project_id)
  if (projectIds.length === 0) return { error: "No project is assigned to this account." }
  const projects = await projectsForClient(projectIds)
  if (projects.length === 0) return { error: "The assigned project is no longer available." }
  if (projects.length === 1 && !projects[0].code) {
    return { error: "The assigned project needs a number at the start of its name before the client view can open." }
  }

  const token = await createSession(user.id)
  jar.set(CLIENT_ACCOUNT_COOKIE, token, clientCookieOptions(SESSION_SECONDS))
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 })
  if (projects.length === 1 && projects[0].code) {
    jar.set(CLIENT_PROJECT_COOKIE, projects[0].code, clientCookieOptions(SESSION_SECONDS))
    redirect(`/client/${projects[0].code}`)
  }
  jar.set(CLIENT_PROJECT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
  redirect("/client")
}

export async function signOut() {
  const jar = await cookies()
  await deleteSession(jar.get(SESSION_COOKIE)?.value)
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 })
  jar.set(CLIENT_ACCOUNT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
  jar.set(CLIENT_PROJECT_COOKIE, "", { ...clientCookieOptions(), maxAge: 0 })
  redirect((await requestIsZainab()) ? "/zainab/login" : "/login")
}
