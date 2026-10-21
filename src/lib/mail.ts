import "server-only"

import { sendSmtpMail, type SmtpMessage } from "@/lib/smtp"

export const ADMIN_INBOX = "admin@fibreconstruction.com"
export const OFFICE_CC = "joe@fibreconstruction.com"

function mailbox(value: string) {
  return value.replace(/[\r\n]/g, "").trim()
}

function withOfficeCc(message: SmtpMessage): SmtpMessage {
  const to = mailbox(message.to)
  const requested = mailbox(message.cc ?? OFFICE_CC)
  if (!requested || requested.toLowerCase() === to.toLowerCase()) {
    return { to, subject: message.subject, text: message.text }
  }
  return { to, subject: message.subject, text: message.text, cc: requested }
}

export type MailTransport = "edge" | "smtp"

async function sendViaEdge(message: SmtpMessage): Promise<"sent" | "skip" | string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.MAIL_INVOKE_SECRET
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !secret || !apikey) return "skip"
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/send-mail`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apikey}`,
        apikey,
        "x-mail-secret": secret,
      },
      body: JSON.stringify(message),
    })
    if (response.status === 404) return "skip"
    if (!response.ok) {
      const detail = (await response.text()).trim()
      return detail.slice(0, 400) || `Mail function returned ${response.status}`
    }
    return "sent"
  } catch {
    return "skip"
  }
}

export async function sendAppMail(message: SmtpMessage): Promise<MailTransport> {
  const outgoing = withOfficeCc(message)
  const edge = await sendViaEdge(outgoing)
  if (edge === "sent") return "edge"
  try {
    await sendSmtpMail(outgoing)
    return "smtp"
  } catch (error) {
    const smtpError = error instanceof Error ? error.message : "Direct mail failed."
    if (edge !== "skip") throw new Error(`${edge} Direct mail also failed: ${smtpError}`)
    throw error
  }
}

export function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
}

export async function sendOfficeCopy(message: SmtpMessage) {
  return sendAppMail({ ...message, to: ADMIN_INBOX, cc: message.cc || OFFICE_CC })
}
