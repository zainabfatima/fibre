import { AppHeader } from "@/components/app-header"
import { DashboardView } from "@/components/dashboard-view"
import { LiveRefresh } from "@/components/live-refresh"
import { SetupNotice } from "@/components/setup-notice"
import { hasPublicEnv } from "@/lib/env"
import { centsToMoney, moneyToCents } from "@/lib/money"
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
    const projectId = payment.project_id
    receivedByProject.set(projectId, (receivedByProject.get(projectId) ?? 0) + moneyToCents(payment.amount))
  }

  return (
    <>
      <AppHeader />
      <LiveRefresh />
      <DashboardView
        projects={summaries.map((project) => {
          const spentCents = moneyToCents(project.total_spent)
          const receivedCents = receivedByProject.get(project.project_id) ?? 0
          return {
            id: project.project_id,
            name: project.name,
            address: project.address,
            totalSpent: centsToMoney(spentCents),
            moneyReceived: centsToMoney(receivedCents),
            balance: centsToMoney(spentCents - receivedCents),
            balanceOwed: spentCents > receivedCents,
          }
        })}
      />
    </>
  )
}
