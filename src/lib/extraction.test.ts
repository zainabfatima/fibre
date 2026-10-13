import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const file = pathToFileURL(join(srcRoot, `${specifier.slice(2)}.ts`)).href
      return nextResolve(file, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadExtraction() {
  return import("./extraction.ts")
}

describe("receipt extraction", () => {
  it("keeps a visible amount when the other fields are null", async () => {
    const { parseExtraction } = await loadExtraction()
    const parsed = parseExtraction(
      JSON.stringify({
        vendor: null,
        date: null,
        description: null,
        total_amount_paid: 88.1,
        subtotal: null,
        tax: null,
        receipt_number: null,
        time: null,
        payment_method: null,
        card_last4: null,
        line_items: [],
        suggested_categories: [],
        confidence: 0.91,
        notes: null,
      }),
    )

    assert.equal(parsed.total_amount_paid, 88.1)
    assert.equal(parsed.date, null)
    assert.equal(parsed.vendor, null)
    assert.equal(parsed.description, "")
    assert.equal(parsed.receipt_number, null)
    assert.equal(parsed.time, null)
    assert.equal(parsed.payment_method, null)
    assert.equal(parsed.card_last4, null)
    assert.deepEqual(parsed.suggested_categories, [])
    assert.equal(parsed.confidence, 0.91)
  })

  it("does not lower confidence only because the date is missing", async () => {
    const { parseExtraction } = await loadExtraction()
    const parsed = parseExtraction(
      JSON.stringify({
        total_amount_paid: 42.5,
        date: "March 2",
        vendor: "",
        confidence: 0.92,
      }),
    )

    assert.equal(parsed.total_amount_paid, 42.5)
    assert.equal(parsed.date, null)
    assert.equal(parsed.vendor, null)
    assert.equal(parsed.confidence, 0.92)
  })

  it("lowers confidence when the amount itself is missing", async () => {
    const { parseExtraction } = await loadExtraction()
    const parsed = parseExtraction(
      JSON.stringify({
        vendor: "Home Depot",
        date: "2026-01-02",
        description: "Lumber",
        total_amount_paid: null,
        confidence: 0.95,
      }),
    )

    assert.equal(parsed.total_amount_paid, null)
    assert.equal(parsed.date, "2026-01-02")
    assert.equal(parsed.confidence, 0.69)
  })

  it("keeps parentheses and a leading minus negative", async () => {
    const { parseExtraction } = await loadExtraction()
    const parentheses = parseExtraction(
      JSON.stringify({ total_amount_paid: "(12.50)", confidence: 0.8 }),
    )
    const currency = parseExtraction(
      JSON.stringify({ total_amount_paid: "($12.50)", date: null, confidence: 0.84 }),
    )
    const minus = parseExtraction(
      JSON.stringify({ total_amount_paid: "-18.25", confidence: 0.88 }),
    )

    assert.equal(parentheses.total_amount_paid, -12.5)
    assert.equal(parentheses.confidence, 0.8)
    assert.equal(currency.total_amount_paid, -12.5)
    assert.equal(currency.date, null)
    assert.equal(currency.confidence, 0.84)
    assert.equal(minus.total_amount_paid, -18.25)
    assert.equal(minus.confidence, 0.88)
  })

  it("still lowers confidence for a miscellaneous category", async () => {
    const { parseExtraction } = await loadExtraction()
    const parsed = parseExtraction(
      JSON.stringify({
        total_amount_paid: 10,
        date: "2026-01-02",
        confidence: 0.9,
        suggested_categories: [{ code: 59, reason: "misc" }],
      }),
    )

    assert.equal(parsed.total_amount_paid, 10)
    assert.equal(parsed.confidence, 0.59)
  })

  it("tells Claude that only the amount is required", async () => {
    const {
      extractionSystemPrompt,
      extractionUserInstruction,
      ORIGINAL_AMOUNT_PROMPT,
      RECEIPT_AMOUNT_PROMPT,
    } = await loadExtraction()
    const system = extractionSystemPrompt("26 Rough framing / lumber")
    const chosen = extractionUserInstruction("Extract this receipt.", true)
    const open = extractionUserInstruction("Extract this receipt.", false)

    for (const prompt of [system, chosen, open, RECEIPT_AMOUNT_PROMPT, ORIGINAL_AMOUNT_PROMPT]) {
      assert.match(prompt, /only required field/)
      assert.match(prompt, /Do not invent/)
      assert.match(prompt, /\(12\.50\)/)
      assert.match(prompt, /leading minus|Keep the minus sign/)
    }

    assert.match(system, /Do not lower confidence only because the date/)
    assert.doesNotMatch(system, /amount or date is unclear/)
    assert.match(chosen, /may be null/)
    assert.match(open, /must not omit total_amount_paid/)
    assert.match(RECEIPT_AMOUNT_PROMPT, /"vendor":null/)
    assert.match(ORIGINAL_AMOUNT_PROMPT, /"date":null/)
  })
})
