import { notFound, redirect } from "next/navigation"

import { getStaffUser } from "@/lib/app-session"
import { BrandLogo } from "@/components/brand-logo"
import { CategoryBudgetHeading } from "@/components/category-budget-heading"
import { CategoryChart } from "@/components/category-chart"
import { AudienceTabs, ExpenseDetailSummary } from "@/components/expense-detail-summary"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatCategory } from "@/lib/format"
import { balanceCents, centsToMoney, formatMoney, moneyToCents, percentOfCents, returnAmountClass, sumCents, totalExpenseCents, amountOverBudget } from "@/lib/money"

export const dynamic = "force-dynamic"

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ view?: string }>
}) {
  if (await getStaffUser()) redirect("/staff")
  const { token } = await params
  const { view } = await searchParams
  const detailed = view === "summary"
  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("share_token", token)
    .maybeSingle()
  if (!project) notFound()

  const [{ data: expenses }, { data: totals }, { data: payments }, { data: clientPaid }] = await Promise.all([
    admin.from("v_expense_rows").select("*").eq("project_id", project.id).order("expense_date"),
    admin.from("v_project_category_totals").select("*").eq("project_id", project.id).order("code"),
    admin.from("client_payments").select("id, received_date, amount, note").eq("project_id", project.id).order("received_date"),
    admin.from("client_paid_expenses").select("id, paid_date, amount, note").eq("project_id", project.id).order("paid_date", { ascending: false }),
  ])

  const rows = (expenses ?? []).filter((row) => row.verification_status === "verified")
  const paths = rows
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const signed = paths.length
    ? await admin.storage.from("receipts").createSignedUrls(paths, 1800)
    : { data: [] }
  const thumbs = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))

  const billableCents = sumCents(rows.map((row) => row.amount))
  const clientPaidCents = sumCents((clientPaid ?? []).map((entry) => entry.amount))
  const builderFeeCents = percentOfCents(billableCents + clientPaidCents, project.builder_fee_percent)
  const totalCents = totalExpenseCents(billableCents, builderFeeCents)
  const receivedCents = sumCents((payments ?? []).map((payment) => payment.amount))
  const leftCents = balanceCents(totalCents, receivedCents, clientPaidCents)
  const chart = (totals ?? []).map((row) => ({
    label: formatCategory(row.code, row.name),
    name: formatCategory(row.code, row.name),
    cents: moneyToCents(row.total_spent),
  }))
  const grouped = new Map<number | null, typeof rows>()
  for (const row of rows) {
    const key = row.category_id
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }
  const sections = (totals ?? []).map((category) => ({
    id: category.category_id,
    title: formatCategory(category.code, category.name),
    budget: category.budget ?? 0,
    rows: grouped.get(category.category_id) ?? [],
  }))
  const uncategorized = grouped.get(null) ?? []

  return (
    <div className="min-h-full">
      <header className="border-b-4 border-primary bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2 sm:gap-4 sm:px-4">
          <BrandLogo />
          <p className="min-w-0 text-[15px] font-semibold leading-tight break-words sm:text-lg">
            Client Portal
          </p>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
      <header>
        <h1 className="text-2xl font-semibold break-words">{project.name}</h1>
        {project.address ? <p className="text-sm text-muted-foreground break-words">{project.address}</p> : null}
      </header>
      <AudienceTabs
        expensesHref={`/share/${token}`}
        summaryHref={`/share/${token}?view=summary`}
        current={detailed ? "summary" : "expenses"}
      />

      {detailed ? (
        <ExpenseDetailSummary
          percent={project.builder_fee_percent}
          expenseColumns="full"
          expenses={rows.map((row) => ({
            id: row.id,
            date: row.expense_date,
            label: row.vendor?.trim() || "Receipt",
            vendor: row.vendor,
            description: row.description,
            category: row.category_code != null && row.category_name ? formatCategory(row.category_code, row.category_name) : "Uncategorized",
            categorySort: row.category_code ?? 9999,
            amountCents: moneyToCents(row.amount),
            receiptHref: row.receipt_file_path ? `/r/${row.id}?t=${token}` : null,
            thumbUrl: row.receipt_thumbnail_path ? (thumbs.get(row.receipt_thumbnail_path) ?? null) : null,
            invoiceNumber: row.invoice_number,
            invoiceStatus: row.invoice_id ? row.billing_status : "not_invoiced",
            invoiceHref: row.invoice_id && row.invoice_file_path ? `/i/${row.invoice_id}?t=${token}` : null,
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
          receivedCents={receivedCents}
          excelHref={`/api/export/${project.id}?kind=summary&t=${token}`}
        />
      ) : (
      <>
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        <SummaryCard
          label="Total expense"
          value={formatMoney(centsToMoney(totalCents))}
          emphasis
          negative={totalCents < 0}
        />
        <SummaryCard label="Funds Received" value={formatMoney(centsToMoney(receivedCents))} />
        <SummaryCard
          label="Remaining Balance"
          value={formatMoney(centsToMoney(leftCents))}
          alert={leftCents > 0}
          hint="Total expense − Funds Received − expense paid by client"
        />
      </section>

      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-4 font-medium">Expense by category</h2>
        <CategoryChart rows={chart} />
      </section>

      <div className="flex flex-col gap-1 md:gap-4">
        {sections.map((section) => (
          <CategorySection
            key={section.id}
            title={section.title}
            budget={section.budget}
            rows={section.rows}
          />
        ))}
        {uncategorized.length > 0 ? (
          <CategorySection
            title="Uncategorized"
            rows={uncategorized}
          />
        ) : null}
        {(clientPaid ?? []).length > 0 ? (
          <section className="rounded-xl bg-violet-50 p-4 text-violet-950 ring-1 ring-violet-200">
            <h2 className="font-medium">Expense paid by client</h2>
            <p className="mb-2 text-sm">Subtracted in the balance. The builder fee still applies to these amounts.</p>
            <ul className="grid gap-2">
              {(clientPaid ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 text-sm">
                  <span>{entry.paid_date}</span>
                  <span className="font-medium tabular-nums">{formatMoney(centsToMoney(moneyToCents(entry.amount)))}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      </>
      )}
      </main>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  alert,
  emphasis,
  negative,
  hint,
  lines,
}: {
  label: string
  value: string
  alert?: boolean
  emphasis?: boolean
  negative?: boolean
  hint?: string
  lines?: { label: string; hint: string; value: string; tone: "fee" | "client" | "clientFee" }[]
}) {
  const totalTone = negative ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-950"
  return (
    <div className={`rounded-xl border-t-4 border-t-primary bg-card p-4 ring-1 ring-foreground/10 ${emphasis ? "col-span-2 lg:col-span-1" : ""}`}>
      <p className={`text-sm ${emphasis ? "font-bold text-emerald-950" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 tabular-nums ${emphasis ? `rounded-lg px-2 py-1 text-3xl font-bold ${totalTone}` : "text-xl font-semibold"} ${!emphasis && (negative || alert) ? "text-red-700" : ""}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {lines?.length ? (
        <dl className="mt-3 grid gap-2">
          {lines.map((line) => (
            <div
              key={line.label}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 ${
                line.tone === "fee"
                  ? "bg-amber-100 text-amber-950"
                  : line.tone === "clientFee"
                    ? "ml-3 border-l-4 border-rose-400 bg-rose-50 text-rose-950"
                    : "bg-violet-100 text-violet-950"
              }`}
            >
              <dt>
                <span className="text-sm font-medium">{line.label}</span>
                <span className="mt-0.5 block text-xs font-normal opacity-80">{line.hint}</span>
              </dt>
              <dd className="text-sm font-semibold tabular-nums">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

function CategorySection({
  title,
  budget,
  rows,
}: {
  title: string
  budget?: string | number | null
  rows: Array<{
    id: string
    expense_date: string | null
    description: string | null
    amount: number
  }>
}) {
  const spentCents = sumCents(rows.map((row) => row.amount))
  const total = formatMoney(centsToMoney(spentCents))
  const budgetText = budget == null ? null : formatMoney(budget)
  const overCents = amountOverBudget(budget, spentCents)
  const overBy = overCents == null ? null : formatMoney(centsToMoney(overCents))
  const overClass = overBy ? "border-l-red-600 bg-red-50 ring-red-300" : "border-l-primary bg-card ring-foreground/10"
  if (rows.length === 0) {
    return (
      <>
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-1 py-2.5 md:hidden">
          <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} compact heading="h2" />
        </div>
        <section className={`hidden overflow-hidden rounded-xl border-l-4 ring-1 md:block ${overClass}`}>
          <header className={`flex items-start justify-between gap-3 border-b px-3 py-2 ${overBy ? "border-red-200 bg-red-100" : "border-border bg-muted"}`}>
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} heading="h2" />
          </header>
          <p className="px-3 py-3 text-sm text-muted-foreground">No expenses</p>
        </section>
      </>
    )
  }
  return (
    <section className={`mt-2 overflow-hidden rounded-xl border-l-4 ring-1 md:mt-0 ${overClass}`}>
      <header className={`flex items-start justify-between gap-3 border-b px-3 py-3 ${overBy ? "border-red-200 bg-red-100" : "border-border bg-muted"}`}>
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} heading="h2" />
      </header>
        <>
        <div className="grid md:hidden">
          <div className="grid grid-cols-[5.75rem_minmax(0,1fr)_auto] gap-x-3 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Date</span>
            <span>Description</span>
            <span className="text-right">Amount</span>
          </div>
          {rows.map((row) => (
            <article key={row.id} className="grid grid-cols-[5.75rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border/70 p-3 text-sm">
              <p>{row.expense_date || "No date"}</p>
              <p className="leading-snug break-words">{row.description || "—"}</p>
              <p className={`text-right text-base font-semibold tabular-nums ${returnAmountClass(row.amount)}`}>{centsToMoney(moneyToCents(row.amount))}</p>
            </article>
          ))}
          <p className={`px-3 py-3 text-sm font-semibold tabular-nums ${overBy ? "bg-red-100 text-red-800" : "bg-muted/60"}`}>
            {budgetText ? `Budget ${budgetText} · ` : null}
            <span className={returnAmountClass(centsToMoney(spentCents))}>Spent {total}</span>
            {overBy ? <span className="mt-1 block font-medium text-red-700">Over budget by {overBy}</span> : null}
          </p>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/70">
                  <td className="px-3 py-2 whitespace-nowrap">{row.expense_date || "—"}</td>
                  <td className="px-3 py-2 break-words">{row.description || "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${returnAmountClass(row.amount)}`}>{centsToMoney(moneyToCents(row.amount))}</td>
                </tr>
              ))}
              <tr className={`font-medium ${overBy ? "bg-red-100 text-red-800" : "bg-muted/60"}`}>
                <td className="px-3 py-2" colSpan={2}>
                  Spent
                  {overBy ? <span className="mt-1 block font-medium text-red-700">Over budget by {overBy}</span> : null}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${returnAmountClass(centsToMoney(spentCents))}`}>{total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
    </section>
  )
}
