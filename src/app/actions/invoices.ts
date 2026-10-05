"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/db"
import { readInvoiceDocumentTotal } from "@/lib/extract-receipt"
import { centsToMoney, parseMoneyInput } from "@/lib/money"

function refresh(projectId: string) {
  revalidatePath("/")
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/invoices`)
}

export async function uploadInvoiceFile(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId") ?? "")
  const projectId = String(formData.get("projectId") ?? "")
  const file = formData.get("file")
  if (!(file instanceof File)) throw new Error("Choose an invoice image or PDF")
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  const path = `${projectId}/${invoiceId}.${isPdf ? "pdf" : "jpg"}`
  const supabase = await requireAdmin()
  const bytes = Buffer.from(await file.arrayBuffer())
  const uploaded = await supabase.storage.from("invoices").upload(path, bytes, {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
    upsert: true,
  })
  if (uploaded.error) throw new Error(uploaded.error.message)
  const { error } = await supabase
    .from("invoices")
    .update({ file_path: path })
    .eq("id", invoiceId)
  if (error) throw new Error(error.message)
  refresh(projectId)
}

export async function updateInvoice(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId") ?? "")
  const projectId = String(formData.get("projectId") ?? "")
  const status = String(formData.get("status") ?? "pending")
  const paidText = String(formData.get("amountPaid") ?? "")
  const paidDate = String(formData.get("paidDate") ?? "")
  const notes = String(formData.get("notes") ?? "")
  const invoiceDate = String(formData.get("invoiceDate") ?? "")
  if (status !== "pending" && status !== "paid" && status !== "partially_paid" && status !== "void") {
    throw new Error("Unknown status")
  }
  const paid = parseMoneyInput(paidText || "0")
  if (paid == null) throw new Error("Enter a valid amount paid")

  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("invoices")
    .update({
      status,
      amount_paid: centsToMoney(paid),
      paid_date: paidDate || null,
      notes: notes.trim() || null,
      invoice_date: invoiceDate,
    })
    .eq("id", invoiceId)
  if (error) throw new Error(error.message)
  refresh(projectId)
  revalidatePath(`/projects/${projectId}/invoices/${invoiceId}`)
}

export async function readInvoiceTotal(projectId: string, invoiceId: string) {
  await requireAdmin()
  try {
    await readInvoiceDocumentTotal(invoiceId)
    refresh(projectId)
    revalidatePath(`/projects/${projectId}/invoices/${invoiceId}`)
    return { error: null }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Could not read the invoice" }
  }
}
