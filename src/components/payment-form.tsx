"use client"

import { useActionState } from "react"

import { addClientPayment, deleteClientPayment } from "@/app/actions/payments"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney } from "@/lib/money"

export function PaymentForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: { error: string | null }, formData: FormData) => addClientPayment(formData),
    { error: null },
  )
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form action={formAction} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-[160px_140px_1fr_auto] sm:items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-1">
        <Label htmlFor="receivedDate">Date</Label>
        <Input id="receivedDate" name="receivedDate" type="date" defaultValue={today} required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="amount">Amount</Label>
        <Input id="amount" name="amount" inputMode="decimal" placeholder="0.00" required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="note">Note</Label>
        <Input id="note" name="note" placeholder="Optional" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add"}
      </Button>
      {state.error ? <p className="text-sm text-destructive sm:col-span-4">{state.error}</p> : null}
    </form>
  )
}

export function PaymentList({
  projectId,
  payments,
}: {
  projectId: string
  payments: Array<{ id: string; received_date: string; amount: string; note: string | null }>
}) {
  if (payments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        No payments yet. Add each amount the client has paid.
      </p>
    )
  }

  return (
    <ul className="grid gap-2">
      {payments.map((payment) => (
        <li
          key={payment.id}
          className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10"
        >
          <span>{payment.received_date}</span>
          <span className="font-medium tabular-nums">{formatMoney(payment.amount)}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{payment.note}</span>
          <form
            action={async (formData) => {
              await deleteClientPayment(formData)
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="paymentId" value={payment.id} />
            <Button type="submit" variant="outline" size="sm">
              Delete
            </Button>
          </form>
        </li>
      ))}
    </ul>
  )
}
