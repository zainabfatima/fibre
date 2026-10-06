import { notFound } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
import { CategoryBudgetHeading } from "@/components/category-budget-heading"
import { CategoryChart } from "@/components/category-chart"
import { StatusBadge } from "@/components/status-badge"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, moneyToCents, sumCents } from "@/lib/money"

export const dynamic = "force-dynamic"

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("share_token", token)
    .maybeSingle()
  if (!project) notFound()

  const [{ data: expenses }, { data: totals }, { data: payments }] = await Promise.all([
    admin.from("v_expense_rows").select("*").eq("project_id", project.id).order("expense_date"),
    admin.from("v_project_category_totals").select("*").eq("project_id", project.id).order("code"),
    admin.from("client_payments").select("amount").eq("project_id", project.id),
  ])

  const rows = (expenses ?? []).filter((row) => row.verification_status === "verified")
  const paths = rows
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const signed = paths.length
    ? await admin.storage.from("receipts").createSignedUrls(paths, 1800)
    : { data: [] }
  const thumbs = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))

  const totalCents = sumCents(rows.map((row) => row.amount))
  const receivedCents = sumCents((payments ?? []).map((payment) => payment.amount))
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
            Projects Expense Tracker
          </p>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
      <header>
        <h1 className="text-2xl font-semibold break-words">{project.name}</h1>
        {project.address ? <p className="text-sm text-muted-foreground break-words">{project.address}</p> : null}
      </header>

      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        <SummaryCard label="Total expense" value={formatMoney(centsToMoney(totalCents))} emphasis />
        <SummaryCard label="Money received" value={formatMoney(centsToMoney(receivedCents))} />
        <SummaryCard
          label="Balance left"
          value={formatMoney(centsToMoney(totalCents - receivedCents))}
          alert={totalCents - receivedCents > 0}
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
            token={token}
            thumbs={thumbs}
            invoiceTracking={project.invoice_tracking}
          />
        ))}
        {uncategorized.length > 0 ? (
          <CategorySection
            title="Uncategorized"
            rows={uncategorized}
            token={token}
            thumbs={thumbs}
            invoiceTracking={project.invoice_tracking}
          />
        ) : null}
      </div>
      </main>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  alert,
  emphasis,
}: {
  label: string
  value: string
  alert?: boolean
  emphasis?: boolean
}) {
  return (
    <div className={`rounded-xl border-t-4 border-t-primary bg-card p-4 ring-1 ring-foreground/10 ${emphasis ? "col-span-2 lg:col-span-1" : ""}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${emphasis ? "text-3xl" : "text-xl"} ${alert ? "text-red-700" : ""}`}>{value}</p>
    </div>
  )
}

function CategorySection({
  title,
  budget,
  rows,
  token,
  thumbs,
  invoiceTracking,
}: {
  title: string
  budget?: string | number | null
  rows: Array<{
    id: string
    expense_date: string | null
    vendor: string | null
    amount: number
    category_id: number | null
    receipt_thumbnail_path: string | null
    invoice_id: string | null
    invoice_number: string | null
    invoice_file_path: string | null
    billing_status: string
    invoice_status: string | null
  }>
  token: string
  thumbs: Map<string | null, string | null>
  invoiceTracking: boolean
}) {
  const total = formatMoney(centsToMoney(sumCents(rows.map((row) => row.amount))))
  const budgetText = budget == null ? null : formatMoney(budget)
  if (rows.length === 0) {
    return (
      <>
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-1 py-2.5 md:hidden">
          <CategoryBudgetHeading title={title} budget={budgetText} spent={total} compact heading="h2" />
        </div>
        <section className="hidden overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:block">
          <header className="flex items-start justify-between gap-3 border-b border-border bg-muted px-3 py-2">
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} heading="h2" />
          </header>
          <p className="px-3 py-3 text-sm text-muted-foreground">No expenses</p>
        </section>
      </>
    )
  }
  return (
    <section className="mt-2 overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:mt-0">
      <header className="flex items-start justify-between gap-3 border-b border-border bg-muted px-3 py-3">
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} heading="h2" />
      </header>
        <>
        <div className="grid md:hidden">
          {rows.map((row) => {
            const thumb = row.receipt_thumbnail_path ? thumbs.get(row.receipt_thumbnail_path) : null
            return (
              <article key={row.id} className="border-b border-border/70 p-3 text-sm">
                <div className="flex items-start gap-3">
                  <a href={`/r/${row.id}?t=${token}`} target="_blank" rel="noreferrer" className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="px-1 text-center text-[10px]">Receipt</span>
                    )}
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug break-words">{row.vendor || "Receipt"}</p>
                      <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(row.amount)}</p>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{row.expense_date || "No date"}</p>
                    {invoiceTracking ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span>{row.invoice_number ? `Invoice ${row.invoice_number}` : "No invoice"}</span>
                        <StatusBadge kind="invoice" status={row.invoice_id ? row.billing_status : "not_invoiced"} />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className={`mt-3 grid gap-2 ${invoiceTracking ? "grid-cols-2" : "grid-cols-1"}`}>
                  <a href={`/r/${row.id}?t=${token}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 font-medium">
                    View receipt
                  </a>
                  {invoiceTracking && row.invoice_id && row.invoice_file_path ? (
                    <a href={`/i/${row.invoice_id}?t=${token}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 font-medium">
                      View invoice
                    </a>
                  ) : invoiceTracking ? (
                    <span className="inline-flex min-h-11 items-center justify-center rounded-lg bg-muted px-3 text-center text-muted-foreground">
                      No invoice file
                    </span>
                  ) : null}
                </div>
              </article>
            )
          })}
          <p className="bg-muted/60 px-3 py-3 text-sm font-semibold tabular-nums">
            {budgetText ? `Budget ${budgetText} · Spent ${total}` : `Spent ${total}`}
          </p>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
                {invoiceTracking ? (
                  <>
                    <th className="px-3 py-2 font-medium">Invoice #</th>
                    <th className="px-3 py-2 font-medium">Invoice status</th>
                    <th className="px-3 py-2 font-medium">Invoice view</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const thumb = row.receipt_thumbnail_path ? thumbs.get(row.receipt_thumbnail_path) : null
                return (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="px-3 py-2 whitespace-nowrap">{row.expense_date || "—"}</td>
                    <td className="max-w-40 truncate px-3 py-2">{row.vendor || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2">
                      <a
                        href={`/r/${row.id}?t=${token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 underline"
                      >
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-12 w-12 rounded border border-border object-cover" />
                        ) : null}
                        View
                      </a>
                    </td>
                    {invoiceTracking ? (
                      <>
                        <td className="px-3 py-2">{row.invoice_number || "—"}</td>
                        <td className="px-3 py-2">
                          {row.invoice_id ? (
                            <StatusBadge kind="invoice" status={row.billing_status} />
                          ) : (
                            <StatusBadge kind="invoice" status="not_invoiced" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.invoice_id && row.invoice_file_path ? (
                            <a href={`/i/${row.invoice_id}?t=${token}`} target="_blank" rel="noreferrer" className="underline">
                              View
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </>
                    ) : null}
                  </tr>
                )
              })}
              <tr className="bg-muted/60 font-medium">
                <td className="px-3 py-2" colSpan={2}>
                  Spent
                </td>
                <td className="px-3 py-2 tabular-nums">{total}</td>
                <td colSpan={invoiceTracking ? 4 : 1} />
              </tr>
            </tbody>
          </table>
        </div>
        </>
    </section>
  )
}
