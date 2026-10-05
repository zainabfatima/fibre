import { rotateShareToken } from "@/app/actions/projects"
import { CategoryChart } from "@/components/category-chart"
import { Button } from "@/components/ui/button"
import { CategorySheets } from "@/components/category-sheets"
import { type SheetRow } from "@/components/expense-sheet"
import { MoneySummary } from "@/components/money-summary"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatCategory } from "@/lib/format"
import { centsToMoney, moneyToCents, sumCents } from "@/lib/money"
import {
  appBaseUrl,
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
  const signed = thumbs.length
    ? await admin.storage.from("receipts").createSignedUrls(thumbs, 60 * 30)
    : { data: [] }
  const thumbByPath = new Map(
    (signed.data ?? []).map((item) => [item.path, item.signedUrl]),
  )
  const rows: SheetRow[] = expenses.map((row) => ({
    id: row.id,
    date: row.expense_date,
    vendor: row.vendor,
    description: row.description,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    amount: centsToMoney(moneyToCents(row.amount)),
    thumbUrl: row.receipt_thumbnail_path
      ? (thumbByPath.get(row.receipt_thumbnail_path) ?? null)
      : null,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    hasInvoiceFile: Boolean(row.invoice_file_path),
    invoiceStatus: row.invoice_status ?? "not_invoiced",
    billingStatus: row.billing_status,
    verificationStatus: row.verification_status,
  }))
  const spentCents = moneyToCents(summary?.total_spent ?? 0)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))
  const chart = totals.map((row) => ({
    label: formatCategory(row.code, row.name),
    name: formatCategory(row.code, row.name),
    cents: moneyToCents(row.total_spent),
  }))

  return (
    <div>
      <div className="grid gap-4 px-4 pt-4">
        <MoneySummary
          invoiceTracking={project.invoice_tracking}
          spentCents={spentCents}
          receivedCents={receivedCents}
          invoicedCents={moneyToCents(summary?.total_invoiced ?? 0)}
          pendingCents={moneyToCents(summary?.total_pending ?? 0)}
          notInvoicedCents={moneyToCents(summary?.total_not_invoiced ?? 0)}
        />
      </div>
      <section className="m-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-4 font-medium">Expense by category</h2>
        <CategoryChart rows={chart} />
      </section>
      <CategorySheets
        projectId={id}
        categories={totals.map((row) => ({
          id: row.category_id,
          code: row.code,
          name: row.name,
        }))}
        rows={needs ? rows.filter((row) => row.invoiceStatus === "not_invoiced") : rows}
        invoiceTracking={project.invoice_tracking}
        mode={needs ? "needs" : "all"}
      />
      <div className="mx-4 mb-8 mt-2 grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Export and share</h2>
        <form action={`/api/export/${id}`} className="flex flex-wrap items-center gap-3 text-sm">
          <button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground" type="submit">
            Download Excel with receipts
          </button>
          <a className="underline" href={`/api/packet/${id}/all`}>
            Download all category PDFs
          </a>
        </form>
        <p className="text-sm text-muted-foreground">
          The workbook has one sheet per category, including categories with no expenses, and the receipt picture on each row.
        </p>
        {project.share_token ? (
          <a
            className="w-fit rounded-lg border border-border px-3 py-2 text-sm"
            href={`${appBaseUrl()}/share/${project.share_token}`}
          >
            Open client share link
          </a>
        ) : (
          <form action={async () => { "use server"; await rotateShareToken(id) }}>
            <Button type="submit" variant="outline">
              Create client share link
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
