"use server"

import { revalidatePath } from "next/cache"

import { deriveInvoiceBillingStatus } from "@/lib/labels"
import { requireAdmin } from "@/lib/db"
import { centsToMoney, moneyToCents, parseMoneyInput } from "@/lib/money"
import type { Database } from "@/types/database"

function refresh(projectId: string) {
  revalidatePath("/")
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/review`)
  revalidatePath(`/projects/${projectId}/invoices`)
}

export async function lookupReceiptHash(projectId: string, hash: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("expenses")
    .select("id, created_at")
    .eq("project_id", projectId)
    .eq("receipt_file_hash", hash.toLowerCase())
    .limit(1)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { duplicate: null }
  return {
    duplicate: {
      id: data.id,
      date: data.created_at.slice(0, 10),
    },
  }
}

export async function lookupPageHashes(projectId: string, hashes: string[]) {
  const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()).filter((hash) => /^[0-9a-f]{64}$/.test(hash)))]
  if (unique.length === 0) return { duplicate: null }
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("receipt_page_hashes")
    .select("hash, page_number, expense_id")
    .eq("project_id", projectId)
    .in("hash", unique)
    .limit(1)
  if (error) return { error: error.message }
  const match = data?.[0]
  if (!match) {
    for (const [index, hash] of unique.entries()) {
      const existing = await lookupReceiptHash(projectId, hash)
      if ("error" in existing && existing.error) return { error: existing.error }
      if (existing.duplicate) return { duplicate: { ...existing.duplicate, page: index + 1 } }
    }
    return { duplicate: null }
  }
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, expense_date, created_at")
    .eq("id", match.expense_id)
    .maybeSingle()
  return {
    duplicate: {
      id: expense?.id ?? match.expense_id,
      date: (expense?.expense_date || expense?.created_at || "").slice(0, 10),
      page: match.page_number,
    },
  }
}

export async function saveScannedReceipt(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const hashes = String(formData.get("hashes") ?? "")
    .split(",")
    .map((hash) => hash.toLowerCase())
    .filter((hash) => /^[0-9a-f]{64}$/.test(hash))
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  const captureRaw = String(formData.get("captureType") ?? "single")
  const captureType = captureRaw === "long" || captureRaw === "multi_page" ? captureRaw : "single"
  const pageCount = Math.max(1, Math.min(20, Number(formData.get("pageCount") ?? (hashes.length || 1))))
  if (!(file instanceof File) || file.type !== "application/pdf" || !projectId || hashes.length === 0) {
    return { error: "The scanned receipt must be a PDF" }
  }
  const existing = await lookupPageHashes(projectId, hashes)
  if ("error" in existing && existing.error) return { error: existing.error }
  if (existing.duplicate) {
    return {
      error: `Duplicate — page ${existing.duplicate.page} matches a receipt from ${existing.duplicate.date || "an earlier upload"}`,
      existingId: existing.duplicate.id,
    }
  }

  const supabase = await requireAdmin()
  const categoryRaw = String(formData.get("categoryId") ?? "").trim()
  let categoryId: number | null = null
  if (categoryRaw) {
    const parsed = Number(categoryRaw)
    if (!Number.isInteger(parsed) || parsed <= 0) return { error: "Pick a valid category" }
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("id", parsed)
      .maybeSingle()
    if (categoryError) return { error: categoryError.message }
    if (!category) return { error: "Pick a valid category" }
    categoryId = category.id
  }
  const id = crypto.randomUUID()
  const path = `${projectId}/0/${id}.pdf`
  const uploaded = await supabase.storage.from("receipts").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: "application/pdf",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  let thumbPath: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    thumbPath = `${projectId}/thumbs/${id}.webp`
    const thumbUpload = await supabase.storage.from("receipts").upload(thumbPath, Buffer.from(await thumb.arrayBuffer()), {
      contentType: thumb.type || "image/webp",
      upsert: false,
    })
    if (thumbUpload.error) thumbPath = null
  }

  const { error } = await supabase.from("expenses").insert({
    id,
    project_id: projectId,
    amount: "0.00",
    receipt_file_path: path,
    receipt_file_hash: hashes[0],
    receipt_thumbnail_path: thumbPath,
    verification_status: "needs_review",
    page_count: pageCount,
    file_type: "pdf",
    capture_type: captureType,
    ...(categoryId != null ? { category_id: categoryId } : {}),
  })
  if (error) {
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    return { error: error.message }
  }
  const { error: hashError } = await supabase.from("receipt_page_hashes").insert(
    hashes.map((hash, index) => ({
      project_id: projectId,
      expense_id: id,
      page_number: index + 1,
      hash,
    })),
  )
  if (hashError) {
    await supabase.from("expenses").delete().eq("id", id)
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    return { error: hashError.message }
  }

  refresh(projectId)
  return { id }
}

export async function replaceScannedFile(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const expenseId = String(formData.get("expenseId") ?? "")
  const file = formData.get("file")
  if (!(file instanceof File) || !projectId || !expenseId) return { error: "The replacement scan is missing" }
  const supabase = await requireAdmin()
  const { data } = await supabase
    .from("expenses")
    .select("receipt_file_path")
    .eq("id", expenseId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (!data) return { error: "Receipt not found" }
  const extension = file.type === "image/png" ? "png" : file.type === "application/pdf" ? "pdf" : file.type === "image/webp" ? "webp" : "jpg"
  const path = data.receipt_file_path.replace(/\.[^.]+$/, `.${extension}`)
  const uploaded = await supabase.storage.from("receipts").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })
  if (uploaded.error) return { error: uploaded.error.message }
  if (path !== data.receipt_file_path) {
    await supabase.storage.from("receipts").remove([data.receipt_file_path])
    await supabase.from("expenses").update({ receipt_file_path: path, file_type: extension === "pdf" ? "pdf" : "image" }).eq("id", expenseId)
  }
  refresh(projectId)
  return { id: expenseId }
}

export async function uploadReceipt(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const hash = String(formData.get("hash") ?? "").toLowerCase()
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  if (!(file instanceof File) || !projectId || !/^[0-9a-f]{64}$/.test(hash)) {
    return { error: "The receipt file is missing or could not be hashed" }
  }

  const existing = await lookupReceiptHash(projectId, hash)
  if ("error" in existing && existing.error) return { error: existing.error }
  if (existing.duplicate) {
    return {
      error: `Duplicate receipt — already uploaded on ${existing.duplicate.date}`,
      existingId: existing.duplicate.id,
    }
  }

  const supabase = await requireAdmin()
  const id = crypto.randomUUID()
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  const path = `${projectId}/${id}.${isPdf ? "pdf" : "jpg"}`
  const fileBytes = Buffer.from(await file.arrayBuffer())
  const uploaded = await supabase.storage.from("receipts").upload(path, fileBytes, {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  let thumbPath: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    thumbPath = `${projectId}/thumbs/${id}.jpg`
    const thumbBytes = Buffer.from(await thumb.arrayBuffer())
    const thumbUpload = await supabase.storage
      .from("receipts")
      .upload(thumbPath, thumbBytes, { contentType: "image/jpeg", upsert: false })
    if (thumbUpload.error) thumbPath = null
  }

  const { error } = await supabase.from("expenses").insert({
    id,
    project_id: projectId,
    amount: "0.00",
    receipt_file_path: path,
    receipt_file_hash: hash,
    receipt_thumbnail_path: thumbPath,
    verification_status: "needs_review",
  })
  if (error) {
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    return { error: error.message }
  }
  refresh(projectId)
  return { id }
}

export async function updateExpenseFields(input: {
  projectId: string
  expenseId: string
  categoryId?: number | null
  amount?: string
  vendor?: string
  expenseDate?: string
  description?: string
  receiptNumber?: string
  paymentMethod?: string
  verify?: boolean
}) {
  const supabase = await requireAdmin()
  const patch: Database["public"]["Tables"]["expenses"]["Update"] = {}
  if ("categoryId" in input) patch.category_id = input.categoryId ?? null
  if (input.amount != null) {
    const cents = parseMoneyInput(input.amount)
    if (cents == null) return { error: "Amount is not valid" }
    patch.amount = centsToMoney(cents)
  }
  if ("vendor" in input) patch.vendor = input.vendor?.trim() || null
  if ("expenseDate" in input) patch.expense_date = input.expenseDate || null
  if ("description" in input) patch.description = input.description?.trim() || null
  if ("receiptNumber" in input) patch.receipt_number = input.receiptNumber?.trim() || null
  if ("paymentMethod" in input) patch.payment_method = input.paymentMethod?.trim() || null
  if (input.verify) patch.verification_status = "verified"

  const { error } = await supabase.from("expenses").update(patch).eq("id", input.expenseId)
  if (error) return { error: error.message }
  refresh(input.projectId)
  return { error: null }
}

export async function clearDuplicate(projectId: string, expenseId: string) {
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("expenses")
    .update({ verification_status: "needs_review", duplicate_of: null })
    .eq("id", expenseId)
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}

export async function deleteExpense(projectId: string, expenseId: string) {
  const supabase = await requireAdmin()
  const { data: expense } = await supabase
    .from("expenses")
    .select("receipt_file_path, receipt_thumbnail_path, split_group_id, receipt_file_hash")
    .eq("id", expenseId)
    .maybeSingle()
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId)
  if (error) return { error: error.message }
  if (expense && !expense.split_group_id) {
    await supabase.storage
      .from("receipts")
      .remove(
        [expense.receipt_file_path, expense.receipt_thumbnail_path].filter(
          Boolean,
        ) as string[],
      )
  }
  refresh(projectId)
  return { error: null }
}

export async function saveSplit(input: {
  projectId: string
  expenseId: string
  total: string
  rows: Array<{ categoryId: number | null; amount: string; description: string }>
}) {
  const totalCents = parseMoneyInput(input.total)
  if (totalCents == null) return { error: "Receipt total is not valid" }
  const parts = input.rows.map((row) => {
    const cents = parseMoneyInput(row.amount)
    return { ...row, cents }
  })
  if (parts.some((row) => row.cents == null)) return { error: "Each split amount must be valid" }
  const sum = parts.reduce((total, row) => total + (row.cents ?? 0), 0)
  if (sum !== totalCents) {
    return {
      error: `Splits add up to ${centsToMoney(sum)}, but the receipt total is ${centsToMoney(totalCents)}`,
    }
  }
  if (parts.length < 2) return { error: "A split needs at least two lines" }

  const supabase = await requireAdmin()
  const { data: original, error: loadError } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (loadError || !original) return { error: loadError?.message ?? "Receipt not found" }

  const groupId = original.split_group_id ?? crypto.randomUUID()
  const first = parts[0]
  const { error: updateError } = await supabase
    .from("expenses")
    .update({
      split_group_id: groupId,
      category_id: first.categoryId,
      amount: centsToMoney(first.cents!),
      description: first.description.trim() || null,
      verification_status: "needs_review",
    })
    .eq("id", original.id)
  if (updateError) return { error: updateError.message }

  if (original.split_group_id) {
    await supabase
      .from("expenses")
      .delete()
      .eq("split_group_id", original.split_group_id)
      .neq("id", original.id)
  }

  const inserts = parts.slice(1).map((row) => ({
    project_id: original.project_id,
    category_id: row.categoryId,
    vendor: original.vendor,
    expense_date: original.expense_date,
    amount: centsToMoney(row.cents!),
    receipt_number: original.receipt_number,
    description: row.description.trim() || null,
    payment_method: original.payment_method,
    receipt_file_path: original.receipt_file_path,
    receipt_file_hash: original.receipt_file_hash,
    receipt_thumbnail_path: original.receipt_thumbnail_path,
    split_group_id: groupId,
    ai_extracted: original.ai_extracted,
    ai_suggested_category_ids: original.ai_suggested_category_ids,
    ai_confidence: original.ai_confidence,
    verification_status: "needs_review" as const,
  }))
  const { error: insertError } = await supabase.from("expenses").insert(inserts)
  if (insertError) return { error: insertError.message }
  refresh(input.projectId)
  return { error: null }
}

export async function assignInvoiceNumber(input: {
  projectId: string
  expenseId: string
  invoiceNumber: string
}) {
  const number = input.invoiceNumber.trim()
  const supabase = await requireAdmin()
  const { data: expense } = await supabase
    .from("expenses")
    .select("id")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (!expense) return { error: "Expense not found" }

  if (!number) {
    const { error } = await supabase
      .from("expenses")
      .update({ invoice_id: null })
      .eq("id", input.expenseId)
    if (error) return { error: error.message }
    refresh(input.projectId)
    return { error: null }
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("invoice_number", number)
    .maybeSingle()

  let invoiceId = invoice?.id
  if (!invoiceId) {
    const { data: created, error } = await supabase
      .from("invoices")
      .insert({
        project_id: input.projectId,
        invoice_number: number,
        invoice_date: new Date().toISOString().slice(0, 10),
        total_amount: "0.00",
      })
      .select("id")
      .single()
    if (error || !created) return { error: error?.message ?? "Could not save the invoice number" }
    invoiceId = created.id
  }

  const { error } = await supabase
    .from("expenses")
    .update({ invoice_id: invoiceId })
    .eq("id", input.expenseId)
  if (error) return { error: error.message }
  await syncInvoiceTotal(invoiceId)
  refresh(input.projectId)
  return { error: null, invoiceId }
}

export async function setExpenseBillingStatus(input: {
  projectId: string
  expenseId: string
  status: "unpaid" | "paid" | "partial"
}) {
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("expenses")
    .update({ billing_status: input.status })
    .eq("id", input.expenseId)
    .eq("project_id", input.projectId)
  if (error) return { error: error.message }
  const { data: expense } = await supabase
    .from("expenses")
    .select("invoice_id")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (expense?.invoice_id) {
    const { data: linked } = await supabase
      .from("expenses")
      .select("billing_status")
      .eq("invoice_id", expense.invoice_id)
    const rollup = deriveInvoiceBillingStatus((linked ?? []).map((row) => row.billing_status))
    const status = rollup === "paid" ? "paid" : rollup === "partial" ? "partially_paid" : "pending"
    const { data: invoice } = await supabase.from("invoices").select("status").eq("id", expense.invoice_id).maybeSingle()
    if (invoice && invoice.status !== "void") {
      await supabase.from("invoices").update({ status }).eq("id", expense.invoice_id)
    }
  }
  refresh(input.projectId)
  return { error: null }
}

export async function linkExpensesToInvoice(input: {
  projectId: string
  expenseIds: string[]
  invoiceNumber: string
}) {
  const blocked: string[] = []
  for (const expenseId of input.expenseIds) {
    const result = await assignInvoiceNumber({
      projectId: input.projectId,
      expenseId,
      invoiceNumber: input.invoiceNumber,
    })
    if (result.error) blocked.push(result.error)
  }
  if (blocked.length) return { error: blocked[0] }
  return { error: null }
}

export async function syncInvoiceTotal(invoiceId: string) {
  const supabase = await requireAdmin()
  const { data: invoice } = await supabase
    .from("invoices")
    .select("subtotal")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!invoice) return
  await supabase
    .from("invoices")
    .update({
      total_amount: centsToMoney(moneyToCents(invoice.subtotal)),
      builder_fee: "0.00",
      retainage: "0.00",
    })
    .eq("id", invoiceId)
}
