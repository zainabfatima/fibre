import { formatMoney, moneyToCents, parseMoneyInput } from "@/lib/money"

export type AmountMatchKind = "exact" | "partial"

/**
 * How `amount` matches a dollar search, if it does.
 * `$` and commas are ignored, so `2316`, `2316.00`, and `$2,316.00` are the same cents.
 * A shorter number such as `23` is a partial match when that sequence appears in the
 * formatted amount, or when the dollar value starts with it.
 * Text that is not a number does not match vendor names or other fields.
 */
export function amountMatchKind(query: string, amount: string | number): AmountMatchKind | null {
  const normalized = query.replace(/[$,\s]/g, "")
  if (!/^\d*\.?\d+$/.test(normalized)) return null

  let cents: number
  try {
    cents = moneyToCents(amount)
  } catch {
    return null
  }

  const exact = parseMoneyInput(normalized)
  if (exact != null && exact === cents) return "exact"

  const formatted = formatMoney(amount).replace(/[$,]/g, "")
  if (formatted.includes(normalized)) return "partial"

  if (!normalized.includes(".")) {
    const dollars = String(Math.trunc(Math.abs(cents) / 100))
    if (dollars.startsWith(normalized)) return "partial"
  }

  return null
}
