import Link from "next/link"

import { formatMoney } from "@/lib/money"

export type DashboardProject = {
  id: string
  name: string
  address: string | null
  totalSpent: string
  moneyReceived: string
  balance: string
  balanceOwed: boolean
}

export function DashboardView({ projects }: { projects: DashboardProject[] }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
        >
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No projects yet. Create the first job to start uploading receipts.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-xl border-l-4 border-l-primary bg-card p-4 ring-1 ring-foreground/15 hover:ring-primary/40"
            >
              <h2 className="font-medium break-words">{project.name}</h2>
              <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
              <dl className="mt-4 grid gap-2 border-t border-border pt-3">
                <Amount label="Total expense" value={formatMoney(project.totalSpent)} />
                <Amount label="Money received" value={formatMoney(project.moneyReceived)} />
                <Amount label="Balance left" value={formatMoney(project.balance)} alert={project.balanceOwed} />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Amount({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${alert ? "text-red-700" : ""}`}>{value}</dd>
    </div>
  )
}
