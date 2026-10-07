import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"

import { duplicateIdentityKey } from "@/lib/duplicates"
import { createAdminClient } from "@/lib/supabase/admin"
import { centsToMoney, moneyToCents, parseSignedAmount } from "@/lib/money"
import {
  categoryPromptList,
  extractionSystemPrompt,
  parseExtraction,
  type Extraction,
} from "@/lib/extraction"
import { simpleDescription } from "@/lib/simple-description"
import { getServerEnv } from "@/lib/env"

type ReceiptMedia =
  | {
      type: "image"
      source: {
        type: "base64"
        media_type: "image/jpeg" | "image/png" | "image/webp"
        data: string
      }
    }
  | {
      type: "document"
      source: { type: "base64"; media_type: "application/pdf"; data: string }
    }

function mediaType(path: string, bytes: Buffer) {
  if (path.endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF") {
    return "application/pdf" as const
  }
  if (path.endsWith(".png")) return "image/png" as const
  if (path.endsWith(".webp")) return "image/webp" as const
  return "image/jpeg" as const
}

export async function extractExpense(
  expenseId: string,
  options?: { categoryId?: number | null },
) {
  const supabase = createAdminClient()
  const { data: expense, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", expenseId)
    .maybeSingle()
  if (error || !expense) throw new Error(error?.message || "Receipt not found")

  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id, code, name, keywords")
    .eq("is_active", true)
    .order("sort_order")
  if (categoryError || !categories) {
    throw new Error(categoryError?.message || "Categories missing")
  }

  const downloaded = await supabase.storage
    .from("receipts")
    .download(expense.receipt_file_path)
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Could not read the receipt file")
  }

  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  const type = mediaType(expense.receipt_file_path, bytes)
  const env = getServerEnv()
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const system = extractionSystemPrompt(categoryPromptList(categories))

  const requested = options?.categoryId
  const manualRequested =
    typeof requested === "number" && Number.isInteger(requested) && requested > 0
  const manualCategoryId = manualRequested
    ? (categories.find((category) => category.id === requested)?.id ?? expense.category_id)
    : null
  const instructionBase =
    (expense.page_count ?? 1) > 1 || type === "application/pdf"
      ? "These pages belong to ONE receipt or invoice. Use the FINAL total from the page that says Total, Amount Due, or Balance Due, usually the last page, not a page subtotal. Combine line items from all pages."
      : "Extract this receipt."
  const descriptionAsk =
    "description is one short phrase of what was bought, a few words such as Lumber and screws, Paint, Dumpster rental, or Fuel. Do not list every line item."
  const instruction = manualRequested
    ? `${instructionBase} The category is already chosen by the user. Do not skip the receipt total. Return vendor, date, time, total_amount_paid, receipt_number, payment_method, card_last4, and description. ${descriptionAsk} total_amount_paid is the final amount paid whenever that total is visible. If this is a return or refund, total_amount_paid is negative. Parentheses around an amount, such as (12.50) or ($12.50), mean a negative amount.`
    : `${instructionBase} ${descriptionAsk}`
  const embedded = type === "application/pdf" ? extractEmbeddedImages(bytes) : []
  const imageMedia: ReceiptMedia[] = embedded.slice(0, 20).map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.data,
    },
  }))
  const fileMedia: ReceiptMedia[] =
    type === "application/pdf"
      ? [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: bytes.toString("base64"),
            },
          },
        ]
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: type,
              data: bytes.toString("base64"),
            },
          },
        ]
  const primary = imageMedia.length > 0 ? imageMedia : fileMedia
  const alternate = imageMedia.length > 0 && type === "application/pdf" ? fileMedia : null
  const amountPrompt =
    "Read this black-and-white receipt. Return ONLY JSON: {\"vendor\":\"\",\"date\":\"YYYY-MM-DD or null\",\"time\":\"HH:MM or null\",\"total_amount_paid\":null,\"description\":\"\",\"receipt_number\":null,\"payment_method\":null,\"card_last4\":null}. total_amount_paid is the final amount paid (Total, Amount Due, or Balance Due). A return, refund, or credit is negative. An amount in parentheses, such as (12.50) or ($12.50), is negative: -12.50. Keep the minus sign. Use null if no total is visible. Do not guess a number. description is one short phrase of what was bought, a few words, not a list of line items. card_last4 is only the last 4 digits."

  let rawText = ""
  try {
    const firstText = await askClaude(client, env.ANTHROPIC_MODEL, system, primary, instruction)
    rawText = firstText
    let extracted: Extraction | null = tryParseExtraction(firstText)
    let paidCents = paidCentsFrom(extracted) ?? salvagePaidCents(firstText)
    if (paidCents == null) {
      try {
        const retryText = await askClaude(
          client,
          env.ANTHROPIC_MODEL,
          amountPrompt,
          alternate ?? primary,
          "Extract the final amount paid.",
          800,
        )
        rawText = `${rawText}\n${retryText}`
        const retried = tryParseExtraction(retryText)
        const retryCents = paidCentsFrom(retried) ?? salvagePaidCents(retryText)
        if (paidCents == null && retryCents != null) {
          paidCents = retryCents
          extracted = preferExtraction(retried, extracted)
        } else {
          extracted = preferExtraction(extracted, retried)
        }
      } catch {
        // Keep the first read. A failed second look must not drop a total already found.
      }
    }
    const byCode = new Map(categories.map((category) => [category.code, category.id]))
    const suggestedIds = (extracted?.suggested_categories ?? [])
      .map((item) => byCode.get(item.code))
      .filter((id): id is number => typeof id === "number")
      .slice(0, 3)
    const description = simpleDescription(extracted?.description) || null

    const { error: updateError } = await supabase
      .from("expenses")
      .update({
        vendor: extracted?.vendor?.trim() || null,
        expense_date: extracted?.date ?? null,
        receipt_time: extracted?.time ?? null,
        ...(paidCents != null ? { amount: centsToMoney(paidCents) } : {}),
        receipt_number: extracted?.receipt_number?.trim() || null,
        payment_method: extracted?.payment_method?.trim() || null,
        card_last4: extracted?.card_last4 ?? null,
        description,
        category_id: manualRequested ? manualCategoryId : (suggestedIds[0] ?? null),
        ai_extracted: JSON.parse(JSON.stringify(storedExtraction(extracted, paidCents, rawText))),
        ai_suggested_category_ids: suggestedIds,
        ai_confidence: extracted?.confidence ?? (paidCents == null ? 0 : 0.69),
        verification_status: "needs_review",
      })
      .eq("id", expenseId)
    if (updateError) throw new Error(updateError.message)

    revalidatePath(`/projects/${expense.project_id}`)
    revalidatePath(`/projects/${expense.project_id}/review`)
    await syncDuplicateFlag(expense.project_id, expenseId)
    return {
      ok: true as const,
      confidence: extracted?.confidence ?? null,
      amount: paidCents == null ? null : centsToMoney(paidCents),
    }
  } catch (cause) {
    await supabase
      .from("expenses")
      .update({
        ai_extracted: {
          error: cause instanceof Error ? cause.message : "Extraction failed",
          raw: rawText.slice(0, 4000),
        },
        verification_status: "needs_review",
      })
      .eq("id", expenseId)
    return {
      ok: false as const,
      error: cause instanceof Error ? cause.message : "Extraction failed",
    }
  }
}

