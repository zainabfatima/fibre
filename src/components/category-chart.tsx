"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { centsToMoney, formatMoney } from "@/lib/money"

const BAR_COLORS = [
  "#e26a1b",
  "#1f7a4d",
  "#2f6fdb",
  "#c43b5a",
  "#7a4cc2",
  "#0e8a8a",
  "#d4a017",
  "#3d6b4f",
  "#c46b2f",
  "#3a5f8a",
  "#a33d6b",
  "#4d8c3a",
  "#6b4c2a",
  "#2a7f9e",
  "#b85c38",
  "#5c4d8a",
]

function barColor(index: number, cents: number) {
  if (cents <= 0) return "#d6d3d1"
  return BAR_COLORS[index % BAR_COLORS.length]
}

function ExpenseTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: { name?: string; cents?: number } }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row?.name) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{row.name}</p>
      <p className="tabular-nums">Expense {formatMoney(centsToMoney(row.cents ?? 0))}</p>
    </div>
  )
}

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
        {rows.map((row, index) => (
          <li key={row.name} title={`${row.name}\nExpense ${formatMoney(centsToMoney(row.cents))}`}>
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
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(row.cents > 0 ? 6 : 0, (row.cents / max) * 100)}%`,
                  backgroundColor: barColor(index, row.cents),
                }}
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
            content={<ExpenseTooltip />}
            cursor={{ fill: "oklch(0.64 0.2 42 / 0.08)" }}
          />
          <Bar dataKey="cents" radius={4}>
            {rows.map((row, index) => (
              <Cell key={row.name} fill={barColor(index, row.cents)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
      </div>
    </>
  )
}
