import { NextResponse } from "next/server"

import { requireAdminApi } from "@/lib/db"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = await requireAdminApi()
  if (!session) return new NextResponse("Unauthorized", { status: 401 })

  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream({
    start(controller) {
      const admin = createAdminClient()
      const channel = admin.channel(`fibre-live-${crypto.randomUUID()}`)
      const send = (table: string) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${table}\n\n`))
      }
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "expenses" },
          () => send("expenses"),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "invoices" },
          () => send("invoices"),
        )
        .subscribe()
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"))
      }, 15000)
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ping)
        void admin.removeChannel(channel)
        controller.close()
      }
      request.signal.addEventListener("abort", close)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