async function askClaude(
  client: Anthropic,
  model: string,
  system: string,
  media: ReceiptMedia[],
  instruction: string,
  maxTokens = 4000,
) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [
      {
        role: "user",
        content: [...media, { type: "text", text: instruction }],
      },
    ],
  })
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

function tryParseExtraction(text: string) {
  try {
    return parseExtraction(text)
  } catch {
    return null
  }
}

function paidCentsFrom(extracted: Extraction | null) {
  if (!extracted || extracted.total_amount_paid == null) return null
  return signedPaidCents(extracted.total_amount_paid)
}

function signedPaidCents(value: number) {
  if (!Number.isFinite(value) || value === 0) return null
  const cents = moneyToCents(value.toFixed(2))
  return cents === 0 ? null : cents
}

function salvagePaidCents(text: string) {
  const match = text.match(/"total_amount_paid"\s*:\s*("([^"]*)"|(-?\(?\$?[\d,]+(?:\.\d+)?\)?))/)
  if (!match) return null
  const amount = parseSignedAmount(match[2] ?? match[3] ?? "")
  if (amount == null) return null
  return signedPaidCents(amount)
}

function preferExtraction(primary: Extraction | null, fallback: Extraction | null): Extraction | null {
  if (!primary) return fallback
  if (!fallback) return primary
  return {
    ...primary,
    vendor: primary.vendor?.trim() || fallback.vendor || "",
    date: primary.date ?? fallback.date ?? null,
    time: primary.time ?? fallback.time ?? null,
    receipt_number: primary.receipt_number?.trim() || fallback.receipt_number,
    payment_method: primary.payment_method?.trim() || fallback.payment_method,
    card_last4: primary.card_last4 || fallback.card_last4 || null,
    total_amount_paid: primary.total_amount_paid ?? fallback.total_amount_paid,
    description: simpleDescription(primary.description) || simpleDescription(fallback.description),
    line_items: primary.line_items.length > 0 ? primary.line_items : fallback.line_items,
    suggested_categories:
      primary.suggested_categories.length > 0 ? primary.suggested_categories : fallback.suggested_categories,
  }
}

