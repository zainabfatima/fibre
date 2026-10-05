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

  return (
    <div className="max-h-[70vh] overflow-auto">
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
  )
}
