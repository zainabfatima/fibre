import { CategoryBudgetHeading } from "@/components/category-budget-heading"
import { MoneySummary } from "@/components/money-summary"
import { StatusBadge } from "@/components/status-badge"
import { centsToMoney, formatMoney, sumCents } from "@/lib/money"

export type ClientExpenseItem = {
  id: string
  date: string | null
  vendor: string | null
  amount: string | number
  categoryId: number | null
  thumbUrl: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  hasInvoiceFile: boolean
  billingStatus: string
  pageCount: number
}

export type ClientCategorySection = {
  id: number
  title: string
  budget: string | number | null
  rows: ClientExpenseItem[]
}

export function ClientExpenses({
  name,
  address,
  spentCents,
  receivedCents,
  sections,
  uncategorized,
  invoiceTracking,
}: {
  name: string
  address: string | null
  spentCents: number
  receivedCents: number
  sections: ClientCategorySection[]
  uncategorized: ClientExpenseItem[]
  invoiceTracking: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold break-words">{name}</h1>
        {address ? <p className="text-sm break-words text-muted-foreground">{address}</p> : null}
      </header>
      <MoneySummary spentCents={spentCents} receivedCents={receivedCents} />
      <div className="flex flex-col gap-1">
        {sections.map((section) => (
          <CategoryBlock
            key={section.id}
            title={section.title}
            budget={section.budget}
            rows={section.rows}
            invoiceTracking={invoiceTracking}
          />
        ))}
        {uncategorized.length > 0 ? (
          <CategoryBlock
            title="Uncategorized"
            budget={null}
            rows={uncategorized}
            invoiceTracking={invoiceTracking}
          />
        ) : null}
      </div>
    </div>
  )
}

function CategoryBlock({
  title,
  budget,
  rows,
  invoiceTracking,
}: {
  title: string
  budget: string | number | null
  rows: ClientExpenseItem[]
  invoiceTracking: boolean
}) {
  const total = formatMoney(centsToMoney(sumCents(rows.map((row) => row.amount))))
  const budgetText = budget == null ? null : formatMoney(budget)
  if (rows.length === 0) {
    return (
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-1 py-2.5">
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} compact heading="h2" />
      </div>
    )
  }
  return (
    <section className="mt-2 overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10">
      <header className="flex items-start justify-between gap-3 border-b border-border bg-muted px-3 py-3">
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} heading="h2" />
      </header>
      <div>
        {rows.map((row) => (
          <article key={row.id} className="border-b border-border/70 p-3 text-sm">
            <div className="flex items-start gap-3">
              <a
                href={`/r/${row.id}`}
                target="_blank"
                rel="noreferrer"
                className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted"
              >
                {row.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-1 text-center text-[10px]">Receipt</span>
                )}
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium leading-snug break-words">{row.vendor || "Receipt"}</p>
                  <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(row.amount)}</p>
                </div>
                <p className="mt-0.5 text-muted-foreground">{row.date || "No date"}</p>
                {invoiceTracking ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span>{row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : "No invoice"}</span>
                    <StatusBadge
                      kind="invoice"
                      status={row.invoiceId ? row.billingStatus : "not_invoiced"}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className={`mt-3 grid gap-2 ${invoiceTracking ? "grid-cols-2" : "grid-cols-1"}`}>
              <a
                href={`/r/${row.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 font-medium"
              >
                View receipt{row.pageCount > 1 ? ` (${row.pageCount} pages)` : ""}
              </a>
              {invoiceTracking && row.invoiceId && row.hasInvoiceFile ? (
                <a
                  href={`/i/${row.invoiceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 font-medium"
                >
                  View invoice
                </a>
              ) : invoiceTracking ? (
                <span className="inline-flex min-h-11 items-center justify-center rounded-lg bg-muted px-3 text-center text-muted-foreground">
                  No invoice file
                </span>
              ) : null}
            </div>
          </article>
        ))}
        <p className="bg-muted/60 px-3 py-3 text-sm font-semibold tabular-nums">
          {budgetText ? `Budget ${budgetText} · Spent ${total}` : `Spent ${total}`}
        </p>
      </div>
    </section>
  )
}
