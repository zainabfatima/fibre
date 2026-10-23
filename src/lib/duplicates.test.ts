import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  duplicatePartners,
  isPossibleDuplicate,
  planDuplicateLinks,
  type DuplicateCheckRow,
  type DuplicateLinkRow,
} from "./duplicates.ts"

function check(partial: Partial<DuplicateCheckRow> & Pick<DuplicateCheckRow, "id">): DuplicateCheckRow {
  return {
    amount: "12.50",
    date: "2026-03-01",
    duplicateOf: null,
    duplicateConfirmed: false,
    splitGroupId: null,
    ...partial,
  }
}

function link(partial: Partial<DuplicateLinkRow> & Pick<DuplicateLinkRow, "id" | "createdAt">): DuplicateLinkRow {
  return {
    projectId: "project",
    amountCents: 1250,
    expenseDate: "2026-03-01",
    receiptNumber: null,
    receiptTime: null,
    paymentMethod: null,
    cardLast4: null,
    splitGroupId: null,
    duplicateConfirmed: false,
    ...partial,
  }
}

describe("same amount and date", () => {
  it("matches 12.5 and 12.50 on the same expense date", () => {
    const left = check({ id: "a", amount: "12.5" })
    const right = check({ id: "b", amount: "12.50" })
    const rows = [left, right]
    assert.deepEqual(duplicatePartners(left, rows).map((row) => row.id), ["b"])
    assert.deepEqual(duplicatePartners(right, rows).map((row) => row.id), ["a"])
    assert.equal(isPossibleDuplicate(left, rows), true)
  })

  it("does not match a different date, amount, or a missing expense date", () => {
    const dated = check({ id: "a" })
    const otherDay = check({ id: "b", date: "2026-03-02" })
    const otherAmount = check({ id: "c", amount: "12.51" })
    const missing = check({ id: "d", date: null })
    const rows = [dated, otherDay, otherAmount, missing]
    assert.equal(isPossibleDuplicate(dated, rows), false)
    assert.equal(isPossibleDuplicate(missing, rows), false)
  })

  it("does not treat a negative return or a zero amount as a duplicate", () => {
    const left = check({ id: "a", amount: "-12.50" })
    const right = check({ id: "b", amount: "-12.50" })
    const zero = check({ id: "c", amount: "0.00" })
    const otherZero = check({ id: "d", amount: "0.00" })
    assert.equal(isPossibleDuplicate(left, [left, right]), false)
    assert.equal(isPossibleDuplicate(zero, [zero, otherZero]), false)
  })

  it("drops the highlight for both sides after one receipt is confirmed", () => {
    const left = check({ id: "a" })
    const right = check({ id: "b", duplicateConfirmed: true })
    const rows = [left, right]
    assert.equal(isPossibleDuplicate(left, rows), false)
    assert.equal(isPossibleDuplicate(right, rows), false)
  })

  it("keeps the remaining pair highlighted when a third match is confirmed", () => {
    const left = check({ id: "a" })
    const middle = check({ id: "b", duplicateConfirmed: true })
    const right = check({ id: "c" })
    const rows = [left, middle, right]
    assert.deepEqual(duplicatePartners(left, rows).map((row) => row.id), ["c"])
    assert.equal(isPossibleDuplicate(middle, rows), false)
    assert.deepEqual(duplicatePartners(right, rows).map((row) => row.id), ["a"])
  })

  it("does not flag two lines from the same split", () => {
    const left = check({ id: "a", splitGroupId: "split" })
    const right = check({ id: "b", splitGroupId: "split" })
    assert.equal(isPossibleDuplicate(left, [left, right]), false)
  })

  it("still follows a stored duplicate link, unless that receipt was confirmed", () => {
    const left = check({ id: "a", amount: "40.00", duplicateOf: "b" })
    const right = check({ id: "b", amount: "18.00" })
    assert.deepEqual(duplicatePartners(left, [left, right]).map((row) => row.id), ["b"])
    const confirmed = check({ id: "b", amount: "18.00", duplicateConfirmed: true })
    assert.equal(isPossibleDuplicate(left, [left, confirmed]), false)
  })

  it("warns when the linked receipt is no longer in the list", () => {
    const left = check({ id: "a", duplicateOf: "missing" })
    assert.equal(isPossibleDuplicate(left, [left]), true)
    assert.equal(isPossibleDuplicate({ ...left, duplicateConfirmed: true }, [left]), false)
  })
})

