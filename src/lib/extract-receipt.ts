import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"

import { vendorsSimilar, shiftIsoDate } from "@/lib/duplicates"
import { createAdminClient } from "@/lib/supabase/admin"
import { centsToMoney, moneyToCents } from "@/lib/money"
import {
  categoryPromptList,
  extractionSystemPrompt,
  parseExtraction,
  type Extraction,
} from "@/lib/extraction"
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
  const instruction = manualRequested
    ? `${instructionBase} The category is already chosen by the user. Do not skip the receipt total. Return vendor, date, and total_amount_paid from this black-and-white receipt. total_amount_paid is the final amount paid whenever that total is visible.`
    : instructionBase
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
    "Read this black-and-white receipt. Return ONLY JSON: {\"vendor\":\"\",\"date\":\"YYYY-MM-DD or null\",\"total_amount_paid\":null}. total_amount_paid is the final amount paid (Total, Amount Due, or Balance Due). Use null if no total is visible. Do not guess a number."

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
    const description =
      extracted?.line_items
        .map((item) => item.description)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ") || null

    const { error: updateError } = await supabase
      .from("expenses")
      .update({
        vendor: extracted?.vendor?.trim() || null,
        expense_date: extracted?.date ?? null,
        ...(paidCents != null ? { amount: centsToMoney(paidCents) } : {}),
        receipt_number: extracted?.receipt_number?.trim() || null,
        payment_method: extracted?.payment_method?.trim() || null,
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
    await flagSoftDuplicate(expense.project_id, expenseId)
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
  return positivePaidCents(extracted.total_amount_paid)
}

function positivePaidCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null
  const cents = moneyToCents(value.toFixed(2))
  return cents > 0 ? cents : null
}

function salvagePaidCents(text: string) {
  const match = text.match(/"total_amount_paid"\s*:\s*"?\$?\s*([\d,]+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(value) ? positivePaidCents(value) : null
}

function preferExtraction(primary: Extraction | null, fallback: Extraction | null): Extraction | null {
  if (!primary) return fallback
  if (!fallback) return primary
  return {
    ...primary,
    vendor: primary.vendor?.trim() || fallback.vendor || "",
    date: primary.date ?? fallback.date ?? null,
    receipt_number: primary.receipt_number?.trim() || fallback.receipt_number,
    payment_method: primary.payment_method?.trim() || fallback.payment_method,
    total_amount_paid: primary.total_amount_paid ?? fallback.total_amount_paid,
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

async function flagSoftDuplicate(projectId: string, expenseId: string) {
  const supabase = createAdminClient()
  const { data: current } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", expenseId)
    .maybeSingle()
  if (!current?.expense_date || moneyToCents(current.amount) === 0) return

  const from = shiftIsoDate(current.expense_date, -3)
  const to = shiftIsoDate(current.expense_date, 3)
  const { data: candidates } = await supabase
    .from("expenses")
    .select("id, vendor, amount, expense_date, receipt_number, split_group_id")
    .eq("project_id", projectId)
    .neq("id", expenseId)

  const match = (candidates ?? []).find((other) => {
    if (
      current.split_group_id &&
      other.split_group_id === current.split_group_id
    ) {
      return false
    }
    const sameReceipt =
      Boolean(current.receipt_number) &&
      current.receipt_number === other.receipt_number &&
      vendorsSimilar(current.vendor, other.vendor)
    const sameMoney =
      other.expense_date &&
      other.expense_date >= from &&
      other.expense_date <= to &&
      moneyToCents(other.amount) === moneyToCents(current.amount) &&
      vendorsSimilar(current.vendor, other.vendor)
    return sameReceipt || sameMoney
  })

  if (!match) return
  await supabase
    .from("expenses")
    .update({
      verification_status: "flagged",
      duplicate_of: match.id,
    })
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
