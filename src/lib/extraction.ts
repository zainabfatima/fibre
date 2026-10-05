import { z } from "zod"

import { formatCategory } from "@/lib/format"

export const CATEGORY_RULES = `Some categories overlap. Apply these rules when suggesting:
- Soft costs: architect → 1 Architectural; engineer → 2 Engineering; legal → 3 Legal; the building permit itself → 4 Permits; survey → 5 Surveying; insurance → 6 Insurance; site plan → 7 Site plans. Impact fees, tap fees, plan review, and inspection charges → 8 Other soft costs.
- Temp fencing (construction fence or silt fence during the build) → 9 Temp fencing. Permanent yard or property fencing → 18 Fencing.
- Temp power pole or temp water during construction → 10 Temp utilities. Buried sewer, water, or electrical service → 14 Underground utilities.
- Rented machinery → 11 Equipment rental. Dumpsters → 12 Dumpsters.
- Excavation and grading → 13 Excavation / grading. Driveway or drive apron → 15 Driveway. Landscaping, sod, or irrigation → 16 Landscaping / irrigation. Deck or patio → 17 Deck / patio.
- Rain gutters → 19. Pressure washing → 20. Exterior paint → 21. Exterior work with no closer trade → 22 Other exterior.
- Foundation, footings, slab, and rebar for the house → 23 Foundation. Brick, stone, or masonry veneer → 24 Masonry / stone.
- Lumber purchases and framing labor both → 25 Rough framing / lumber.
- Roofing → 26. Siding → 27. Windows → 28. Exterior doors → 29. Garage door → 30. Fireplace → 31.
- HVAC rough, equipment, and trim-out → 32. Plumbing labor and plumbing fixtures → 33. Electrical labor and light fixtures → 34. Alarm, data, cameras, or low voltage → 35.
- Insulation → 36. Drywall → 37. Interior doors → 38. Interior trim and millwork → 39.
- Floor finishes (tile floors, wood, carpet) → 40 Flooring: tile, wood, carpet. Interior paint → 41. Do not put shower tile in 40.
- Mirrors → 42. Shower glass → 43. Shower tile → 44. Tubs → 45. Other interior work → 46.
- Kitchen cabinets → 47. Bathroom cabinets → 48. Kitchen countertops → 49. Bathroom vanity tops → 50. Backsplash → 51. Appliances → 52. Other kitchen items → 53.
- Supervision → 54. Day labor or general labor → 55. Final cleaning → 56 Cleaning. Mid-build or broom clean → 57 Rough clean.
- Use the specific trade. There is no generic subcontractor or materials category.
- Delivery included on a material receipt stays with that material. Standalone delivery with no material → 58.
- Miscellaneous: 58 is last resort; when suggested, confidence < 0.6.
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

export const extractionSchema = z.object({
  vendor: z.string().optional().nullable().default(""),
  date: z.string().optional().nullable(),
  total_amount_paid: z.coerce.number().optional().nullable(),
  subtotal: z.coerce.number().optional().nullable(),
  tax: z.coerce.number().optional().nullable(),
  receipt_number: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
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
  const parsed = extractionSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "))
  }
  const data = parsed.data
  const date =
    data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null
  let confidence = Number.isFinite(data.confidence) ? data.confidence : 0
  if (!date || data.total_amount_paid == null) confidence = Math.min(confidence, 0.69)
  const codes = data.suggested_categories.slice(0, 3)
  if (codes.some((item) => item.code === 58)) confidence = Math.min(confidence, 0.59)
  return { ...data, date, confidence, suggested_categories: codes }
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

JSON shape:
{
  "vendor": "string",
  "date": "YYYY-MM-DD",
  "total_amount_paid": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "receipt_number": "string or null",
  "payment_method": "string or null",
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
