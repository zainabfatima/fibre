import { notFound } from "next/navigation"

import { CategoryChart } from "@/components/category-chart"
import { CategorySheets } from "@/components/category-sheets"
import { ExpenseAmountSearchBar, ExpenseSearchProvider } from "@/components/expense-amount-search"
import { type SheetRow } from "@/components/expense-sheet"
import { ClientLoginForm } from "@/components/client-login-form"
import { ClientShell } from "@/components/client-shell"
import { MoneySummary } from "@/components/money-summary"
import { findProjectByClientCode } from "@/lib/client-access"
import { isClientCode } from "@/lib/client-code"
import { getClientProjectCode } from "@/lib/client-session"
import { formatCategory } from "@/lib/format"
import { centsToMoney, moneyToCents, sumCents } from "@/lib/money"
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
        .order("expense_date", { ascending: false, nullsFirst: false }),
      admin.from("v_project_category_totals").select("*").eq("project_id", project.id).order("code"),
      admin.from("client_payments").select("amount").eq("project_id", project.id),
      admin.from("v_project_summary").select("total_spent").eq("project_id", project.id).maybeSingle(),
    ])
  if (expenseError) throw new Error(expenseError.message)
  if (totalsError) throw new Error(totalsError.message)
  if (paymentError) throw new Error(paymentError.message)
  if (summaryError) throw new Error(summaryError.message)

  const thumbs = (expenses ?? [])
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const thumbByPath = new Map<string, string>()
  for (let index = 0; index < thumbs.length; index += 80) {
    const batch = thumbs.slice(index, index + 80)
    const signed = await admin.storage.from("receipts").createSignedUrls(batch, 60 * 30)
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) thumbByPath.set(item.path, item.signedUrl)
    }
  }

  const rows: SheetRow[] = (expenses ?? []).map((row) => ({
    id: row.id,
    date: row.expense_date,
    vendor: row.vendor,
    description: row.description,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    amount: centsToMoney(moneyToCents(row.amount)),
    receiptNumber: row.receipt_number,
    receiptTime: row.receipt_time,
    paymentMethod: row.payment_method,
    cardLast4: row.card_last4,
    duplicateOf: null,
    returnConfirmed: Boolean(row.return_confirmed),
    thumbUrl: row.receipt_thumbnail_path ? (thumbByPath.get(row.receipt_thumbnail_path) ?? null) : null,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    hasInvoiceFile: Boolean(row.invoice_file_path),
    invoiceStatus: row.invoice_status ?? "not_invoiced",
    billingStatus: row.billing_status,
    verificationStatus: row.verification_status,
    hasReceipt: Boolean(row.receipt_file_path),
    pageCount: row.page_count,
  }))
  const sheetCategories = (totals ?? []).map((row) => ({
    id: row.category_id,
    code: row.code,
    name: row.name,
    budget: row.budget ?? 0,
  }))
  const chart = (totals ?? [])
    .map((row) => ({
      label: formatCategory(row.code, row.name),
      name: formatCategory(row.code, row.name),
      cents: moneyToCents(row.total_spent),
      code: row.code,
    }))
    .sort((a, b) => {
      if (a.cents === 0 && b.cents === 0) return a.code - b.code
      if (a.cents === 0) return 1
      if (b.cents === 0) return -1
      return b.cents - a.cents || a.code - b.code
    })

  return (
    <ClientShell leave>
      <ExpenseSearchProvider categories={sheetCategories} rows={rows}>
        <div className="px-4 pt-2">
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
          <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
        </div>
        <div className="grid gap-4 px-4">
          <MoneySummary
            spentCents={moneyToCents(summary?.total_spent ?? 0)}
            receivedCents={sumCents((payments ?? []).map((payment) => payment.amount))}
          />
        </div>
        <ExpenseAmountSearchBar />
        <section className="m-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:m-4 sm:p-4">
          <h2 className="mb-4 font-medium">Expense by category</h2>
          <CategoryChart rows={chart} />
        </section>
        <CategorySheets
          projectId={project.id}
          categories={sheetCategories}
          rows={rows}
          invoiceTracking={project.invoice_tracking}
          mode="all"
          readOnly
        />
      </ExpenseSearchProvider>
    </ClientShell>
  )
}
