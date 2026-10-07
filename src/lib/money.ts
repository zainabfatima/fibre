/**
 * Convert a Postgres numeric (string) to integer cents.
 * numeric(12,2) stays inside Number.MAX_SAFE_INTEGER when counted in cents.
 * Sum cents, then format. Do not add money with JavaScript floats.
 */
export function moneyToCents(value: string | number): number {
  const raw = String(value).trim()
  if (!raw) {
    throw new Error("Invalid money value: empty")
  }

  const negative = raw.startsWith("-")
  const unsigned = negative ? raw.slice(1) : raw
  const [whole, fraction = ""] = unsigned.split(".")

  if (
    !/^\d+$/.test(whole) ||
    unsigned.split(".").length > 2 ||
    (fraction !== "" && !/^\d+$/.test(fraction))
  ) {
    throw new Error(`Invalid money value: ${value}`)
  }

  const cents =
    Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))
  return negative ? -cents : cents
}

export function centsToMoney(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Cents must be an integer: ${cents}`)
  }

  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.floor(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, "0")
  return `${negative ? "-" : ""}${whole}.${fraction}`
}

export function formatMoney(value: string | number): string {
  const cents = moneyToCents(value)
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.floor(absolute / 100).toLocaleString("en-US")
  const fraction = String(absolute % 100).padStart(2, "0")
  return `${negative ? "-" : ""}$${whole}.${fraction}`
}

/** Round `cents * percent / 100` with half-up, using integer math. */
export function percentOfCents(cents: number, percent: string | number): number {
  if (!Number.isInteger(cents)) {
    throw new Error(`Cents must be an integer: ${cents}`)
  }
  const raw = String(percent).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid percent: ${percent}`)
  }
  const [whole, fraction = ""] = raw.split(".")
  const hundredths =
    Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))
  const negative = cents < 0
  const product = Math.abs(cents) * hundredths
  const rounded = Math.floor((product + 5000) / 10000)
  return negative ? -rounded : rounded
}

/** Dollar amount from a receipt total. Parentheses and a leading minus are negative. */
export function parseSignedAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return null
    return Math.round(value * 100) / 100
  }
  if (typeof value !== "string") return null
  let text = value.trim()
  if (!text || text.toLowerCase() === "null") return null
  let negative = false
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/[$,\s]/g, "")
  if (text.startsWith("-")) {
    negative = true
    text = text.slice(1)
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount === 0) return null
  return negative ? -amount : amount
}

export function parseMoneyInput(value: string): number | null {
  const trimmed = value.trim()
  const wrapped = trimmed.match(/^\((.*)\)\s*$/)
  const body = (wrapped ? wrapped[1] : trimmed).replace(/[$,\s]/g, "")
  if (!/^-?\d+(\.\d{0,2})?$/.test(body)) return null
  const negative = Boolean(wrapped) || body.startsWith("-")
  const unsigned = body.replace(/^-/, "")
  const normalized = unsigned.includes(".") ? unsigned : `${unsigned}.00`
  const cents = moneyToCents(normalized)
  return negative ? -Math.abs(cents) : cents
}

/** True when a negative amount still needs the return confirmation. */
export function needsReturnConfirmation(amount: string | number, returnConfirmed: boolean) {
  if (returnConfirmed) return false
  const cents = parseMoneyInput(String(amount))
  if (cents != null) return cents < 0
  try {
    return moneyToCents(amount) < 0
  } catch {
    return false
  }
}

export function sumCents(values: Array<string | number>): number {
  return values.reduce<number>((total, value) => total + moneyToCents(value), 0)
}

/** Cents spent above the budget, or null when spending is within the budget. */
export function amountOverBudget(
  budget: string | number | null | undefined,
  spentCents: number,
): number | null {
  if (budget == null || budget === "") return null
  const budgetCents = moneyToCents(budget)
  if (spentCents <= budgetCents) return null
  return spentCents - budgetCents
}
