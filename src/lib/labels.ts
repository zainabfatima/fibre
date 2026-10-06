/** Roll up the paid / unpaid / partial marks the user set on each linked expense. */
export function deriveInvoiceBillingStatus(statuses: string[]) {
  if (statuses.length === 0) return "unpaid"
  const paid = statuses.filter((status) => status === "paid").length
  const anyPartial = statuses.some((status) => status === "partial")
  if (paid === statuses.length) return "paid"
  if (anyPartial || (paid > 0 && paid < statuses.length)) return "partial"
  return "unpaid"
}

export function invoiceStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "not_invoiced":
      return "Needs Invoice"
    case "pending":
    case "unpaid":
      return "Unpaid"
    case "paid":
      return "Paid"
    case "partially_paid":
    case "partial":
      return "Partial"
    case "void":
      return "Void"
    default:
      return "Needs Invoice"
  }
}

export function verificationLabel(status: string) {
  switch (status) {
    case "verified":
      return "Verified"
    case "flagged":
      return "Flagged"
    default:
      return "Needs review"
  }
}

export function projectStatusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed"
    case "on_hold":
      return "On hold"
    default:
      return "Active"
  }
}
