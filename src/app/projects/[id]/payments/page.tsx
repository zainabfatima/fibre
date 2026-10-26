import { MoneySummary } from "@/components/money-summary"
import { PaymentForm, PaymentList } from "@/components/payment-form"
import { centsToMoney, moneyToCents, sumCents, totalExpenseCents } from "@/lib/money"
import { getProject, getSummary, listClientPayments } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) return null

  const [payments, summary] = await Promise.all([listClientPayments(id), getSummary(id)])
  const billableCents = moneyToCents(summary?.total_spent ?? 0)
  const builderFeeCents = moneyToCents(summary?.builder_fee_amount ?? 0)
  const clientPaidCents = moneyToCents(summary?.client_paid_total ?? 0)
  const spentCents = totalExpenseCents(billableCents, builderFeeCents)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))

  return (
    <div className="grid gap-4 px-4 py-4">
      <div>
        <h2 className="text-lg font-medium">Funds Received from client</h2>
        <p className="text-sm text-muted-foreground">
          Add each payment with its date. Remaining Balance is total expense minus Funds Received minus expenses the client paid. The total includes both builder fees.
        </p>
      </div>
      <MoneySummary
        spentCents={spentCents}
        receivedCents={receivedCents}
        builderFeeCents={builderFeeCents}
        clientPaidCents={clientPaidCents}
        builderFeePercent={project.builder_fee_percent}
      />
      <PaymentForm projectId={id} />
      <PaymentList
        projectId={id}
        payments={payments.map((payment) => ({
          id: payment.id,
          received_date: payment.received_date,
          amount: centsToMoney(moneyToCents(payment.amount)),
          note: payment.note,
        }))}
      />
    </div>
  )
}
