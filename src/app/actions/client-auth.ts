"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { isClientCode } from "@/lib/client-code"
import { findProjectByClientCode } from "@/lib/client-access"
import {
  CLIENT_PROJECT_COOKIE,
  clientCookieOptions,
} from "@/lib/client-session"

export type ClientLoginState = {
  error: string | null
}

function loginError(reason: "none" | "ambiguous" | "invalid") {
  if (reason === "ambiguous") return "That number matches more than one project."
  if (reason === "invalid") return "Enter the project number."
  return "No project uses that number."
}

export async function signInClient(
  _state: ClientLoginState,
  formData: FormData,
): Promise<ClientLoginState> {
  const raw = formData.get("projectNumber")
  const code = (typeof raw === "string" ? raw : "").trim()
  if (!isClientCode(code)) return { error: loginError("invalid") }

  const found = await findProjectByClientCode(code)
  if (!found.ok) return { error: loginError(found.reason) }

  const cookieStore = await cookies()
  cookieStore.set(CLIENT_PROJECT_COOKIE, code, clientCookieOptions())
  redirect(`/client/${code}`)
}

export async function signOutClient() {
  const cookieStore = await cookies()
  cookieStore.set(CLIENT_PROJECT_COOKIE, "", {
    ...clientCookieOptions(),
    maxAge: 0,
  })
  redirect("/client")
}
