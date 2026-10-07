"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { requestIsZainab } from "@/lib/zainab-request"

const SESSION_COOKIE = "fibre_session"
const ACCEPTED_LOGIN_ID = "fibre"

export type LoginState = {
  error: string | null
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  }
}

export async function signIn(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = formData.get("loginId")
  const loginId = (typeof raw === "string" ? raw : "").trim()

  if (loginId.toLowerCase() !== ACCEPTED_LOGIN_ID) {
    return { error: "Unknown login ID" }
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, crypto.randomUUID(), sessionCookieOptions())
  redirect((await requestIsZainab()) ? "/zainab" : "/")
}

export async function signOut() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  })
  redirect((await requestIsZainab()) ? "/zainab/login" : "/login")
}
