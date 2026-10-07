import { centsToMoney, formatMoney } from "@/lib/money"

export function MoneySummary({
  spentCents,
  receivedCents,
}: {
  spentCents: number
  receivedCents: number
}) {
  const left = spentCents - receivedCents
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
      <Card label="Total expense" value={formatMoney(centsToMoney(spentCents))} emphasis negative={spentCents < 0} />
      <Card label="Money received" value={formatMoney(centsToMoney(receivedCents))} />
      <Card label="Balance left" value={formatMoney(centsToMoney(left))} alert={left > 0} />
    </div>
  )
}

function Card({
  label,
  value,
  alert,
  emphasis,
  negative,
}: {
  label: string
  value: string
  alert?: boolean
  emphasis?: boolean
  negative?: boolean
}) {
  return (
    <div className={`rounded-xl bg-card p-4 ring-1 ring-foreground/10 ${emphasis ? "col-span-2 lg:col-span-1" : ""}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${emphasis ? "text-3xl" : "text-xl"} ${negative || alert ? "text-red-700 dark:text-red-300" : ""}`}>
        {value}
      </p>
    </div>
  )
}
