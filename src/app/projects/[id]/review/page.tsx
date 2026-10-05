import { notFound } from "next/navigation"

import { ReviewScreen } from "@/components/review-screen"
import { createAdminClient } from "@/lib/supabase/admin"
import { centsToMoney, moneyToCents } from "@/lib/money"
import { listCategories, listExpenseRows } from "@/lib/queries"
import type { Json } from "@/types/database"

export const dynamic = "force-dynamic"

function asRecord(value: Json | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, Json | undefined>
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ expense?: string }>
}) {
  const { id } = await params
  const { expense } = await searchParams
  const [categories, rows] = await Promise.all([listCategories(true), listExpenseRows(id)])
  const queue = rows
    .filter((row) => row.verification_status !== "verified")
    .map((row) => row.id)
  const currentId = expense && rows.some((row) => row.id === expense) ? expense : queue[0]
  const current = rows.find((row) => row.id === currentId)
  if (!current) {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground">
        Nothing is waiting for review.
      </p>
    )
  }
  const admin = createAdminClient()
  const paths = [current.receipt_file_path, current.receipt_thumbnail_path].filter(
    (path): path is string => Boolean(path),
  )
  const duplicate = current.duplicate_of
    ? rows.find((row) => row.id === current.duplicate_of)
    : null
  if (duplicate?.receipt_file_path) paths.push(duplicate.receipt_file_path)
  const signed = await admin.storage.from("receipts").createSignedUrls(paths, 60 * 30)
  const byPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))
  const extracted = asRecord(current.ai_extracted)
  const lineItems = Array.isArray(extracted?.line_items)
    ? extracted.line_items.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const record = item as Record<string, Json | undefined>
        const code = typeof record.category_code === "number" ? record.category_code : null
        const category = categories.find((entry) => entry.code === code)
        return [
          {
            description: typeof record.description === "string" ? record.description : "",
            amount:
              typeof record.amount === "number" ? record.amount.toFixed(2) : "",
            categoryId: category?.id ?? null,
          },
        ]
      })
    : []
  const { data: audit } = await admin
    .from("expense_audit")
    .select("field, old_value, new_value, changed_at")
    .eq("expense_id", current.id)
    .order("changed_at", { ascending: false })
    .limit(12)
  if (!current.id) notFound()

  return (
    <ReviewScreen
      projectId={id}
      expenseId={current.id}
      queue={queue.length ? queue : [current.id]}
      vendor={current.vendor ?? ""}
      date={current.expense_date ?? ""}
      amount={centsToMoney(moneyToCents(current.amount))}
      description={current.description ?? ""}
      receiptNumber={current.receipt_number ?? ""}
      paymentMethod={current.payment_method ?? ""}
      categoryId={current.category_id}
      confidence={current.ai_confidence == null ? null : Number(current.ai_confidence)}
      suggestedIds={current.ai_suggested_category_ids ?? []}
      imageUrl={byPath.get(current.receipt_file_path) ?? null}
      notes={typeof extracted?.notes === "string" ? extracted.notes : null}
      splitSuggested={extracted?.split_suggested === true}
      lineItems={lineItems}
      duplicate={
        duplicate
          ? {
              id: duplicate.id,
              vendor: duplicate.vendor,
              amount: centsToMoney(moneyToCents(duplicate.amount)),
              date: duplicate.expense_date,
              imageUrl: duplicate.receipt_file_path
                ? (byPath.get(duplicate.receipt_file_path) ?? null)
                : null,
            }
          : null
      }
      audit={(audit ?? []).map((entry) => ({
        field: entry.field,
        oldValue: entry.old_value,
        newValue: entry.new_value,
        at: entry.changed_at,
      }))}
      categories={categories.map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
      }))}
    />
  )
}
