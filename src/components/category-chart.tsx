"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { centsToMoney, formatMoney } from "@/lib/money"

export function CategoryChart({
  rows,
}: {
  rows: Array<{ label: string; name: string; cents: number }>
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories yet.</p>
  }

  const max = Math.max(...rows.map((row) => row.cents), 1)
  return (
    <>
      <ul className="grid gap-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={`min-w-0 break-words ${row.cents > 0 ? "font-medium" : "text-muted-foreground"}`}>
                {row.name}
              </span>
              <span className={`shrink-0 tabular-nums ${row.cents > 0 ? "font-semibold" : "text-muted-foreground"}`}>
                {formatMoney(centsToMoney(row.cents))}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(row.cents > 0 ? 6 : 0, (row.cents / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden max-h-[70vh] overflow-auto md:block">
      <div className="min-w-[640px]" style={{ height: Math.max(420, rows.length * 36) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(value: number) => formatMoney(centsToMoney(value))}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={220}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value) => formatMoney(centsToMoney(Number(value)))}
            labelFormatter={(_label, payload) =>
              (payload?.[0]?.payload as { name?: string } | undefined)?.name ?? ""
            }
          />
          <Bar dataKey="cents" fill="var(--primary)" radius={4} />
        </BarChart>
      </ResponsiveContainer>
      </div>
      </div>
    </>
  )
}
