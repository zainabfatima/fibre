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

export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "")
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const normalized = cleaned.includes(".") ? cleaned : `${cleaned}.00`
  return moneyToCents(normalized)
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
