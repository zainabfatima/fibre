import "server-only"

import { cookies } from "next/headers"

import { isClientCode } from "@/lib/client-code"

/** Separate from the fibre admin cookie. Knowing this value is the project number. */
export const CLIENT_PROJECT_COOKIE = "client_project"

export function clientCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    ...(maxAge === undefined ? {} : { maxAge }),
  }
}

export async function getClientProjectCode() {
  const jar = await cookies()
  const value = jar.get(CLIENT_PROJECT_COOKIE)?.value ?? ""
  return isClientCode(value) ? value : null
}
