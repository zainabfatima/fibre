import tls from "node:tls"

export type SmtpMessage = {
  to: string
  cc?: string
  subject: string
  text: string
}

function mailEnv() {
  const user = (process.env.SMTP_USER || "admin@fibreconstruction.com").trim()
  const password = (process.env.SMTP_APP_PASSWORD || "").replace(/\s+/g, "")
  const from = (process.env.SMTP_FROM || `Fibre Construction <${user}>`).trim()
  if (!password) throw new Error("SMTP_APP_PASSWORD is not set.")
  const fromAddress = from.match(/<([^>]+)>/)?.[1] ?? user
  return { user, password, from, fromAddress }
}

function encodeSubject(subject: string) {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
}

function cleanAddress(value: string) {
  return value.trim().replace(/[\r\n]/g, "")
}

function messageData(from: string, message: SmtpMessage) {
  const text = message.text
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n")
  const headers = [`From: ${from}`, `To: ${message.to}`]
  if (message.cc) headers.push(`Cc: ${message.cc}`)
  return [
    ...headers,
    `Subject: ${encodeSubject(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
    "",
  ].join("\r\n")
}

export function sendSmtpMail(message: SmtpMessage) {
  const env = mailEnv()
  const to = cleanAddress(message.to)
  const cc = cleanAddress(message.cc ?? "")
  const copy = cc && cc.toLowerCase() !== to.toLowerCase() ? cc : ""
  if (!to) throw new Error("Missing mail recipient.")

  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect({
      host: "smtp.gmail.com",
      port: 465,
      servername: "smtp.gmail.com",
    })
    let buffer = ""
    let step = 0
    let settled = false
    const steps: Array<(code: number, text: string) => string | null> = []

    function done(error?: Error) {
      if (settled) return
      settled = true
      socket.end()
      if (error) reject(error)
      else resolve()
    }

    function onReply(code: number, text: string) {
      if (settled) return
      const next = steps[step]
      if (!next) return done(new Error(`Unexpected SMTP reply ${code}`))
      step += 1
      try {
        const line = next(code, text)
        if (line) socket.write(line)
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const b64 = (value: string) => Buffer.from(value).toString("base64")
    steps.push(
      (code, text) => {
        if (code !== 220) throw new Error(`SMTP greeting failed: ${text}`)
        return "EHLO fibre-construction\r\n"
      },
      (code, text) => {
        if (code !== 250) throw new Error(text)
        return "AUTH LOGIN\r\n"
      },
      (code, text) => {
        if (code !== 334) throw new Error(`SMTP login was refused: ${text}`)
        return `${b64(env.user)}\r\n`
      },
      (code, text) => {
        if (code !== 334) throw new Error(`SMTP username was refused: ${text}`)
        return `${b64(env.password)}\r\n`
      },
      (code, text) => {
        if (code !== 235) throw new Error(`Mailbox login failed: ${text}`)
        return `MAIL FROM:<${env.fromAddress}>\r\n`
      },
    )
    for (const recipient of [to, copy].filter(Boolean)) {
      steps.push((code, text) => {
        if (code !== 250) throw new Error(text)
        return `RCPT TO:<${recipient}>\r\n`
      })
    }
    steps.push(
      (code, text) => {
        if (code !== 250) throw new Error(text)
        return "DATA\r\n"
      },
      (code, text) => {
        if (code !== 354) throw new Error(text)
        return messageData(env.from, { ...message, to, cc: copy || undefined })
      },
      (code, text) => {
        if (code !== 250) throw new Error(text)
        return "QUIT\r\n"
      },
      (code, text) => {
        done(code === 221 ? undefined : new Error(text))
        return null
      },
    )

    socket.setTimeout(20_000, () => done(new Error("SMTP timed out.")))
    socket.on("error", (error) => done(error))
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      while (!settled) {
        const lines = buffer.split("\r\n")
        let replyEnd = -1
        for (let index = 0; index < lines.length - 1; index += 1) {
          if (/^\d{3} /.test(lines[index] ?? "")) {
            replyEnd = index
            break
          }
        }
        if (replyEnd < 0) break
        const replyLines = lines.slice(0, replyEnd + 1)
        buffer = lines.slice(replyEnd + 1).join("\r\n")
        const last = replyLines[replyLines.length - 1] ?? ""
        onReply(Number(last.slice(0, 3)), replyLines.join("\n"))
      }
    })
  })
}
