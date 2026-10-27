import { notFound, redirect } from "next/navigation"

import { getClientAccountUser, getStaffUser } from "@/lib/app-session"
import { projectsForClient } from "@/lib/client-projects"

import { CategoryChart } from "@/components/category-chart"
import { CategorySheets } from "@/components/category-sheets"
import { ExpenseAmountSearchBar, ExpenseSearchProvider } from "@/components/expense-amount-search"
import { type SheetRow } from "@/components/expense-sheet"
import { ClientLoginForm } from "@/components/client-login-form"
import { ClientProjectSwitcher } from "@/components/client-project-list"
import { ClientShell } from "@/components/client-shell"
import { ClientProgressGallery } from "@/components/client-progress-gallery"
import { AudienceTabs, ExpenseDetailSummary } from "@/components/expense-detail-summary"
import { MoneySummary } from "@/components/money-summary"
import { findProjectByClientCode } from "@/lib/client-access"
import { listClientProgressPictures } from "@/lib/client-progress"
import { isClientCode } from "@/lib/client-code"
import { getClientProjectCode } from "@/lib/client-session"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, moneyToCents, signedExpenseAmount, sumCents, totalExpenseCents } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project expenses",
  robots: { index: false, follow: false },
}

export default async function ClientProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ view?: string }>
}) {
  if (await getStaffUser()) redirect("/staff")
  const { code } = await params
  const { view } = await searchParams
  const detailed = view === "summary"
  if (!isClientCode(code)) notFound()

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
  const account = await getClientAccountUser()
  if (account) {
    if (!account.project_ids.includes(project.id)) redirect("/client")
  } else {
    const session = await getClientProjectCode()
    if (session !== code) {
      return (
        <ClientShell>
          <ClientLoginForm />
        </ClientShell>
      )
    }
  }

  if (view === "pictures") {
    const [portalProjects, pictures] = await Promise.all([
      account && account.project_ids.length > 1 ? projectsForClient(account.project_ids) : Promise.resolve([]),
      listClientProgressPictures(project.id),
    ])
    return (
      <ClientShell leave>
        <div className="px-4 pt-2 sm:px-6">
          {portalProjects.length > 1 ? (
            <ClientProjectSwitcher
              projects={portalProjects.flatMap((item) => (item.code ? [{ code: item.code, name: item.name }] : []))}
              currentCode={code}
            />
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
          <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
        </div>
        <div className="px-4 sm:px-6">
          <AudienceTabs
            expensesHref={`/client/${code}`}
            summaryHref={`/client/${code}?view=summary`}
            picturesHref={`/client/${code}?view=pictures`}
            current="pictures"
          />
        </div>
        <ClientProgressGallery pictures={pictures} />
      </ClientShell>
    )
  }

  const admin = createAdminClient()
  const portalPromise = account && account.project_ids.length > 1 ? projectsForClient(account.project_ids) : Promise.resolve([])
  const [{ data: expenses, error: expenseError }, { data: totals, error: totalsError }, { data: payments, error: paymentError }, { data: clientPaid, error: clientPaidError }, { data: summary, error: summaryError }, portalProjects] =
    await Promise.all([
      admin
        .from("v_expense_rows")
        .select("*")
        .eq("project_id", project.id)
        .order("expense_date", { ascending: false, nullsFirst: false }),
      admin.from("v_project_category_totals").select("*").eq("project_id", project.id).order("code"),
      admin.from("client_payments").select("id, received_date, amount, note").eq("project_id", project.id).order("received_date"),
      admin.from("client_paid_expenses").select("id, paid_date, amount, note").eq("project_id", project.id).order("paid_date", { ascending: false }),
      admin.from("v_project_summary").select("total_spent, builder_fee_amount, client_paid_total, builder_fee_percent").eq("project_id", project.id).maybeSingle(),
      portalPromise,
    ])
  if (expenseError) throw new Error(expenseError.message)
  if (totalsError) throw new Error(totalsError.message)
  if (paymentError) throw new Error(paymentError.message)
  if (clientPaidError) throw new Error(clientPaidError.message)
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
    amount: signedExpenseAmount(row.amount, row.ai_extracted),
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
  const billableCents = moneyToCents(summary?.total_spent ?? 0)
  const builderFeeCents = moneyToCents(summary?.builder_fee_amount ?? 0)
  const clientPaidCents = moneyToCents(summary?.client_paid_total ?? 0)
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
        <div className="px-4 pt-2 sm:px-6">
          {portalProjects.length > 1 ? (
            <ClientProjectSwitcher
              projects={portalProjects.flatMap((item) => (item.code ? [{ code: item.code, name: item.name }] : []))}
              currentCode={code}
            />
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
          <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
        </div>
        <div className="px-4 sm:px-6">
          <AudienceTabs
            expensesHref={`/client/${code}`}
            summaryHref={`/client/${code}?view=summary`}
            picturesHref={`/client/${code}?view=pictures`}
            current={detailed ? "summary" : "expenses"}
          />
        </div>
        {detailed ? (
          <div className="px-4 pb-6 sm:px-6">
            <ExpenseDetailSummary
              percent={summary?.builder_fee_percent ?? 0}
              expenseColumns="full"
              expenses={(expenses ?? []).map((row) => ({
                id: row.id,
                date: row.expense_date,
                label: row.vendor?.trim() || "Receipt",
                vendor: row.vendor,
                description: row.description,
                category: row.category_code != null && row.category_name ? formatCategory(row.category_code, row.category_name) : "Uncategorized",
                categorySort: row.category_code ?? 9999,
                amountCents: moneyToCents(row.amount),
                receiptHref: row.receipt_file_path ? `/r/${row.id}` : null,
                thumbUrl: row.receipt_thumbnail_path ? (thumbByPath.get(row.receipt_thumbnail_path) ?? null) : null,
                invoiceNumber: row.invoice_number,
                invoiceStatus: row.invoice_id ? row.billing_status : "not_invoiced",
              }))}
              clientPaid={(clientPaid ?? []).map((entry) => ({
                id: entry.id,
                date: entry.paid_date,
                label: entry.note?.trim() || "Paid by client",
                amountCents: moneyToCents(entry.amount),
              }))}
              payments={(payments ?? []).map((payment) => ({
                id: payment.id,
                date: payment.received_date,
                label: payment.note?.trim() || "Funds Received",
                amountCents: moneyToCents(payment.amount),
              }))}
              billableCents={billableCents}
              builderFeeCents={builderFeeCents}
              clientPaidCents={clientPaidCents}
              receivedCents={sumCents((payments ?? []).map((payment) => payment.amount))}
              excelHref={`/api/export/${project.id}?kind=summary`}
            />
          </div>
        ) : (
        <>
        <div className="grid gap-4 px-4 sm:px-6">
          <MoneySummary
            spentCents={totalExpenseCents(billableCents, builderFeeCents)}
            receivedCents={sumCents((payments ?? []).map((payment) => payment.amount))}
            builderFeeCents={builderFeeCents}
            clientPaidCents={clientPaidCents}
            builderFeePercent={summary?.builder_fee_percent}
            breakdown={false}
          />
        </div>
        <ExpenseAmountSearchBar className="sticky top-[calc(env(safe-area-inset-top)+7.25rem)] z-20 mx-4 mt-3 rounded-xl bg-background/95 p-2 shadow-sm ring-1 ring-foreground/10 backdrop-blur sm:top-[calc(env(safe-area-inset-top)+6rem)] sm:mx-6" />
        <section className="mx-4 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:mx-6 sm:p-4">
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
          columns="brief"
        />
        {(clientPaid ?? []).length > 0 ? (
          <section className="mx-4 mb-6 sm:mx-6">
            <h2 className="font-medium text-violet-950">Expense paid by client</h2>
            <p className="mb-2 text-sm text-muted-foreground">
              Subtracted in the balance. The builder fee still applies to these amounts.
            </p>
            <ul className="grid gap-2">
              {(clientPaid ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-950">
                  <span>{entry.paid_date}</span>
                  <span className="font-medium tabular-nums">{formatMoney(centsToMoney(moneyToCents(entry.amount)))}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        </>
        )}
      </ExpenseSearchProvider>
    </ClientShell>
  )
}
