import { cookies } from "next/headers"

export const SESSION_COOKIE = "fibre_session"

export async function getSessionToken() {
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}