function storedExtraction(extracted: Extraction | null, paidCents: number | null, rawText: string) {
  const total = paidCents == null ? (extracted?.total_amount_paid ?? null) : Number(centsToMoney(paidCents))
  if (!extracted) return { total_amount_paid: total, raw: rawText.slice(0, 4000) }
  return { ...extracted, total_amount_paid: total }
}

const IDENTITY_SYSTEM = `You read a construction receipt and return ONLY JSON. No markdown.
{
  "receipt_number": "string or null",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null",
  "total_amount_paid": null,
  "payment_method": "cash, check, visa, mastercard, amex, discover, debit, or other",
  "card_last4": "last 4 digits or null"
}
Do not guess. time is the printed transaction time in 24-hour HH:MM, or null. card_last4 is only the last 4 digits. Never return a full card number. payment_method is the payment type or card brand, not the card number. A return or an amount in parentheses is a negative total_amount_paid.`

function identityChecked(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { duplicate_identity_checked?: unknown }).duplicate_identity_checked === true,
  )
}

async function readReceiptIdentity(path: string) {
  const supabase = createAdminClient()
  const downloaded = await supabase.storage.from("receipts").download(path)
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Could not read the receipt file")
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  const type = mediaType(path, bytes)
  const env = getServerEnv()
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const media: ReceiptMedia[] =
    type === "application/pdf"
      ? [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") },
          },
        ]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: type, data: bytes.toString("base64") },
          },
        ]
  const text = await askClaude(client, env.ANTHROPIC_MODEL, IDENTITY_SYSTEM, media, "Extract the receipt identity fields.", 500)
  const extracted = tryParseExtraction(text) ?? identityFromLooseText(text)
  if (!extracted) throw new Error("Claude did not return receipt identity fields")
  return extracted
}

function identityFromLooseText(text: string) {
  const grab = (name: string) => {
    const match = text.match(new RegExp(`"${name}"\\s*:\\s*(null|"[^"]*"|-?\\d+(?:\\.\\d+)?)`, "i"))
    if (!match || match[1] === "null") return null
    return match[1].replace(/^"|"$/g, "")
  }
  const receipt = grab("receipt_number")
  const date = grab("date")
  const time = grab("time")
  const payment = grab("payment_method")
  const card = grab("card_last4")
  const amount = grab("total_amount_paid")
  if (!receipt && !date && !time && !payment && !card && !amount) return null
  const amountNumber = amount == null ? null : parseSignedAmount(amount)
  return tryParseExtraction(
    JSON.stringify({
      receipt_number: receipt,
      date,
      time,
      payment_method: payment,
      card_last4: card,
      total_amount_paid: amountNumber,
    }),
  )
}

