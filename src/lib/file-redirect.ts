import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionToken } from "@/lib/session"

async function redirectToFile(
  request: Request,
  bucket: "receipts" | "invoices",
  path: string | null,
  projectId: string,
) {
  const url = new URL(request.url)
  const token = url.searchParams.get("t")
  const session = await getSessionToken()
  const admin = createAdminClient()
  if (!session) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    const { data: project } = await admin
      .from("projects")
      .select("id")
      .eq("share_token", token)
      .maybeSingle()
    if (!project || project.id !== projectId) {
      return NextResponse.json({ error: "This link is not valid" }, { status: 403 })
    }
  }
  if (!path) return NextResponse.json({ error: "No file" }, { status: 404 })
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60)
  if (signed.error || !signed.data) {
    return NextResponse.json({ error: signed.error?.message ?? "File missing" }, { status: 404 })
  }
  return NextResponse.redirect(signed.data.signedUrl)
}

export async function openReceipt(request: Request, expenseId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("expenses")
    .select("project_id, receipt_file_path")
    .eq("id", expenseId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "Receipt not found" }, { status: 404 })
  return redirectToFile(request, "receipts", data.receipt_file_path, data.project_id)
}

export async function openInvoice(request: Request, invoiceId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("invoices")
    .select("project_id, file_path")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  return redirectToFile(request, "invoices", data.file_path, data.project_id)
}
