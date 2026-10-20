import { AppHeader } from "@/components/app-header"
import { DashboardView } from "@/components/dashboard-view"
import { LiveRefresh } from "@/components/live-refresh"
import { SetupNotice } from "@/components/setup-notice"
import { hasPublicEnv } from "@/lib/env"
import { balanceCents, centsToMoney, moneyToCents, totalExpenseCents } from "@/lib/money"
import { listClientPaymentAmounts, listSummaries } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  if (!hasPublicEnv()) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <SetupNotice />
      </main>
    )
  }

  const [summaries, payments] = await Promise.all([listSummaries(), listClientPaymentAmounts()])
  const receivedByProject = new Map<string, number>()
  for (const payment of payments) {
    receivedByProject.set(payment.project_id, (receivedByProject.get(payment.project_id) ?? 0) + moneyToCents(payment.amount))
  }

  return (
    <>
      <AppHeader />
      <LiveRefresh />
      <DashboardView
        projects={summaries.map((project) => {
          const billableCents = moneyToCents(project.total_spent)
          const builderFeeCents = moneyToCents(project.builder_fee_amount)
          const clientPaidCents = moneyToCents(project.client_paid_total)
          const spentCents = totalExpenseCents(billableCents, builderFeeCents)
          const leftCents = balanceCents(spentCents, receivedByProject.get(project.project_id) ?? 0, clientPaidCents)
          return {
            id: project.project_id,
            name: project.name,
            address: project.address,
            totalSpent: centsToMoney(spentCents),
            balance: centsToMoney(leftCents),
            balanceOwed: leftCents > 0,
          }
        })}
      />
    </>
  )
}
