import { NextResponse } from "next/server"

import { importBudgetSheet } from "@/lib/budget-sheet"
import { requireAdminApi } from "@/lib/db"

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await requireAdminApi()
  if (!supabase) {
    return NextResponse.json({ error: "Sign in required", matched: 0, unmatched: [] }, { status: 401 })
  }
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Choose an Excel file.", matched: 0, unmatched: [] },
      { status: 400 },
    )
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      {
        error: "Upload an .xlsx file with two columns: category name and budget amount.",
        matched: 0,
        unmatched: [],
      },
      { status: 400 },
    )
  }
  if (file.size > 5_000_000) {
    return NextResponse.json(
      { error: "That file is too large.", matched: 0, unmatched: [] },
      { status: 400 },
    )
  }
  try {
    const result = await importBudgetSheet(Buffer.from(await file.arrayBuffer()))
    return NextResponse.json(result, { status: result.error ? 400 : 200 })
  } catch (cause) {
    return NextResponse.json(
      {
        error: cause instanceof Error ? cause.message : "Could not read that budget sheet",
        matched: 0,
        unmatched: [],
      },
      { status: 400 },
    )
  }
}
