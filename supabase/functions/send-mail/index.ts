import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts"

const jsonHeaders = { "content-type": "application/json" }

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  const expected = Deno.env.get("MAIL_INVOKE_SECRET") ?? ""
  const provided = req.headers.get("x-mail-secret") ?? ""
  if (!expected || provided !== expected) return json({ error: "unauthorized" }, 401)

  let body: { to?: string; cc?: string; subject?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "invalid json" }, 400)
  }

  const to = (body.to ?? "").trim().replace(/[\r\n]/g, "")
  const cc = (body.cc ?? "").trim().replace(/[\r\n]/g, "")
  const copy = cc && cc.toLowerCase() !== to.toLowerCase() ? cc : ""
  const subject = (body.subject ?? "").trim()
  const text = body.text ?? ""
  if (!to || !subject || !text) return json({ error: "to, subject, and text are required" }, 400)

  const user = (Deno.env.get("SMTP_USER") ?? "admin@fibreconstruction.com").trim()
  const password = (Deno.env.get("SMTP_APP_PASSWORD") ?? "").replace(/\s+/g, "")
  if (!password) return json({ error: "SMTP_APP_PASSWORD is not set" }, 500)

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: user, password },
    },
  })

  try {
    await client.send({
      from: `Fibre Construction <${user}>`,
      to,
      ...(copy ? { cc: copy } : {}),
      subject,
      content: text,
    })
    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mail failed"
    return json({ error: message }, 502)
  } finally {
    try {
      await client.close()
    } catch {
      // The message was already accepted or the error was returned above.
    }
  }
})
