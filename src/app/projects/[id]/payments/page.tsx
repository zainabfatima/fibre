import { MoneySummary } from "@/components/money-summary"
import { PaymentForm, PaymentList } from "@/components/payment-form"
import { centsToMoney, moneyToCents, sumCents } from "@/lib/money"
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
  const spentCents = moneyToCents(summary?.total_spent ?? 0)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))

  return (
    <div className="grid gap-4 px-4 py-4">
      <div>
        <h2 className="text-lg font-medium">Money received from client</h2>
        <p className="text-sm text-muted-foreground">
          Add each payment with its date. Balance left is total expense minus these amounts.
        </p>
      </div>
      <MoneySummary spentCents={spentCents} receivedCents={receivedCents} />
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
