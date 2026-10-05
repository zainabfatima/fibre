import { AppHeader } from "@/components/app-header"
import { DashboardView } from "@/components/dashboard-view"
import { LiveRefresh } from "@/components/live-refresh"
import { SetupNotice } from "@/components/setup-notice"
import { hasPublicEnv } from "@/lib/env"
import { centsToMoney, moneyToCents } from "@/lib/money"
import { listSummaries } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  if (!hasPublicEnv()) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <SetupNotice />
      </main>
    )
  }

  const summaries = await listSummaries()

  return (
    <>
      <AppHeader />
      <LiveRefresh />
      <DashboardView
        projects={summaries.map((project) => ({
          id: project.project_id,
          name: project.name,
          address: project.address,
          totalSpent: centsToMoney(moneyToCents(project.total_spent)),
        }))}
      />
    </>
  )
}
