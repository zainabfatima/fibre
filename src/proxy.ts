import { NextResponse, type NextRequest } from "next/server"

import { isZainabPath, stripZainab } from "@/lib/zainab-path"
import { updateSession } from "@/lib/supabase/update-session"

const SESSION_COOKIE = "fibre_session"
const PUBLIC_PREFIXES = ["/login", "/auth", "/share", "/client", "/r", "/i", "/api/export"]

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const zainab = isZainabPath(pathname)
  const logical = stripZainab(pathname)
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  if (hasSession && logical === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = zainab ? "/zainab" : "/"
    return NextResponse.redirect(url)
  }

  if (!hasSession && !isPublicPath(logical)) {
    const url = request.nextUrl.clone()
    url.pathname = zainab ? "/zainab/login" : "/login"
    return NextResponse.redirect(url)
  }

  if (zainab) {
    const url = request.nextUrl.clone()
    url.pathname = logical
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-fibre-view", "zainab")
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  }

  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
