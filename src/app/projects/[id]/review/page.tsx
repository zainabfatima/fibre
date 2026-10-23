import { notFound } from "next/navigation"

import { ReviewScreen } from "@/components/review-screen"
import { createAdminClient } from "@/lib/supabase/admin"
import { duplicatePartners } from "@/lib/duplicates"
import { centsToMoney, moneyToCents, parseSignedAmount, signedExpenseAmount } from "@/lib/money"
import { listCategories, listExpenseRows } from "@/lib/queries"
import type { Json } from "@/types/database"

export const dynamic = "force-dynamic"

function asRecord(value: Json | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, Json | undefined>
}

function signedLineAmount(value: Json | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return centsToMoney(moneyToCents(value.toFixed(2)))
  }
  if (typeof value === "string") {
    const signed = parseSignedAmount(value)
    if (signed != null) return centsToMoney(moneyToCents(signed.toFixed(2)))
  }
  return ""
}

function receiptAmount(stored: string | number, extracted: Record<string, Json | undefined> | null) {
  const storedCents = moneyToCents(stored)
  if (storedCents !== 0) return centsToMoney(storedCents)
  const numeric = parseSignedAmount(extracted?.total_amount_paid)
  if (numeric != null) return centsToMoney(moneyToCents(numeric.toFixed(2)))
  return centsToMoney(storedCents)
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
  const pending = rows.filter((row) => row.verification_status !== "verified")
  const queue = pending.map((row) => row.id)
  const currentId = expense && queue.includes(expense) ? expense : queue[0]
  const current = rows.find((row) => row.id === currentId)
  if (!current) {
    return (
      <div className="px-4 py-6">
        <p className="text-2xl font-semibold tabular-nums">0</p>
        <p className="text-sm text-muted-foreground">pending reviews</p>
      </div>
    )
  }
  const admin = createAdminClient()
  const duplicateChecks = rows.map((row) => ({
    id: row.id,
    amount: signedExpenseAmount(row.amount, row.ai_extracted),
    date: row.expense_date,
    duplicateOf: row.duplicate_of,
    duplicateConfirmed: Boolean(row.duplicate_confirmed),
    splitGroupId: row.split_group_id,
  }))
  const currentCheck = duplicateChecks.find((row) => row.id === current.id)
  const partners = currentCheck ? duplicatePartners(currentCheck, duplicateChecks) : []
  const partnerId =
    current.duplicate_of && partners.some((partner) => partner.id === current.duplicate_of)
      ? current.duplicate_of
      : partners[0]?.id
  const duplicate = partnerId ? (rows.find((row) => row.id === partnerId) ?? null) : null
  const paths = [current.receipt_thumbnail_path, duplicate?.receipt_thumbnail_path].filter(
    (path): path is string => Boolean(path),
  )
  const signed = paths.length
    ? await admin.storage.from("receipts").createSignedUrls(paths, 60 * 30)
    : { data: [] }
  const byPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))
  const fileType =
    current.file_type === "pdf" || current.receipt_file_path.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : "image"
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
            amount: signedLineAmount(record.amount),
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
    <div>
      <div className="px-4 pt-4">
        <p className="text-2xl font-semibold tabular-nums">{pending.length}</p>
        <p className="text-sm text-muted-foreground">
          pending {pending.length === 1 ? "review" : "reviews"}
        </p>
      </div>
    <ReviewScreen
      key={current.id}
      projectId={id}
      expenseId={current.id}
      queue={queue.length ? queue : [current.id]}
      vendor={current.vendor || (typeof extracted?.vendor === "string" ? extracted.vendor : "")}
      date={current.expense_date || (typeof extracted?.date === "string" ? extracted.date : "")}
      amount={receiptAmount(current.amount, extracted)}
      description={current.description ?? ""}
      receiptNumber={current.receipt_number ?? ""}
      paymentMethod={current.payment_method ?? ""}
      categoryId={current.category_id}
      confidence={current.ai_confidence == null ? null : Number(current.ai_confidence)}
      suggestedIds={current.ai_suggested_category_ids ?? []}
      fileUrl={`/r/${current.id}`}
      fileType={fileType}
      pageCount={current.page_count ?? 1}
      previewUrl={
        (current.receipt_thumbnail_path ? byPath.get(current.receipt_thumbnail_path) : null) ??
        (fileType === "image" ? `/r/${current.id}` : null)
      }
      notes={
        [
          current.needs_manual_crop ? "This photo was saved without a crop. The paper edges were not clear." : "",
          typeof extracted?.notes === "string" ? extracted.notes : "",
        ]
          .filter(Boolean)
          .join(" ") || null
      }
      splitSuggested={extracted?.split_suggested === true}
      lineItems={lineItems}
      returnConfirmed={Boolean(current.return_confirmed)}
      duplicate={
        duplicate
          ? {
              id: duplicate.id,
              vendor: duplicate.vendor,
              amount: centsToMoney(moneyToCents(duplicate.amount)),
              date: duplicate.expense_date,
              imageUrl:
                (duplicate.receipt_thumbnail_path
                  ? byPath.get(duplicate.receipt_thumbnail_path)
                  : null) ??
                (duplicate.file_type === "pdf" || duplicate.receipt_file_path.toLowerCase().endsWith(".pdf")
                  ? null
                  : `/r/${duplicate.id}`),
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
    </div>
  )
}
