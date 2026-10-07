function normalizeVendor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      )
    }
  }
  return rows[a.length][b.length]
}

export function vendorsSimilar(left: string | null, right: string | null) {
  const a = normalizeVendor(left ?? "")
  const b = normalizeVendor(right ?? "")
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const distance = levenshtein(a, b)
  return distance / Math.max(a.length, b.length) <= 0.25
}

export type DuplicateIdentity = {
  receiptNumber: string | null
  expenseDate: string | null
  receiptTime: string | null
  amountCents: number
  paymentMethod: string | null
  cardLast4: string | null
}

function compact(value: string | null) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function paymentKey(value: string | null) {
  const text = compact(value)
  if (!text) return ""
  if (text.includes("americanexpress") || text.includes("amex")) return "amex"
  if (text.includes("mastercard") || text === "mc" || text.includes("master")) return "mastercard"
  if (text.includes("visa")) return "visa"
  if (text.includes("discover")) return "discover"
  if (text.includes("debit")) return "debit"
  if (text.includes("cash")) return "cash"
  if (text.includes("check") || text.includes("cheque")) return "check"
  return text
}

/** A key only when receipt number, date, time, amount, payment method, and card ending are all present. */
export function duplicateIdentityKey(row: DuplicateIdentity) {
  const receipt = compact(row.receiptNumber)
  const date = (row.expenseDate ?? "").trim()
  const time = (row.receiptTime ?? "").trim()
  const payment = paymentKey(row.paymentMethod)
  const card = (row.cardLast4 ?? "").replace(/\D/g, "").slice(-4)
  if (!receipt || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  if (!payment || card.length !== 4 || row.amountCents <= 0) return null
  return [receipt, date, time, String(row.amountCents), payment, card].join("|")
}

export function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
