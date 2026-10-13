import { NextResponse } from "next/server"

import { buildReceiptPdf } from "@/lib/category-packet"
import { requireAdminApi } from "@/lib/db"
import { buildImagePrintHtml } from "@/lib/print-crop"

export const maxDuration = 60

function slug(value: string) {
  return value.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "Receipt"
}

function isPdfFile(path: string, fileType: string) {
  return fileType === "pdf" || path.toLowerCase().endsWith(".pdf")
}

export async function GET(
  request: Request,
  context: { params: Promise<{ expenseId: string }> },
) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: "Sign in required" }, { status: 401 })

  const { expenseId } = await context.params
  const { data: expense, error } = await admin
    .from("expenses")
    .select("id, vendor, expense_date, receipt_file_path, file_type")
    .eq("id", expenseId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Could not open the receipt" }, { status: 500 })
  if (!expense?.receipt_file_path) return NextResponse.json({ error: "Receipt not found" }, { status: 404 })

  const printing = new URL(request.url).searchParams.get("print") === "1"
  const date = expense.expense_date?.slice(0, 10) ?? ""
  const filename = `${slug(expense.vendor?.trim() || "Receipt")}${date ? `_${date}` : ""}.pdf`

  if (printing && !isPdfFile(expense.receipt_file_path, expense.file_type)) {
    return new NextResponse(buildImagePrintHtml(`/r/${expense.id}`), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  }

  const downloaded = await admin.storage.from("receipts").download(expense.receipt_file_path)
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: "Receipt file missing" }, { status: 404 })
  }
  let pdf: Buffer
  try {
    pdf = await buildReceiptPdf({
      bytes: Buffer.from(await downloaded.data.arrayBuffer()),
      path: expense.receipt_file_path,
      fileType: expense.file_type,
      title: filename.replace(/\.pdf$/, ""),
    })
  } catch {
    return NextResponse.json({ error: "Could not build the receipt PDF" }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${printing ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
