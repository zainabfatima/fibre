import { invoiceStatusLabel, verificationLabel } from "@/lib/labels"

export function StatusBadge({
  kind,
  status,
}: {
  kind: "invoice" | "verification"
  status: string
}) {
  const label = kind === "invoice" ? invoiceStatusLabel(status) : verificationLabel(status)
  const tone =
    status === "not_invoiced" || status === "flagged"
      ? "bg-red-100 text-red-800"
      : status === "paid" || status === "verified"
        ? "bg-emerald-100 text-emerald-800"
        : status === "partially_paid" || status === "pending"
          ? "bg-amber-100 text-amber-900"
          : "bg-muted text-muted-foreground"
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  )
}
