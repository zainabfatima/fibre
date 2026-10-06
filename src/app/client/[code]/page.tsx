import { notFound } from "next/navigation"

import { ClientExpenses } from "@/components/client-expenses"
import { ClientLoginForm } from "@/components/client-login-form"
import { ClientShell } from "@/components/client-shell"
import { findProjectByClientCode } from "@/lib/client-access"
import { isClientCode } from "@/lib/client-code"
import { getClientProjectCode } from "@/lib/client-session"
import { formatCategory } from "@/lib/format"
import { moneyToCents, sumCents } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project expenses",
  robots: { index: false, follow: false },
}

export default async function ClientProjectPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  if (!isClientCode(code)) notFound()

  const session = await getClientProjectCode()
  if (session !== code) {
    return (
      <ClientShell>
        <ClientLoginForm />
      </ClientShell>
    )
  }

  const found = await findProjectByClientCode(code)
  if (!found.ok) {
    const error =
      found.reason === "ambiguous"
        ? "That number matches more than one project."
        : "No project uses that number."
    return (
      <ClientShell>
        <ClientLoginForm initialError={error} />
      </ClientShell>
    )
  }

  const project = found.project
  const admin = createAdminClient()
  const [{ data: expenses, error: expenseError }, { data: totals, error: totalsError }, { data: payments, error: paymentError }, { data: summary, error: summaryError }] =
    await Promise.all([
      admin
        .from("v_expense_rows")
        .select("*")
        .eq("project_id", project.id)
        .eq("verification_status", "verified")
        .order("expense_date", { ascending: false, nullsFirst: false }),
      admin.from("v_project_category_totals").select("*").eq("project_id", project.id).order("code"),
      admin.from("client_payments").select("amount").eq("project_id", project.id),
      admin.from("v_project_summary").select("total_spent").eq("project_id", project.id).maybeSingle(),
    ])
  if (expenseError) throw new Error(expenseError.message)
  if (totalsError) throw new Error(totalsError.message)
  if (paymentError) throw new Error(paymentError.message)
  if (summaryError) throw new Error(summaryError.message)

  const rows = expenses ?? []
  const paths = rows
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const signed = paths.length
    ? await admin.storage.from("receipts").createSignedUrls(paths, 1800)
    : { data: [] }
  const thumbs = new Map(
    (signed.data ?? []).flatMap((item) =>
      item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  )
  const items = rows.map((row) => ({
    id: row.id,
    date: row.expense_date,
    vendor: row.vendor,
    amount: row.amount,
    categoryId: row.category_id,
    thumbUrl: row.receipt_thumbnail_path ? (thumbs.get(row.receipt_thumbnail_path) ?? null) : null,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    hasInvoiceFile: Boolean(row.invoice_file_path),
    billingStatus: row.billing_status,
    pageCount: row.page_count,
  }))
  const grouped = new Map<number | null, typeof items>()
  for (const item of items) {
    const list = grouped.get(item.categoryId) ?? []
    list.push(item)
    grouped.set(item.categoryId, list)
  }
  const sections = (totals ?? []).map((category) => ({
    id: category.category_id,
    title: formatCategory(category.code, category.name),
    budget: category.budget ?? 0,
    rows: grouped.get(category.category_id) ?? [],
  }))

  return (
    <ClientShell leave>
      <ClientExpenses
        name={project.name}
        address={project.address}
        spentCents={moneyToCents(summary?.total_spent ?? 0)}
        receivedCents={sumCents((payments ?? []).map((payment) => payment.amount))}
        sections={sections}
        uncategorized={grouped.get(null) ?? []}
        invoiceTracking={project.invoice_tracking}
      />
    </ClientShell>
  )
}
