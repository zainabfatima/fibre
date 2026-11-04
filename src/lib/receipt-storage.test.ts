import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isReceiptPathForProject, planReceiptPaths, samePathList } from "./receipt-storage.ts"

const projectId = "11111111-1111-4111-8111-111111111111"
const id = "22222222-2222-4222-8222-222222222222"

describe("receipt storage paths", () => {
  it("plans the scan, the uncropped original, and the thumbnail", () => {
    const plan = planReceiptPaths(projectId, id, "image", 1, true)
    assert.deepEqual(plan, {
      filePath: `${projectId}/0/${id}.jpg`,
      originals: [`originals/${projectId}/${id}.jpg`],
      thumbPath: `${projectId}/thumbs/${id}.webp`,
    })
  })

  it("keeps several originals in page order without rotating the names", () => {
    const plan = planReceiptPaths(projectId, id, "image", 2, false)
    assert.deepEqual(plan?.originals, [
      `originals/${projectId}/${id}-p1.jpg`,
      `originals/${projectId}/${id}-p2.jpg`,
    ])
    assert.equal(plan?.thumbPath, null)
  })

  it("rejects a path that is not one of the planned receipt files", () => {
    const plan = planReceiptPaths(projectId, id, "pdf", 0, false)
    assert.equal(plan?.filePath, `${projectId}/0/${id}.pdf`)
    assert.equal(samePathList(plan?.originals ?? [], []), true)
    assert.equal(planReceiptPaths("not-a-project", id, "image", 1, true), null)
    assert.equal(planReceiptPaths(projectId, id, "image", 1.5, true), null)
    assert.equal(isReceiptPathForProject(projectId, `../${projectId}/0/${id}.jpg`), false)
    assert.equal(isReceiptPathForProject(projectId, `${projectId}/0/${id}.jpg`), true)
  })
})