describe("planDuplicateLinks", () => {
  it("points the later same amount and date at the earlier expense", () => {
    const planned = planDuplicateLinks([
      link({ id: "later", createdAt: "2026-03-03T00:00:00.000Z" }),
      link({ id: "earlier", createdAt: "2026-03-02T00:00:00.000Z" }),
    ])
    assert.equal(planned.get("earlier"), null)
    assert.equal(planned.get("later"), "earlier")
  })

  it("does not link a pair after either expense is confirmed", () => {
    const confirmedLater = planDuplicateLinks([
      link({ id: "earlier", createdAt: "2026-03-02T00:00:00.000Z" }),
      link({ id: "later", createdAt: "2026-03-03T00:00:00.000Z", duplicateConfirmed: true }),
    ])
    assert.equal(confirmedLater.get("earlier"), null)
    assert.equal(confirmedLater.get("later"), null)

    const confirmedEarlier = planDuplicateLinks([
      link({ id: "earlier", createdAt: "2026-03-02T00:00:00.000Z", duplicateConfirmed: true }),
      link({ id: "later", createdAt: "2026-03-03T00:00:00.000Z" }),
    ])
    assert.equal(confirmedEarlier.get("earlier"), null)
    assert.equal(confirmedEarlier.get("later"), null)
  })

  it("keeps the other two linked when one of three is confirmed", () => {
    const planned = planDuplicateLinks([
      link({ id: "a", createdAt: "2026-03-02T00:00:00.000Z", duplicateConfirmed: true }),
      link({ id: "b", createdAt: "2026-03-03T00:00:00.000Z" }),
      link({ id: "c", createdAt: "2026-03-04T00:00:00.000Z" }),
    ])
    assert.equal(planned.get("a"), null)
    assert.equal(planned.get("b"), null)
    assert.equal(planned.get("c"), "b")
  })

  it("ignores negatives, missing dates, other projects, and the same split", () => {
    const planned = planDuplicateLinks([
      link({ id: "neg", createdAt: "2026-03-02T00:00:00.000Z", amountCents: -1250 }),
      link({ id: "neg2", createdAt: "2026-03-03T00:00:00.000Z", amountCents: -1250 }),
      link({ id: "blank", createdAt: "2026-03-02T00:00:00.000Z", expenseDate: null }),
      link({ id: "blank2", createdAt: "2026-03-03T00:00:00.000Z", expenseDate: null }),
      link({ id: "other", createdAt: "2026-03-02T00:00:00.000Z", projectId: "other" }),
      link({ id: "split-a", createdAt: "2026-03-02T00:00:00.000Z", splitGroupId: "split" }),
      link({ id: "split-b", createdAt: "2026-03-03T00:00:00.000Z", splitGroupId: "split" }),
    ])
    for (const id of ["neg", "neg2", "blank", "blank2", "other", "split-a", "split-b"]) {
      assert.equal(planned.get(id), null)
    }
  })

  it("prefers a full receipt identity over an earlier amount-and-date match", () => {
    const identity = {
      receiptNumber: "1001",
      receiptTime: "14:30",
      paymentMethod: "visa",
      cardLast4: "4242",
    }
    const planned = planDuplicateLinks([
      link({ id: "amount-only", createdAt: "2026-03-01T00:00:00.000Z" }),
      link({ id: "identity-first", createdAt: "2026-03-02T00:00:00.000Z", ...identity }),
      link({ id: "identity-second", createdAt: "2026-03-03T00:00:00.000Z", ...identity }),
    ])
    assert.equal(planned.get("amount-only"), null)
    assert.equal(planned.get("identity-first"), "amount-only")
    assert.equal(planned.get("identity-second"), "identity-first")
  })
})
