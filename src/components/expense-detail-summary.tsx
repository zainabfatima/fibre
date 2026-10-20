import Link from "next/link"

import {
  balanceCents,
  centsToMoney,
  formatFeePercent,
  formatMoney,
  percentOfCents,
  totalExpenseCents,
} from "@/lib/money"

export type DetailAmount = {
  id: string
  date: string | null
  label: string
  amountCents: number
}

export type DetailExpense = DetailAmount & {
  category: string
  categorySort: number
}

export function AudienceTabs({
  expensesHref,
  summaryHref,
  current,
}: {
  expensesHref: string
  summaryHref: string
  current: "expenses" | "summary"
}) {
  const links = [
    { key: "expenses" as const, href: expensesHref, label: "Expenses" },
    { key: "summary" as const, href: summaryHref, label: "Detailed summary" },
  ]
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${
            current === link.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}

export function ExpenseDetailSummary({
  percent,
  expenses,
  clientPaid,
  payments,
  billableCents,
  builderFeeCents,
  clientPaidCents,
  receivedCents,
  excelHref,
}: {
  percent: string | number
  expenses: DetailExpense[]
  clientPaid: DetailAmount[]
  payments: DetailAmount[]
  billableCents: number
  builderFeeCents: number
  clientPaidCents: number
  receivedCents: number
  excelHref: string
}) {
  const percentLabel = formatFeePercent(percent)
  const clientPaidFeeCents = percentOfCents(clientPaidCents, percent)
  const usualFeeCents = builderFeeCents - clientPaidFeeCents
  const totalCents = totalExpenseCents(billableCents, builderFeeCents)
  const leftCents = balanceCents(totalCents, receivedCents, clientPaidCents)
  const byDate = <T extends { date: string | null }>(rows: T[]) =>
    [...rows].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
  const categories = categoryGroups(expenses, percent)
  const categoryFeeSum = categories.reduce((total, category) => total + category.feeCents, 0)
  const clientRows = byDate(clientPaid)
  const paymentRows = byDate(payments)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Detailed expense summary</h2>
          <p className="text-sm text-muted-foreground">Category totals, the builder fee on each category, and the money received.</p>
        </div>
        <a
          href={excelHref}
          className="rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Download Excel
        </a>
      </div>

      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h3 className="font-medium">How the numbers are calculated</h3>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          <li>Total expense = project expenses + builder fee + builder fee on expenses the client paid.</li>
          <li>Builder fee = {percentLabel}% of each category total, rounded to the cent. It is not calculated on each expense.</li>
          <li>Builder fee on paid by client expense = {percentLabel}% of the paid-by-client total.</li>
          <li>Adding the category fees can differ by a few cents from {percentLabel}% of all project expenses together.</li>
          <li>Balance = total expense − money received − expense paid by client.</li>
        </ul>
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <Figure label="Total expense" value={formatMoney(centsToMoney(totalCents))} tone="total" negative={totalCents < 0} />
        <Figure label="Money received" value={formatMoney(centsToMoney(receivedCents))} />
        <Figure
          label="Balance left"
          value={formatMoney(centsToMoney(leftCents))}
          note="Total expense − money received − expense paid by client"
          alert={leftCents > 0}
        />
      </section>

      {categories.length > 0 ? (
        <div className="rounded-xl bg-amber-100 px-4 py-3 text-amber-950">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">Builder fee on all categories ({percentLabel}%)</p>
            <p className="font-semibold tabular-nums">{formatMoney(centsToMoney(usualFeeCents))}</p>
          </div>
          <p className="text-xs opacity-80">Included in the total. This is {percentLabel}% of all project expenses together.</p>
          {usualFeeCents !== categoryFeeSum ? (
            <p className="mt-1 text-xs">
              Adding each category fee comes to {formatMoney(centsToMoney(categoryFeeSum))}. Rounding to the combined total is {formatMoney(centsToMoney(usualFeeCents - categoryFeeSum))}.
            </p>
          ) : null}
        </div>
      ) : null}

      <PlainTable
        title="Expense paid by client"
        empty="No expenses paid by the client yet."
        rows={clientRows}
        amountCents={clientPaidCents}
        amountLabel="Paid by client"
        feeCents={clientPaidFeeCents}
        feeLabel={`Builder fee on paid by client expense (${percentLabel}%)`}
        feeNote="Included in the total. The paid-by-client amount is subtracted in the balance."
        tone="client"
      />

      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h3 className="font-medium">Builder fee for both</h3>
        <dl className="mt-3 grid gap-2">
          <TotalLine label={`Builder fee (${percentLabel}%)`} value={usualFeeCents} note="Included in the total" tone="fee" />
          <TotalLine
            label={`Builder fee on paid by client expense (${percentLabel}%)`}
            value={clientPaidFeeCents}
            note="Included in the total"
            tone="clientFee"
          />
          <TotalLine label="Both builder fees" value={builderFeeCents} note="Added together in the total expense" tone="fee" />
        </dl>
      </section>

      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <header className="border-b border-border px-4 py-3">
          <h3 className="font-medium">Money received</h3>
          <p className="text-sm text-muted-foreground">Every payment, with its date. Subtracted in the balance.</p>
        </header>
        {paymentRows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No money received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="px-4 py-2 whitespace-nowrap">{row.date || "No date"}</td>
                    <td className="px-4 py-2">{row.label || "—"}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(centsToMoney(row.amountCents))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-4 py-2" colSpan={2}>Money received</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(centsToMoney(receivedCents))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="font-medium">Project expenses by category</h3>
        {categories.length === 0 ? (
          <p className="rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">No project expenses yet.</p>
        ) : (
          categories.map((category) => (
            <CategoryBlock key={category.name} category={category} percentLabel={percentLabel} />
          ))
        )}
      </section>
    </div>
  )
}

function categoryGroups(expenses: DetailExpense[], percent: string | number) {
  const groups = new Map<string, { name: string; sort: number; rows: DetailExpense[] }>()
  for (const expense of expenses) {
    const group = groups.get(expense.category) ?? { name: expense.category, sort: expense.categorySort, rows: [] }
    group.rows.push(expense)
    groups.set(expense.category, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((group) => {
      const rows = [...group.rows].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
      const amountCents = rows.reduce((total, row) => total + row.amountCents, 0)
      return { name: group.name, rows, amountCents, feeCents: percentOfCents(amountCents, percent) }
    })
}

function CategoryBlock({
  category,
  percentLabel,
}: {
  category: { name: string; rows: DetailExpense[]; amountCents: number; feeCents: number }
  percentLabel: string
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="border-b border-border px-4 py-3">
        <h3 className="font-medium">{category.name}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {category.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70">
                <td className="px-4 py-2 whitespace-nowrap">{row.date || "No date"}</td>
                <td className="px-4 py-2">{row.label || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(centsToMoney(row.amountCents))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-4 py-2" colSpan={2}>Category total</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoney(centsToMoney(category.amountCents))}</td>
            </tr>
            <tr className="bg-amber-100 text-amber-950">
              <td className="px-4 py-2" colSpan={2}>
                <span className="font-semibold">Builder fee ({percentLabel}%)</span>
                <span className="mt-0.5 block text-xs font-normal">{percentLabel}% of this category total. Included in the total.</span>
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(centsToMoney(category.feeCents))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function PlainTable({
  title,
  empty,
  rows,
  amountCents,
  amountLabel,
  feeCents,
  feeLabel,
  feeNote,
  tone = "plain",
}: {
  title: string
  empty: string
  rows: DetailAmount[]
  amountCents: number
  amountLabel: string
  feeCents: number
  feeLabel: string
  feeNote: string
  tone?: "plain" | "client"
}) {
  return (
    <section className={`overflow-hidden rounded-xl ring-1 ${tone === "client" ? "bg-violet-50 text-violet-950 ring-violet-200" : "bg-card ring-foreground/10"}`}>
      <header className={`border-b px-4 py-3 ${tone === "client" ? "border-violet-200" : "border-border"}`}>
        <h3 className="font-medium">{title}</h3>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className={`border-b text-left text-xs ${tone === "client" ? "border-violet-200" : "border-border text-muted-foreground"}`}>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b ${tone === "client" ? "border-violet-200/80" : "border-border/70"}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{row.date || "No date"}</td>
                  <td className="px-4 py-2">{row.label || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(centsToMoney(row.amountCents))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-4 py-2" colSpan={2}>{amountLabel}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(centsToMoney(amountCents))}</td>
              </tr>
              <tr className="bg-rose-50 text-rose-950">
                <td className="px-4 py-2" colSpan={2}>
                  <span className="font-semibold">{feeLabel}</span>
                  <span className="mt-0.5 block text-xs font-normal">{feeNote}</span>
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(centsToMoney(feeCents))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function Figure({
  label,
  value,
  note,
  tone,
  negative,
  alert,
}: {
  label: string
  value: string
  note?: string
  tone?: "total"
  negative?: boolean
  alert?: boolean
}) {
  const totalTone = negative ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-950"
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className={`text-sm ${tone === "total" ? "font-bold text-emerald-950" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${tone === "total" ? `rounded-lg px-2 py-1 text-2xl font-bold ${totalTone}` : "text-xl"} ${tone !== "total" && (negative || alert) ? "text-red-700" : ""}`}>
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}

function TotalLine({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: number
  note: string
  tone: "fee" | "clientFee"
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 ${tone === "fee" ? "bg-amber-100 text-amber-950" : "border-l-4 border-rose-400 bg-rose-50 text-rose-950"}`}>
      <dt>
        <span className="text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs font-normal opacity-80">{note}</span>
      </dt>
      <dd className="text-sm font-semibold tabular-nums">{formatMoney(centsToMoney(value))}</dd>
    </div>
  )
}
