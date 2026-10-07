/** One short purchase phrase. Longer text is cut; a line-item dump is not kept. */
export const SIMPLE_DESCRIPTION_MAX_CHARS = 60
export const SIMPLE_DESCRIPTION_MAX_WORDS = 8

export function simpleDescription(value: string | null | undefined) {
  if (value == null) return ""
  let text = String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  if (!text) return ""
  const clauses = text.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean)
  if (clauses.length >= 2) text = clauses[0] ?? text
  const pieces = text.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean)
  if (pieces.length >= 3) text = `${pieces[0]} and ${pieces[1]}`
  text = text.replace(/^\d+[.)]\s*/, "").replace(/^[-–•]\s*/, "")
  text = text.split(" ").filter(Boolean).slice(0, SIMPLE_DESCRIPTION_MAX_WORDS).join(" ")
  if (text.length > SIMPLE_DESCRIPTION_MAX_CHARS) {
    const cut = text.slice(0, SIMPLE_DESCRIPTION_MAX_CHARS)
    const lastSpace = cut.lastIndexOf(" ")
    text = (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim()
  }
  return text.replace(/[.,;:]+$/g, "").replace(/\s+(and|or|for|with|of|to)$/i, "").trim()
}
