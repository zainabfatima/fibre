import assert from "node:assert/strict"
import test from "node:test"

import { groupProgressPictures, orderProgressPictures } from "./progress-pictures.ts"

test("latest picture leads, then earlier pictures stay in upload order", () => {
  const ordered = orderProgressPictures([
    { id: "b", createdAt: "2026-10-02T00:00:00.000Z" },
    { id: "c", createdAt: "2026-10-03T00:00:00.000Z" },
    { id: "a", createdAt: "2026-10-01T00:00:00.000Z" },
  ])
  assert.deepEqual(
    ordered.map((picture) => picture.id),
    ["c", "a", "b"],
  )
})

test("categories stay in code order", () => {
  const groups = groupProgressPictures([
    {
      id: "framing-old",
      categoryId: 2,
      categoryCode: 20,
      categoryName: "Framing",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "electrical",
      categoryId: 1,
      categoryCode: 10,
      categoryName: "Electrical",
      createdAt: "2026-10-04T00:00:00.000Z",
    },
    {
      id: "framing-new",
      categoryId: 2,
      categoryCode: 20,
      categoryName: "Framing",
      createdAt: "2026-10-03T00:00:00.000Z",
    },
  ])
  assert.deepEqual(
    groups.map((group) => ({
      name: group.categoryName,
      ids: group.pictures.map((picture) => picture.id),
    })),
    [
      { name: "Electrical", ids: ["electrical"] },
      { name: "Framing", ids: ["framing-new", "framing-old"] },
    ],
  )
})
