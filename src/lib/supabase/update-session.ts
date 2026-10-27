import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Database } from "@/types/database"

export async function updateSession(request: NextRequest, requestHeaders: Headers) {
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const forward = () => {
    const headers = new Headers(requestHeaders)
    const cookie = request.cookies.getAll().map(({ name, value }) => `${name}=${value}`).join("; ")
    if (cookie) headers.set("cookie", cookie)
    return NextResponse.next({ request: { headers } })
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return forward()
  }

  let supabaseResponse = forward()

  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value)
            })
            supabaseResponse = forward()
            cookiesToSet.forEach(({ name, value, options }) => {
              supabaseResponse.cookies.set(name, value, options)
            })
          },
        },
      },
    )

    // Refresh Supabase cookies when configured. Access is gated by fibre_session.
    await supabase.auth.getUser()
  } catch {
    return forward()
  }

  return supabaseResponse
}
