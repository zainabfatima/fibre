import { z } from "zod"

import { formatCategory } from "@/lib/format"

export const CATEGORY_RULES = `Some categories overlap. Apply these rules when suggesting:
- Soft costs: architect → 1 Architectural; engineer → 2 Engineering; legal → 3 Legal; the building permit itself → 4 Permits; survey → 5 Surveying; insurance → 6 Insurance; site plan → 7 Site plans. Impact fees, tap fees, plan review, and inspection charges → 8 Other soft costs.
- Temp fencing (construction fence or silt fence during the build) → 9 Temp fencing. Permanent yard or property fencing → 18 Fencing.
- Temp power pole or temp water during construction → 10 Temp utilities. Buried sewer, water, or electrical service → 14 Underground utilities.
- Rented machinery → 11 Equipment rental. Dumpsters → 12 Dumpsters.
- Excavation and grading → 13 Excavation / grading. Driveway or drive apron → 15 Driveway. Landscaping, sod, or irrigation → 16 Landscaping / irrigation. Deck or patio → 17 Deck / patio.
- Rain gutters → 19. Pressure washing → 20. Exterior paint → 21. Exterior work with no closer trade → 22 Other exterior.
- Retaining wall → 23. Foundation, footings, slab, and rebar for the house → 24 Foundation. Brick, stone, or masonry veneer → 25 Masonry / stone.
- Lumber purchases and framing labor both → 26 Rough framing / lumber.
- Roofing → 27. Siding → 28. Windows → 29. Exterior doors → 30. Garage door → 31. Fireplace → 32.
- HVAC rough, equipment, and trim-out → 33. Plumbing labor and plumbing fixtures → 34. Electrical labor and light fixtures → 35. Alarm, data, cameras, or low voltage → 36.
- Insulation → 37. Drywall → 38. Interior doors → 39. Interior trim and millwork → 40.
- Floor finishes (tile floors, wood, carpet) → 41 Flooring: tile, wood, carpet. Interior paint → 42. Do not put shower tile in 41.
- Mirrors → 43. Shower glass → 44. Shower tile → 45. Tubs → 46. Other interior work → 47.
- Kitchen cabinets → 48. Bathroom cabinets → 49. Kitchen countertops → 50. Bathroom vanity tops → 51. Backsplash → 52. Appliances → 53. Other kitchen items → 54.
- Supervision → 55. Day labor or general labor → 56. Final cleaning → 57 Cleaning. Mid-build or broom clean → 58 Rough clean.
- Use the specific trade. There is no generic subcontractor or materials category.
- Delivery included on a material receipt stays with that material. Standalone delivery with no material → 59.
- Miscellaneous: 59 is last resort; when suggested, confidence < 0.6.
- If a receipt clearly spans multiple categories, set "split_suggested": true and give each line item its category_code.`

const lineItemSchema = z.object({
  description: z.string().optional().default(""),
  amount: z.coerce.number().optional().default(0),
  category_code: z.coerce.number().optional().nullable().default(null),
})

const suggestionSchema = z.object({
  code: z.coerce.number(),
  reason: z.string().optional().default(""),
})

function nullableText(value: unknown) {
  if (value == null || value === "") return null
  return String(value)
}

export const extractionSchema = z.object({
  vendor: z.preprocess(nullableText, z.string().nullable().optional().default("")),
  date: z.preprocess(nullableText, z.string().nullable().optional()),
  total_amount_paid: z.coerce.number().optional().nullable(),
  subtotal: z.coerce.number().optional().nullable(),
  tax: z.coerce.number().optional().nullable(),
  receipt_number: z.preprocess(nullableText, z.string().nullable().optional()),
  time: z.preprocess(nullableText, z.string().nullable().optional().default(null)),
  payment_method: z.preprocess(nullableText, z.string().nullable().optional()),
  card_last4: z.preprocess(nullableText, z.string().nullable().optional().default(null)),
  line_items: z.array(lineItemSchema).optional().default([]),
  suggested_categories: z.array(suggestionSchema).optional().default([]),
  split_suggested: z.coerce.boolean().optional().default(false),
  confidence: z.coerce.number().min(0).max(1).optional().default(0),
  notes: z.string().optional().nullable().default(""),
})

export type Extraction = z.infer<typeof extractionSchema>

export function stripJsonFences(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? trimmed).trim()
}

export function parseExtraction(text: string) {
  const raw = stripJsonFences(text)
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  const jsonText = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
  const loosened = jsonText.replace(
    /"(total_amount_paid|subtotal|tax|amount)"\s*:\s*"([^"]*)"/g,
    (_match, key: string, value: string) => {
      const cleaned = value.replace(/[$,\s]/g, "")
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return `"${key}": null`
      return `"${key}": ${cleaned}`
    },
  )
  const parsed = extractionSchema.safeParse(JSON.parse(loosened))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "))
  }
  const data = parsed.data
  const date =
    data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null
  const time = normalizeReceiptTime(data.time)
  const card_last4 = normalizeCardLast4(data.card_last4)
  let confidence = Number.isFinite(data.confidence) ? data.confidence : 0
  if (!date || data.total_amount_paid == null) confidence = Math.min(confidence, 0.69)
  const codes = data.suggested_categories.slice(0, 3)
  if (codes.some((item) => item.code === 59)) confidence = Math.min(confidence, 0.59)
  return { ...data, date, time, card_last4, confidence, suggested_categories: codes }
}

export function normalizeReceiptTime(value: string | null | undefined) {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const suffix = match[3]?.toLowerCase()
  if (suffix === "pm" && hour < 12) hour += 12
  if (suffix === "am" && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function normalizeCardLast4(value: string | null | undefined) {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length < 4) return null
  return digits.slice(-4)
}

export function categoryPromptList(
  categories: Array<{ code: number; name: string; keywords: string[] }>,
) {
  return categories
    .map(
      (category) =>
        `${category.code} ${formatCategory(category.code, category.name)} keywords: ${category.keywords.join(", ") || "none"}`,
    )
    .join("\n")
}

export function extractionSystemPrompt(categoryList: string) {
  return `You extract data from construction receipt and invoice images.
Return ONLY JSON. No markdown, no code fences, no commentary.
Use the FINAL amount actually paid (after tax and discounts), not the subtotal, for total_amount_paid.
Pick up to 3 category codes ONLY from the list below.
Set confidence below 0.7 when the amount or date is unclear.
Dates must be YYYY-MM-DD or null.
time is the transaction time printed on the receipt, 24-hour HH:MM, or null when no time is printed.
card_last4 is only the last 4 digits of the card. Never return a full card number. Use null when no card is printed.
payment_method is the payment type or card brand, not the card number.

JSON shape:
{
  "vendor": "string",
  "date": "YYYY-MM-DD",
  "total_amount_paid": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "receipt_number": "string or null",
  "time": "HH:MM or null",
  "payment_method": "cash, check, visa, mastercard, amex, discover, debit, or other",
  "card_last4": "last 4 digits or null",
  "line_items": [{"description": "string", "amount": 0.00, "category_code": 0}],
  "suggested_categories": [{"code": 0, "reason": "string"}],
  "split_suggested": false,
  "confidence": 0.0,
  "notes": "anything unclear, e.g. handwritten, faded, multiple totals"
}

${CATEGORY_RULES}

Categories:
${categoryList}`
}
