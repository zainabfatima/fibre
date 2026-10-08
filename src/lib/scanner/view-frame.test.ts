import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { defaultViewFrame, dragFrameCorner, moveFrame, viewCornersToSource, visibleSourceRect } from "./view-frame.ts"

describe("camera picture frame", () => {
  it("drops the side strips a tall phone preview hides from a wide camera", () => {
    const visible = visibleSourceRect(4000, 3000, 390, 844)
    assert.ok(visible.x > 1000, `left crop ${visible.x}`)
    assert.ok(visible.x + visible.width < 3000, `right edge ${visible.x + visible.width}`)
    assert.equal(visible.y, 0)

    const corners = viewCornersToSource(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      4000,
      3000,
      390,
      844,
    )
    assert.ok(corners[0].x > 1000)
    assert.ok(corners[1].x < 3000)
    assert.ok(corners[0].x < corners[1].x)
  })

  it("keeps a dragged corner inside the preview and rejects a collapsed frame", () => {
    const pulled = dragFrameCorner(defaultViewFrame, 0, { x: -0.4, y: 0.2 })
    assert.equal(pulled[0].x, 0)
    assert.equal(pulled[0].y, 0.2)
    const collapsed = dragFrameCorner(defaultViewFrame, 0, { x: 0.94, y: 0.72 })
    assert.deepEqual(collapsed, defaultViewFrame)
  })

  it("moves the whole frame without sliding it off the preview", () => {
    const moved = moveFrame(defaultViewFrame, 0.5, -1)
    assert.ok(moved.every((point) => point.x <= 1 && point.y >= 0))
    assert.equal(Math.max(...moved.map((point) => point.x)), 1)
    assert.equal(Math.min(...moved.map((point) => point.y)), 0)
  })
})
