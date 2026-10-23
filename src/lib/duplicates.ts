import { moneyToCents } from "@/lib/money"

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

/** Expense date only. A missing date does not match, and created_at is not used. */
export function expenseDateKey(value: string | null | undefined) {
  const date = (value ?? "").trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

export type DuplicateCheckRow = {
  id: string
  amount: string | number
  date: string | null
  duplicateOf?: string | null
  duplicateConfirmed?: boolean
  splitGroupId?: string | null
}

function sameSplitGroup(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && left === right)
}

function amountCents(value: string | number) {
  try {
    return moneyToCents(value)
  } catch {
    return null
  }
}

/**
 * Same project is the caller's job.
 * Positive amounts only, in cents, so 12.5 and 12.50 match.
 * Zero and negative amounts are not duplicates — returns keep the return prompt.
 * A missing expense date does not match.
 */
export function sameAmountAndDate(left: DuplicateCheckRow, right: DuplicateCheckRow) {
  if (left.id === right.id) return false
  if (left.duplicateConfirmed || right.duplicateConfirmed) return false
  if (sameSplitGroup(left.splitGroupId, right.splitGroupId)) return false
  const leftCents = amountCents(left.amount)
  const rightCents = amountCents(right.amount)
  if (leftCents == null || rightCents == null || leftCents <= 0 || rightCents <= 0) return false
  if (leftCents !== rightCents) return false
  const leftDate = expenseDateKey(left.date)
  const rightDate = expenseDateKey(right.date)
  if (!leftDate || !rightDate) return false
  return leftDate === rightDate
}

/** Other receipts that should still show a possible-duplicate warning. */
export function duplicatePartners<T extends DuplicateCheckRow>(row: T, allRows: T[]) {
  if (row.duplicateConfirmed) return []
  const partners: T[] = []
  const seen = new Set<string>()
  for (const other of allRows) {
    if (other.id === row.id || other.duplicateConfirmed || seen.has(other.id)) continue
    if (sameSplitGroup(row.splitGroupId, other.splitGroupId)) continue
    const linked = row.duplicateOf === other.id || other.duplicateOf === row.id
    if (!linked && !sameAmountAndDate(row, other)) continue
    seen.add(other.id)
    partners.push(other)
  }
  return partners
}

export function isPossibleDuplicate(row: DuplicateCheckRow, allRows: DuplicateCheckRow[]) {
  if (row.duplicateConfirmed) return false
  if (duplicatePartners(row, allRows).length > 0) return true
  if (!row.duplicateOf) return false
  return !allRows.some((other) => other.id === row.duplicateOf)
}

export type DuplicateLinkRow = {
  id: string
  projectId: string
  amountCents: number
  expenseDate: string | null
  receiptNumber: string | null
  receiptTime: string | null
  paymentMethod: string | null
  cardLast4: string | null
  splitGroupId: string | null
  duplicateConfirmed: boolean
  createdAt: string
}

function byCreated(left: DuplicateLinkRow, right: DuplicateLinkRow) {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function isEarlier(left: DuplicateLinkRow, right: DuplicateLinkRow) {
  return byCreated(left, right) < 0
}

/** Desired duplicate_of for each row. Confirmed rows stay unlinked. */
export function planDuplicateLinks(rows: DuplicateLinkRow[]) {
  const desired = new Map<string, string | null>()
  for (const row of rows) desired.set(row.id, null)

  const byProject = new Map<string, DuplicateLinkRow[]>()
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? []
    list.push(row)
    byProject.set(row.projectId, list)
  }

  for (const projectRows of byProject.values()) {
    const ordered = [...projectRows].sort(byCreated)
    const identityTarget = new Map<string, string>()
    const identityGroups = new Map<string, DuplicateLinkRow[]>()
    for (const row of ordered) {
      if (row.duplicateConfirmed) continue
      const key = duplicateIdentityKey({
        receiptNumber: row.receiptNumber,
        expenseDate: row.expenseDate,
        receiptTime: row.receiptTime,
        amountCents: row.amountCents,
        paymentMethod: row.paymentMethod,
        cardLast4: row.cardLast4,
      })
      if (!key) continue
      const bucket = identityGroups.get(key) ?? []
      bucket.push(row)
      identityGroups.set(key, bucket)
    }
    for (const bucket of identityGroups.values()) {
      const canonical = bucket[0]
      if (!canonical || bucket.length < 2) continue
      for (const other of bucket.slice(1)) {
        if (sameSplitGroup(canonical.splitGroupId, other.splitGroupId)) continue
        identityTarget.set(other.id, canonical.id)
      }
    }

    const amountGroups = new Map<string, DuplicateLinkRow[]>()
    for (const row of ordered) {
      if (row.duplicateConfirmed || row.amountCents <= 0) continue
      const date = expenseDateKey(row.expenseDate)
      if (!date) continue
      const key = `${date}|${row.amountCents}`
      const bucket = amountGroups.get(key) ?? []
      bucket.push(row)
      amountGroups.set(key, bucket)
    }
    const amountTarget = new Map<string, string>()
    for (const bucket of amountGroups.values()) {
      if (bucket.length < 2) continue
      for (const row of bucket) {
        if (identityTarget.has(row.id)) continue
        const target = bucket.find(
          (other) =>
            other.id !== row.id &&
            !sameSplitGroup(row.splitGroupId, other.splitGroupId) &&
            isEarlier(other, row),
        )
        if (target) amountTarget.set(row.id, target.id)
      }
    }

    for (const row of ordered) {
      desired.set(
        row.id,
        row.duplicateConfirmed ? null : (identityTarget.get(row.id) ?? amountTarget.get(row.id) ?? null),
      )
    }
  }

  return desired
}
