import { NextResponse } from "next/server"

import { requireAdminApi } from "@/lib/db"
import { extractExpense, readInvoiceDocumentTotal } from "@/lib/extract-receipt"

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await requireAdminApi()
  if (!supabase) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }
  const body = (await request.json()) as {
    expenseId?: string
    invoiceId?: string
    categoryId?: number | null
  }
  try {
    if (body.expenseId) {
      const categoryId =
        typeof body.categoryId === "number" && Number.isInteger(body.categoryId)
          ? body.categoryId
          : null
      const result = await extractExpense(
        body.expenseId,
        categoryId == null ? undefined : { categoryId },
      )
      return NextResponse.json(result)
    }
    if (body.invoiceId) {
      const total = await readInvoiceDocumentTotal(body.invoiceId)
      return NextResponse.json({ ok: true, total })
    }
    return NextResponse.json({ error: "Missing expenseId" }, { status: 400 })
  } catch (cause) {
    return NextResponse.json(
      { ok: false, error: cause instanceof Error ? cause.message : "Extraction failed" },
      { status: 200 },
    )
  }
}
