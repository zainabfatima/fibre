import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  centsToMoney,
  formatMoney,
  isNegativeAmount,
  moneyToCents,
  needsReturnConfirmation,
  parseMoneyInput,
  parseSignedAmount,
  returnAmountClass,
  signedExpenseAmount,
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
    assert.equal(isNegativeAmount("-377.20"), true)
    assert.equal(isNegativeAmount("-$377.20"), true)
    assert.equal(isNegativeAmount("(377.20)"), true)
    assert.equal(isNegativeAmount("377.20"), false)
    assert.equal(returnAmountClass("-377.20").includes("text-red-700"), true)
    assert.equal(returnAmountClass("377.20"), "")
    assert.equal(signedExpenseAmount("0.00", { total_amount_paid: -323.91 }), "-323.91")
    assert.equal(signedExpenseAmount("0", "-323.91"), "-323.91")
    assert.equal(signedExpenseAmount("208.27", { total_amount_paid: -323.91 }), "208.27")
    assert.equal(signedExpenseAmount("-323.91"), "-323.91")
    assert.equal(centsToMoney(moneyToCents("-323.91")), "-323.91")
  })

  it("asks again only while a negative amount is unconfirmed", () => {
    assert.equal(needsReturnConfirmation("-12.50", false), true)
    assert.equal(needsReturnConfirmation("(12.50)", false), true)
    assert.equal(needsReturnConfirmation("-12.50", true), false)
    assert.equal(needsReturnConfirmation("12.50", false), false)
  })
})
