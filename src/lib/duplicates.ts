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

export function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
