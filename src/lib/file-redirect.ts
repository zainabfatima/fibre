import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/app-session"
import { clientSessionOwnsProject } from "@/lib/client-access"
import { createAdminClient } from "@/lib/supabase/admin"

function contentType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".pdf")) return "application/pdf"
  return "image/jpeg"
}

async function sendStoredFile(
  request: Request,
  bucket: "receipts" | "invoices",
  path: string | null,
  projectId: string,
  tokenFromPath: string | undefined,
  clientAllowed: boolean,
  office: boolean,
) {
  const url = new URL(request.url)
  const token = tokenFromPath || url.searchParams.get("t")
  const admin = createAdminClient()
  if (!office && !clientAllowed) {
    if (!token) return NextResponse.json({ error: "This link is not valid" }, { status: 401 })
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
  const downloaded = await admin.storage.from(bucket).download(path)
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: downloaded.error?.message ?? "File missing" }, { status: 404 })
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  const filename = path.split("/").pop() || "file"
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType(path),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function openReceipt(request: Request, expenseId: string, tokenFromPath?: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("expenses")
    .select("project_id, receipt_file_path")
    .eq("id", expenseId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "Receipt not found" }, { status: 404 })
  const sessionUser = await getSessionUser()
  if (sessionUser?.role === "staff") return NextResponse.json({ error: "This link is not valid" }, { status: 403 })
  const office = sessionUser?.role === "admin"
  const clientAllowed = office ? false : await clientSessionOwnsProject(data.project_id)
  return sendStoredFile(
    request,
    "receipts",
    data.receipt_file_path,
    data.project_id,
    tokenFromPath,
    clientAllowed,
    office,
  )
}

export async function openInvoice(request: Request, invoiceId: string, tokenFromPath?: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("invoices")
    .select("project_id, file_path")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  const sessionUser = await getSessionUser()
  if (sessionUser?.role === "staff") return NextResponse.json({ error: "This link is not valid" }, { status: 403 })
  const office = sessionUser?.role === "admin"
  const clientAllowed = office ? false : await clientSessionOwnsProject(data.project_id)
  return sendStoredFile(request, "invoices", data.file_path, data.project_id, tokenFromPath, clientAllowed, office)
}
