import { NextResponse } from "next/server"

import { deleteSession, getSessionUser, sessionCookieOptions } from "@/lib/app-session"
import { SESSION_COOKIE, getSessionToken } from "@/lib/session"

export const dynamic = "force-dynamic"

/** Clears a fibre_session that is no longer an active admin. Cookie writes are
 * not allowed during Server Component render, so requireAdmin sends the browser here. */
export async function GET(request: Request) {
  const zainab = new URL(request.url).searchParams.get("next") === "zainab"
  const user = await getSessionUser()
  if (user?.role === "admin") {
    return NextResponse.redirect(new URL(zainab ? "/zainab" : "/", request.url))
  }
  if (user?.role === "staff") {
    return NextResponse.redirect(new URL("/staff", request.url))
  }

  const token = await getSessionToken()
  if (token) {
    try {
      await deleteSession(token)
    } catch {
      // Still clear the cookie below so the dead session cannot crash page renders.
    }
  }

  const response = NextResponse.redirect(new URL(zainab ? "/zainab/login" : "/login", request.url))
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0))
  return response
}
