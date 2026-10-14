import { CategoryChart } from "@/components/category-chart"
import { CategorySheets } from "@/components/category-sheets"
import { ExpenseAmountSearchBar, ExpenseSearchProvider } from "@/components/expense-amount-search"
import { type SheetRow } from "@/components/expense-sheet"
import { MoneySummary } from "@/components/money-summary"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatCategory } from "@/lib/format"
import { moneyToCents, signedExpenseAmount, sumCents } from "@/lib/money"
import {
  getProject,
  getSummary,
  listCategoryTotals,
  listClientPayments,
  listExpenseRows,
} from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function ProjectExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab } = await searchParams
  const project = await getProject(id)
  if (!project) return null
  const needs = tab === "needs" && project.invoice_tracking
  const [expenses, totals, summary, payments] = await Promise.all([
    listExpenseRows(id),
    listCategoryTotals(id),
    getSummary(id),
    listClientPayments(id),
  ])
  const admin = createAdminClient()
  const thumbs = expenses
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
  const rows: SheetRow[] = expenses.map((row) => ({
    id: row.id,
    date: row.expense_date,
    vendor: row.vendor,
    description: row.description,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    amount: signedExpenseAmount(row.amount, row.ai_extracted),
    receiptNumber: row.receipt_number,
    receiptTime: row.receipt_time,
    paymentMethod: row.payment_method,
    cardLast4: row.card_last4,
    duplicateOf: row.duplicate_of,
    returnConfirmed: Boolean(row.return_confirmed),
    thumbUrl: row.receipt_thumbnail_path
      ? (thumbByPath.get(row.receipt_thumbnail_path) ?? null)
      : null,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    hasInvoiceFile: Boolean(row.invoice_file_path),
    invoiceStatus: row.invoice_status ?? "not_invoiced",
    billingStatus: row.billing_status,
    verificationStatus: row.verification_status,
    hasReceipt: Boolean(row.receipt_file_path),
    pageCount: row.page_count,
  }))
  const spentCents = moneyToCents(summary?.total_spent ?? 0)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))
  const chart = totals
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
  const sheetCategories = totals.map((row) => ({
    id: row.category_id,
    code: row.code,
    name: row.name,
    budget: row.budget ?? 0,
  }))
  const sheetRows = needs
    ? rows.filter((row) => row.invoiceStatus === "not_invoiced" && row.hasReceipt)
    : rows

  return (
    <ExpenseSearchProvider categories={sheetCategories} rows={sheetRows}>
    <div>
      <div className="grid gap-4 px-4 pt-4">
        <MoneySummary spentCents={spentCents} receivedCents={receivedCents} />
      </div>
      <ExpenseAmountSearchBar />
      {needs ? null : (
        <section className="m-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:m-4 sm:p-4">
          <h2 className="mb-4 font-medium">Expense by category</h2>
          <CategoryChart rows={chart} />
        </section>
      )}
      <CategorySheets
        projectId={id}
        categories={sheetCategories}
        rows={sheetRows}
        invoiceTracking={project.invoice_tracking}
        mode={needs ? "needs" : "all"}
      />
      <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="hidden text-sm text-muted-foreground sm:block">
            Category names, each amount, and the company on the receipt.
          </p>
          <a
            href={`/api/export/${id}`}
            className="rounded-lg bg-primary px-3 py-3 text-center text-sm font-medium text-primary-foreground sm:py-2.5"
          >
            Download Excel
          </a>
        </div>
      </div>
    </div>
    </ExpenseSearchProvider>
  )
}
