import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { detectReceipt } from "./detect.ts"
import { enhanceReceipt } from "./enhance.ts"
import { distance, orderCorners } from "./geometry.ts"
import { loadOpenCV } from "./opencvLoader.ts"
import type { CvMat, OpenCv, Point } from "./types.ts"
import { warpReceipt } from "./warp.ts"

function rgbaMat(cv: OpenCv, width: number, height: number, color: [number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color[0]
    data[index * 4 + 1] = color[1]
    data[index * 4 + 2] = color[2]
    data[index * 4 + 3] = 255
  }
  return cv.matFromArray(height, width, cv.CV_8UC4, data)
}

function paint(mat: CvMat, polygon: Point[], color: [number, number, number] | ((x: number, y: number) => [number, number, number])) {
  let minX = mat.cols
  let minY = mat.rows
  let maxX = 0
  let maxY = 0
  for (const point of polygon) {
    minX = Math.min(minX, Math.floor(point.x))
    minY = Math.min(minY, Math.floor(point.y))
    maxX = Math.max(maxX, Math.ceil(point.x))
    maxY = Math.max(maxY, Math.ceil(point.y))
  }
  for (let y = Math.max(0, minY); y <= Math.min(mat.rows - 1, maxY); y += 1) {
    for (let x = Math.max(0, minX); x <= Math.min(mat.cols - 1, maxX); x += 1) {
      if (!inside({ x, y }, polygon)) continue
      const shade = typeof color === "function" ? color(x, y) : color
      const index = (y * mat.cols + x) * mat.channels()
      mat.data[index] = shade[0]
      mat.data[index + 1] = shade[1]
      mat.data[index + 2] = shade[2]
    }
  }
}

function inside(point: Point, polygon: Point[]) {
  let hit = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]
    const prior = polygon[previous]
    const crosses = current.y > point.y !== prior.y > point.y
    if (!crosses) continue
    const x = ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y + 0.00001) + current.x
    if (point.x < x) hit = !hit
  }
  return hit
}

function mean(mat: CvMat, x0: number, y0: number, x1: number, y1: number) {
  let total = 0
  let count = 0
  const channels = mat.channels()
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const index = (y * mat.cols + x) * channels
      total += mat.data[index]
      count += 1
    }
  }
  return total / Math.max(1, count)
}

