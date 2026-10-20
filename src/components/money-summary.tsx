import { balanceCents, centsToMoney, formatFeePercent, formatMoney, percentOfCents } from "@/lib/money"

export function MoneySummary({
  spentCents,
  receivedCents,
  builderFeeCents = 0,
  clientPaidCents = 0,
  builderFeePercent,
  breakdown = true,
}: {
  spentCents: number
  receivedCents: number
  builderFeeCents?: number
  clientPaidCents?: number
  builderFeePercent?: string | number | null
  breakdown?: boolean
}) {
  const left = balanceCents(spentCents, receivedCents, clientPaidCents)
  const hasPercent = builderFeePercent != null && builderFeePercent !== ""
  const percentLabel = hasPercent ? formatFeePercent(builderFeePercent) : null
  const feeLabel = percentLabel == null ? "Builder fee" : `Builder fee (${percentLabel}%)`
  const clientPaidFeeCents =
    builderFeePercent == null || builderFeePercent === ""
      ? 0
      : percentOfCents(clientPaidCents, builderFeePercent)
  const usualFeeCents = builderFeeCents - clientPaidFeeCents
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
      <Card
        label="Total expense"
        value={formatMoney(centsToMoney(spentCents))}
        emphasis
        negative={spentCents < 0}
        lines={
          breakdown
            ? [
                {
                  label: feeLabel,
                  hint: "Included in the total",
                  value: formatMoney(centsToMoney(usualFeeCents)),
                  tone: "fee",
                },
                {
                  label: percentLabel == null ? "Builder fee on paid by client expense" : `Builder fee on paid by client expense (${percentLabel}%)`,
                  hint: "Included in the total",
                  value: formatMoney(centsToMoney(clientPaidFeeCents)),
                  tone: "clientFee",
                },
                {
                  label: "Paid by client",
                  hint: "Subtracted in the balance",
                  value: formatMoney(centsToMoney(clientPaidCents)),
                  tone: "client",
                },
              ]
            : undefined
        }
      />
      <Card label="Money received" value={formatMoney(centsToMoney(receivedCents))} />
      <Card
        label="Balance left"
        value={formatMoney(centsToMoney(left))}
        alert={left > 0}
        hint="Total expense − money received − expense paid by client"
      />
    </div>
  )
}

function Card({
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
  const totalTone = negative
    ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-100"
    : "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50"
  return (
    <div className={`rounded-xl bg-card p-4 ring-1 ring-foreground/10 ${emphasis ? "col-span-2 lg:col-span-1" : ""}`}>
      <p className={`text-sm ${emphasis ? "font-bold text-emerald-950 dark:text-emerald-100" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 tabular-nums ${emphasis ? `rounded-lg px-2 py-1 text-3xl font-bold ${totalTone}` : "text-xl font-semibold"} ${!emphasis && (negative || alert) ? "text-red-700 dark:text-red-300" : ""}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {lines?.length ? (
        <dl className="mt-3 grid gap-2">
          {lines.map((line) => (
            <div
              key={line.label}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 ${
                line.tone === "fee"
                  ? "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
                  : line.tone === "clientFee"
                    ? "ml-3 border-l-4 border-rose-400 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100"
                    : "bg-violet-100 text-violet-950 dark:bg-violet-950/50 dark:text-violet-100"
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
