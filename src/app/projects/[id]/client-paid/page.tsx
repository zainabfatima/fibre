import { ClientPaidForm, ClientPaidList } from "@/components/client-paid-form"
import { MoneySummary } from "@/components/money-summary"
import { centsToMoney, moneyToCents, sumCents, totalExpenseCents } from "@/lib/money"
import { getProject, getSummary, listClientPaidExpenses, listClientPayments } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function ClientPaidPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) return null

  const [entries, payments, summary] = await Promise.all([
    listClientPaidExpenses(id),
    listClientPayments(id),
    getSummary(id),
  ])
  const billableCents = moneyToCents(summary?.total_spent ?? 0)
  const builderFeeCents = moneyToCents(summary?.builder_fee_amount ?? 0)
  const clientPaidCents = moneyToCents(summary?.client_paid_total ?? 0)
  const spentCents = totalExpenseCents(billableCents, builderFeeCents)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))

  return (
    <div className="grid gap-4 px-4 py-4">
      <div>
        <h2 className="text-lg font-medium">Expense paid by client</h2>
        <p className="text-sm text-muted-foreground">
          Add each amount the client paid directly, the same way you enter Funds Received. The builder fee is
          calculated on these amounts. The amounts are subtracted in the balance.
        </p>
      </div>
      <MoneySummary
        spentCents={spentCents}
        receivedCents={receivedCents}
        builderFeeCents={builderFeeCents}
        clientPaidCents={clientPaidCents}
        builderFeePercent={project.builder_fee_percent}
      />
      <ClientPaidForm projectId={id} />
      <ClientPaidList
        projectId={id}
        entries={entries.map((entry) => ({
          id: entry.id,
          paid_date: entry.paid_date,
          amount: centsToMoney(moneyToCents(entry.amount)),
          note: entry.note,
        }))}
      />
    </div>
  )
}
