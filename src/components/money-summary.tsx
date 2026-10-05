import { centsToMoney, formatMoney } from "@/lib/money"

export function MoneySummary({
  spentCents,
  receivedCents,
  invoicedCents,
  pendingCents,
  notInvoicedCents,
  invoiceTracking,
}: {
  spentCents: number
  receivedCents: number
  invoicedCents: number
  pendingCents: number
  notInvoicedCents: number
  invoiceTracking: boolean
}) {
  const left = spentCents - receivedCents
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card label="Total expense" value={formatMoney(centsToMoney(spentCents))} />
      <Card label="Money received" value={formatMoney(centsToMoney(receivedCents))} />
      <Card label="Balance left" value={formatMoney(centsToMoney(left))} alert={left > 0} />
      {invoiceTracking ? (
        <>
          <Card label="Invoiced" value={formatMoney(centsToMoney(invoicedCents))} />
          <Card label="Pending invoices" value={formatMoney(centsToMoney(pendingCents))} />
          <Card
            label="Not yet invoiced"
            value={formatMoney(centsToMoney(notInvoicedCents))}
            alert={notInvoicedCents > 0}
          />
        </>
      ) : null}
    </div>
  )
}

function Card({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${alert ? "text-red-700" : ""}`}>
        {value}
      </p>
    </div>
  )
}
