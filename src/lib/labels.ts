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
