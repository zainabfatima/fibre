import { notFound } from "next/navigation"

import { BrandLogo } from "@/components/brand-logo"
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

  const rows = expenses ?? []
  const paths = rows
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const signed = paths.length
    ? await admin.storage.from("receipts").createSignedUrls(paths, 1800)
    : { data: [] }
  const thumbs = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))

  const totalCents = sumCents(rows.map((row) => row.amount))
  const paidCents = sumCents(rows.filter((row) => row.billing_status === "paid").map((row) => row.amount))
  const partialCents = sumCents(
    rows.filter((row) => row.billing_status === "partial").map((row) => row.amount),
  )
  const pendingCents = totalCents - paidCents - partialCents
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
    rows: grouped.get(category.category_id) ?? [],
  }))
  const uncategorized = grouped.get(null) ?? []

  return (
    <div className="min-h-full">
      <header className="border-b-4 border-primary bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center px-3 py-2 sm:px-4">
          <BrandLogo />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
      <header>
        <h1 className="text-2xl font-semibold break-words">{project.name}</h1>
        {project.address ? <p className="text-sm text-muted-foreground break-words">{project.address}</p> : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label="Total expense" value={formatMoney(centsToMoney(totalCents))} />
        <SummaryCard label="Paid" value={formatMoney(centsToMoney(paidCents))} />
        <SummaryCard label="Pending" value={formatMoney(centsToMoney(pendingCents))} alert={pendingCents > 0} />
        <SummaryCard label="Partial" value={formatMoney(centsToMoney(partialCents))} />
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

      <div className="grid gap-4">
        {sections.map((section) => (
          <CategorySection
            key={section.id}
            title={section.title}
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

function SummaryCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border-t-4 border-t-primary bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${alert ? "text-red-700" : ""}`}>{value}</p>
    </div>
  )
}

function CategorySection({
  title,
  rows,
  token,
  thumbs,
  invoiceTracking,
}: {
  title: string
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
  return (
    <section className="overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-3 py-2">
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm tabular-nums">{total}</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">No expenses</p>
      ) : (
        <div className="overflow-x-auto">
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
                  Total
                </td>
                <td className="px-3 py-2 tabular-nums">{total}</td>
                <td colSpan={invoiceTracking ? 4 : 1} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
