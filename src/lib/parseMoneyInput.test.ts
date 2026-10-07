import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { needsReturnConfirmation, parseMoneyInput } from "./money.ts"

describe("parseMoneyInput", () => {
  it("keeps parentheses and a leading minus negative", () => {
    assert.equal(parseMoneyInput("(12.50)"), -1250)
    assert.equal(parseMoneyInput("($12.50)"), -1250)
    assert.equal(parseMoneyInput("-12.50"), -1250)
    assert.equal(parseMoneyInput("-$12.50"), -1250)
    assert.equal(parseMoneyInput("12.50"), 1250)
    assert.equal(parseMoneyInput("$1,250.00"), 125000)
  })

  it("asks again only while a negative amount is unconfirmed", () => {
    assert.equal(needsReturnConfirmation("-12.50", false), true)
    assert.equal(needsReturnConfirmation("(12.50)", false), true)
    assert.equal(needsReturnConfirmation("-12.50", true), false)
    assert.equal(needsReturnConfirmation("12.50", false), false)
  })
})
