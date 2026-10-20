"use client"

import { useActionState } from "react"

import { addClientPaidExpense, deleteClientPaidExpense } from "@/app/actions/client-paid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney } from "@/lib/money"

export function ClientPaidForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: { error: string | null }, formData: FormData) => addClientPaidExpense(formData),
    { error: null },
  )
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form action={formAction} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-[160px_140px_1fr_auto] sm:items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-1">
        <Label htmlFor="paidDate">Date</Label>
        <Input id="paidDate" name="paidDate" type="date" defaultValue={today} required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="clientPaidAmount">Amount</Label>
        <Input id="clientPaidAmount" name="amount" inputMode="decimal" placeholder="0.00" required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="clientPaidNote">Note</Label>
        <Input id="clientPaidNote" name="note" placeholder="Optional" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add"}
      </Button>
      {state.error ? <p className="text-sm text-destructive sm:col-span-4">{state.error}</p> : null}
    </form>
  )
}

export function ClientPaidList({
  projectId,
  entries,
}: {
  projectId: string
  entries: Array<{ id: string; paid_date: string; amount: string; note: string | null }>
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        No client-paid expenses yet. Add each amount the client paid directly.
      </p>
    )
  }

  return (
    <ul className="grid gap-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center gap-3 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-950 ring-1 ring-violet-200"
        >
          <span>{entry.paid_date}</span>
          <span className="font-medium tabular-nums">{formatMoney(entry.amount)}</span>
          <span className="min-w-0 flex-1 truncate">{entry.note}</span>
          <form
            action={async (formData) => {
              await deleteClientPaidExpense(formData)
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="entryId" value={entry.id} />
            <Button type="submit" variant="outline" size="sm">
              Delete
            </Button>
          </form>
        </li>
      ))}
    </ul>
  )
}