describe("receipt scanner", { timeout: 120_000 }, () => {
  it("orders corners from the image axes and does not swap them for aspect ratio", () => {
    const ordered = orderCorners([
      { x: 10, y: 80 },
      { x: 200, y: 20 },
      { x: 180, y: 300 },
      { x: 30, y: 260 },
    ])
    assert.deepEqual(ordered[0], { x: 10, y: 80 })
    assert.ok(ordered[1].x > ordered[0].x)
    assert.ok(ordered[2].x + ordered[2].y > ordered[0].x + ordered[0].y)
    assert.ok(distance(ordered[0], ordered[1]) > distance(ordered[0], ordered[3]) || distance(ordered[0], ordered[1]) < distance(ordered[0], ordered[3]))
  })

  it("crops a receipt on a dark table and keeps the shot orientation", async () => {
    const cv = await loadOpenCV()
    const photo = rgbaMat(cv, 640, 480, [24, 22, 20])
    const quad: Point[] = [
      { x: 80, y: 60 },
      { x: 520, y: 70 },
      { x: 500, y: 400 },
      { x: 90, y: 390 },
    ]
    paint(photo, quad, [220, 214, 200])
    for (let y = 120; y < 140; y += 1) {
      for (let x = 140; x < 420; x += 1) {
        const index = (y * photo.cols + x) * 4
        photo.data[index] = 20
        photo.data[index + 1] = 20
        photo.data[index + 2] = 20
      }
    }
    const corners = detectReceipt(cv, photo)
    assert.ok(corners, "receipt was not detected")
    const warped = warpReceipt(cv, photo, corners)
    try {
      assert.ok(warped.cols > warped.rows * 0.9, `width ${warped.cols} height ${warped.rows} was rotated`)
      assert.ok(mean(warped, 2, 2, 12, 12) > 180, "background remained in the crop")
      assert.ok(mean(warped, warped.cols - 12, warped.rows - 12, warped.cols - 2, warped.rows - 2) > 180)
      const scan = enhanceReceipt(cv, warped, "scan")
      try {
        assert.equal(scan.image.channels(), 1)
        assert.ok(mean(scan.image, 4, 4, 20, 20) > 200, "paper was not whitened")
        assert.equal(scan.glareSevere, false)
      } finally {
        scan.image.delete()
      }
    } finally {
      warped.delete()
      photo.delete()
    }
  })

  it("keeps a tall receipt tall", async () => {
    const cv = await loadOpenCV()
    const photo = rgbaMat(cv, 480, 800, [18, 18, 18])
    const quad: Point[] = [
      { x: 90, y: 40 },
      { x: 390, y: 50 },
      { x: 380, y: 740 },
      { x: 100, y: 730 },
    ]
    paint(photo, quad, [250, 248, 244])
    const corners = detectReceipt(cv, photo)
    assert.ok(corners)
    const warped = warpReceipt(cv, photo, corners)
    try {
      assert.ok(warped.rows > warped.cols, `tall receipt became ${warped.cols}x${warped.rows}`)
    } finally {
      warped.delete()
      photo.delete()
    }
  })

  it("lifts a phone shadow without hard black and white", async () => {
    const cv = await loadOpenCV()
    const photo = rgbaMat(cv, 500, 360, [20, 20, 20])
    const quad: Point[] = [
      { x: 40, y: 30 },
      { x: 460, y: 36 },
      { x: 450, y: 320 },
      { x: 48, y: 310 },
    ]
    paint(photo, quad, (x) => {
      const shade = 110 + ((x - 40) / 420) * 130
      return [shade, shade, shade]
    })
    const corners = detectReceipt(cv, photo)
    assert.ok(corners)
    const warped = warpReceipt(cv, photo, corners)
    const scan = enhanceReceipt(cv, warped, "scan")
    try {
      const left = mean(scan.image, 8, 20, 40, scan.image.rows - 20)
      const right = mean(scan.image, scan.image.cols - 40, 20, scan.image.cols - 8, scan.image.rows - 20)
      assert.ok(left > 170, `shadow stayed dark at ${left}`)
      assert.ok(Math.abs(left - right) < 50, `shadow remained left ${left} right ${right}`)
    } finally {
      scan.image.delete()
      warped.delete()
      photo.delete()
    }
  })

  it("reports mild glare and does not require a detection when the table is white", async () => {
    const cv = await loadOpenCV()
    const photo = rgbaMat(cv, 400, 300, [248, 248, 248])
    const quad: Point[] = [
      { x: 70, y: 40 },
      { x: 330, y: 48 },
      { x: 320, y: 250 },
      { x: 80, y: 244 },
    ]
    paint(photo, quad, [236, 236, 236])
    const corners = detectReceipt(cv, photo)
    assert.equal(corners, null)

    const glared = rgbaMat(cv, 360, 260, [30, 30, 30])
    const paper: Point[] = [
      { x: 30, y: 24 },
      { x: 330, y: 28 },
      { x: 324, y: 230 },
      { x: 36, y: 226 },
    ]
    paint(glared, paper, [214, 210, 202])
    for (let y = 70; y < 110; y += 1) {
      for (let x = 140; x < 190; x += 1) {
        const index = (y * glared.cols + x) * 4
        glared.data[index] = 255
        glared.data[index + 1] = 255
        glared.data[index + 2] = 255
      }
    }
    const found = detectReceipt(cv, glared)
    assert.ok(found)
    const warped = warpReceipt(cv, glared, found)
    const scan = enhanceReceipt(cv, warped, "scan")
    try {
      assert.ok(scan.glareRatio > 0, "glare was not measured")
      assert.equal(scan.glareSevere, false)
      assert.ok(mean(scan.image, 8, 8, 24, 24) > 180)
      const color = enhanceReceipt(cv, warped, "color")
      try {
        assert.equal(color.image.channels(), 3)
        assert.ok(mean(color.image, 8, 8, 24, 24) > 160)
      } finally {
        color.image.delete()
      }
    } finally {
      scan.image.delete()
      warped.delete()
      glared.delete()
      photo.delete()
    }
  })
})
