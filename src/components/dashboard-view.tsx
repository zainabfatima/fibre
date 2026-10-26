"use client"

import Link from "next/link"

import { useZainab } from "@/components/view-mode"
import { formatMoney, isNegativeAmount } from "@/lib/money"
import { withZainab } from "@/lib/zainab-path"

export type DashboardProject = {
  id: string
  name: string
  address: string | null
  totalSpent: string
  balance: string
  balanceOwed: boolean
}

export function DashboardView({ projects }: { projects: DashboardProject[] }) {
  const zainab = useZainab()
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link
          href={withZainab("/projects/new", zainab)}
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
              href={withZainab(`/projects/${project.id}`, zainab)}
              className="rounded-xl border-l-4 border-l-primary bg-card p-4 ring-1 ring-foreground/15 hover:ring-primary/40"
            >
              <h2 className="text-lg font-bold break-words text-primary">{project.name}</h2>
              <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
              <dl className="mt-4 grid gap-2 border-t border-border pt-3">
                <Amount
                  label="Total expense"
                  value={formatMoney(project.totalSpent)}
                  negative={isNegativeAmount(project.totalSpent)}
                  tone="total"
                />
                <Amount label="Remaining Balance" value={formatMoney(project.balance)} alert={project.balanceOwed} />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Amount({
  label,
  value,
  negative,
  alert,
  tone,
}: {
  label: string
  value: string
  negative?: boolean
  alert?: boolean
  tone?: "total"
}) {
  const toneClass =
    tone === "total"
      ? negative
        ? "rounded-md bg-red-100 px-2 py-1 text-red-800 dark:bg-red-950/50 dark:text-red-100"
        : "rounded-md bg-emerald-100 px-2 py-1 font-bold text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50"
      : ""
  return (
    <div className={`flex items-baseline justify-between gap-3 ${toneClass}`}>
      <dt className={tone ? "text-sm" : "text-sm text-muted-foreground"}>{label}</dt>
      <dd className={`tabular-nums ${tone === "total" ? "text-base font-bold" : "text-base font-semibold"} ${!tone && (negative || alert) ? "text-red-700 dark:text-red-300" : ""}`}>{value}</dd>
    </div>
  )
}
