import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseExtraction } from "./extraction.ts"
import {
  centsToMoney,
  formatMoney,
  moneyToCents,
  needsReturnConfirmation,
  parseMoneyInput,
  parseSignedAmount,
} from "./money.ts"

describe("parseMoneyInput", () => {
  it("keeps parentheses and a leading minus negative", () => {
    assert.equal(parseMoneyInput("(12.50)"), -1250)
    assert.equal(parseMoneyInput("($12.50)"), -1250)
    assert.equal(parseMoneyInput("-12.50"), -1250)
    assert.equal(parseMoneyInput("-$12.50"), -1250)
    assert.equal(parseMoneyInput("12.50"), 1250)
    assert.equal(parseMoneyInput("$1,250.00"), 125000)
  })

  it("stores -377.20 as negative cents and shows the minus", () => {
    for (const typed of ["-377.20", "-$377.20", "$-377.20", "\u2212377.20", "\u2212$377.20"]) {
      assert.equal(parseMoneyInput(typed), -37720)
    }
    assert.equal(parseMoneyInput("(377.20)"), -37720)
    assert.equal(parseMoneyInput("($377.20)"), -37720)
    assert.equal(parseSignedAmount("-377.20"), -377.2)
    assert.equal(parseSignedAmount("-$377.20"), -377.2)
    assert.equal(parseSignedAmount("(377.20)"), -377.2)
    assert.equal(moneyToCents(parseSignedAmount("-377.20")!.toFixed(2)), -37720)
    assert.equal(moneyToCents(parseSignedAmount("-$377.20")!.toFixed(2)), -37720)
    assert.equal(centsToMoney(-37720), "-377.20")
    assert.equal(formatMoney("-377.20"), "-$377.20")
    assert.equal(formatMoney("-377.20").includes("("), false)
  })

  it("keeps a minus on an extracted receipt total", () => {
    for (const text of [
      '{"total_amount_paid":-377.20}',
      '{"total_amount_paid":"-377.20"}',
      '{"total_amount_paid":"-$377.20"}',
      '{"total_amount_paid":"(377.20)"}',
    ]) {
      const parsed = parseExtraction(text)
      assert.equal(moneyToCents(parsed.total_amount_paid!.toFixed(2)), -37720)
      assert.equal(centsToMoney(moneyToCents(parsed.total_amount_paid!.toFixed(2))), "-377.20")
    }
  })

  it("asks again only while a negative amount is unconfirmed", () => {
    assert.equal(needsReturnConfirmation("-12.50", false), true)
    assert.equal(needsReturnConfirmation("(12.50)", false), true)
    assert.equal(needsReturnConfirmation("-12.50", true), false)
    assert.equal(needsReturnConfirmation("12.50", false), false)
  })
})