export async function scanAllReceiptIdentities(
  onProgress?: (done: number, total: number, detail: string) => void,
) {
  const supabase = createAdminClient()
  const { data: rows, error } = await supabase
    .from("expenses")
    .select("id, project_id, receipt_file_path, expense_date, receipt_number, payment_method, ai_extracted")
    .order("created_at")
  if (error) throw new Error(error.message)
  const pending = (rows ?? []).filter((row) => row.receipt_file_path && !identityChecked(row.ai_extracted))
  let done = 0
  let failed = 0
  const workerCount = Math.min(4, pending.length)
  let cursor = 0

  async function worker() {
    while (cursor < pending.length) {
      const index = cursor
      cursor += 1
      const row = pending[index]
      if (!row) return
      try {
        const extracted = await readReceiptIdentity(row.receipt_file_path)
        const previous =
          row.ai_extracted && typeof row.ai_extracted === "object" && !Array.isArray(row.ai_extracted)
            ? row.ai_extracted
            : {}
        const { error: updateError } = await supabase
          .from("expenses")
          .update({
            receipt_time: extracted.time,
            card_last4: extracted.card_last4,
            ...(!row.expense_date && extracted.date ? { expense_date: extracted.date } : {}),
            ...(!row.receipt_number && extracted.receipt_number?.trim()
              ? { receipt_number: extracted.receipt_number.trim() }
              : {}),
            ...(!row.payment_method && extracted.payment_method?.trim()
              ? { payment_method: extracted.payment_method.trim() }
              : {}),
            ai_extracted: {
              ...previous,
              duplicate_identity_checked: true,
            },
          })
          .eq("id", row.id)
        if (updateError) throw new Error(updateError.message)
      } catch (cause) {
        failed += 1
        onProgress?.(
          done,
          pending.length,
          cause instanceof Error ? cause.message : "Could not read a receipt",
        )
      } finally {
        done += 1
        if (done % 10 === 0 || done === pending.length) {
          onProgress?.(done, pending.length, `${done} of ${pending.length} receipts read`)
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  const flagged = await flagAllDuplicateReceipts()
  return { scanned: pending.length - failed, failed, flagged }
}

export async function flagAllDuplicateReceipts() {
  const supabase = createAdminClient()
  const { data: rows, error } = await supabase
    .from("expenses")
    .select("id, project_id, amount, expense_date, receipt_time, receipt_number, payment_method, card_last4, split_group_id, duplicate_of, duplicate_confirmed, created_at")
    .order("created_at")
  if (error) throw new Error(error.message)

  const groups = new Map<string, NonNullable<typeof rows>>()
  const clear = new Set<string>()
  for (const row of rows ?? []) {
    let key: string | null = null
    try {
      key = duplicateIdentityKey({
        receiptNumber: row.receipt_number,
        expenseDate: row.expense_date,
        receiptTime: row.receipt_time,
        amountCents: moneyToCents(row.amount),
        paymentMethod: row.payment_method,
        cardLast4: row.card_last4,
      })
    } catch {
      key = null
    }
    if (!key) {
      if (row.duplicate_of && !row.duplicate_confirmed) clear.add(row.id)
      continue
    }
    const bucket = groups.get(`${row.project_id}|${key}`) ?? []
    bucket.push(row)
    groups.set(`${row.project_id}|${key}`, bucket)
  }

  const pointAt = new Map<string, string>()
  for (const bucket of groups.values()) {
    if (bucket.length < 2) {
      for (const row of bucket) {
        if (row.duplicate_of && !row.duplicate_confirmed) clear.add(row.id)
      }
      continue
    }
    const [canonical, ...rest] = bucket
    if (!canonical) continue
    if (canonical.duplicate_of && !canonical.duplicate_confirmed) clear.add(canonical.id)
    for (const other of rest) {
      if (other.duplicate_confirmed) continue
      if (canonical.split_group_id && other.split_group_id === canonical.split_group_id) {
        if (other.duplicate_of) clear.add(other.id)
        continue
      }
      pointAt.set(other.id, canonical.id)
      clear.delete(other.id)
    }
  }

  let flagged = 0
  for (const [id, duplicateOf] of pointAt) {
    const { error: updateError } = await supabase
      .from("expenses")
      .update({ duplicate_of: duplicateOf })
      .eq("id", id)
    if (updateError) throw new Error(updateError.message)
    flagged += 1
  }
  for (const id of clear) {
    if (pointAt.has(id)) continue
    const { error: updateError } = await supabase.from("expenses").update({ duplicate_of: null }).eq("id", id)
    if (updateError) throw new Error(updateError.message)
  }
  return flagged
}

export async function syncDuplicateFlag(projectId: string, expenseId: string) {
  const supabase = createAdminClient()
  const { data: current } = await supabase
    .from("expenses")
    .select("id, amount, expense_date, receipt_time, receipt_number, payment_method, card_last4, split_group_id, duplicate_confirmed")
    .eq("id", expenseId)
    .maybeSingle()
  if (!current || current.duplicate_confirmed) return

  const currentKey = duplicateIdentityKey({
    receiptNumber: current.receipt_number,
    expenseDate: current.expense_date,
    receiptTime: current.receipt_time,
    amountCents: moneyToCents(current.amount),
    paymentMethod: current.payment_method,
    cardLast4: current.card_last4,
  })
  if (!currentKey) {
    await supabase.from("expenses").update({ duplicate_of: null }).eq("id", expenseId)
    return
  }

  const { data: candidates } = await supabase
    .from("expenses")
    .select("id, amount, expense_date, receipt_time, receipt_number, payment_method, card_last4, split_group_id")
    .eq("project_id", projectId)
    .neq("id", expenseId)

  const match = (candidates ?? []).find((other) => {
    if (current.split_group_id && other.split_group_id === current.split_group_id) return false
    const otherKey = duplicateIdentityKey({
      receiptNumber: other.receipt_number,
      expenseDate: other.expense_date,
      receiptTime: other.receipt_time,
      amountCents: moneyToCents(other.amount),
      paymentMethod: other.payment_method,
      cardLast4: other.card_last4,
    })
    return otherKey != null && otherKey === currentKey
  })

  await supabase
    .from("expenses")
    .update({ duplicate_of: match?.id ?? null })
    .eq("id", expenseId)
}

export async function readInvoiceDocumentTotal(invoiceId: string) {
  const supabase = createAdminClient()
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!invoice?.file_path) throw new Error("Upload an invoice file first")

  const downloaded = await supabase.storage.from("invoices").download(invoice.file_path)
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Could not read the invoice file")
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  const type = mediaType(invoice.file_path, bytes)
  const env = getServerEnv()
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const instruction =
    "Read the total amount written on this invoice. Return ONLY JSON: {\"total_amount\": 0.00}. Use the final amount due on the document."
  const content =
    type === "application/pdf"
      ? [
          {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: bytes.toString("base64"),
            },
          },
          { type: "text" as const, text: instruction },
        ]
      : [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: type,
              data: bytes.toString("base64"),
            },
          },
          { type: "text" as const, text: instruction },
        ]

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content }],
  })
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
  const match = text.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(match?.[0] ?? text) as { total_amount?: number }
  if (typeof parsed.total_amount !== "number") {
    throw new Error("Claude did not return a total")
  }
  const total = centsToMoney(moneyToCents(parsed.total_amount.toFixed(2)))
  const { error } = await supabase
    .from("invoices")
    .update({ total_amount: total })
    .eq("id", invoiceId)
  if (error) throw new Error(error.message)
  return total
}

function extractEmbeddedImages(bytes: Buffer) {
  const images: Array<{ mediaType: "image/jpeg" | "image/png"; data: string }> = []
  let index = 0
  while (index < bytes.length - 3 && images.length < 20) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8 && bytes[index + 2] === 0xff) {
      const end = bytes.indexOf(Buffer.from([0xff, 0xd9]), index + 2)
      if (end === -1) break
      images.push({ mediaType: "image/jpeg", data: bytes.subarray(index, end + 2).toString("base64") })
      index = end + 2
      continue
    }
    if (
      bytes[index] === 0x89 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x4e &&
      bytes[index + 3] === 0x47
    ) {
      const end = bytes.indexOf(Buffer.from("IEND"), index + 8)
      if (end === -1) break
      images.push({ mediaType: "image/png", data: bytes.subarray(index, end + 8).toString("base64") })
      index = end + 8
      continue
    }
    index += 1
  }
  return images
}
