import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseSignedAmount } from "./money.ts"
import { cropReceipt, pointInPolygon, type Point, type Raster } from "./receiptCrop.ts"

type Rgb = [number, number, number]

function create(width: number, height: number, color: Rgb): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color[0]
    data[index * 4 + 1] = color[1]
    data[index * 4 + 2] = color[2]
    data[index * 4 + 3] = 255
  }
  return { width, height, data }
}

function setPixel(raster: Raster, x: number, y: number, color: Rgb) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
  const index = (y * raster.width + x) * 4
  raster.data[index] = color[0]
  raster.data[index + 1] = color[1]
  raster.data[index + 2] = color[2]
  raster.data[index + 3] = 255
}

function fillPolygon(raster: Raster, polygon: Point[], color: Rgb | ((x: number, y: number) => Rgb)) {
  let minX = raster.width
  let minY = raster.height
  let maxX = 0
  let maxY = 0
  for (const point of polygon) {
    minX = Math.min(minX, Math.floor(point.x))
    minY = Math.min(minY, Math.floor(point.y))
    maxX = Math.max(maxX, Math.ceil(point.x))
    maxY = Math.max(maxY, Math.ceil(point.y))
  }
  for (let y = Math.max(0, minY); y <= Math.min(raster.height - 1, maxY); y += 1) {
    for (let x = Math.max(0, minX); x <= Math.min(raster.width - 1, maxX); x += 1) {
      if (!pointInPolygon({ x, y }, polygon)) continue
      setPixel(raster, x, y, typeof color === "function" ? color(x, y) : color)
    }
  }
}

function fillRect(raster: Raster, x: number, y: number, width: number, height: number, color: Rgb) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) setPixel(raster, col, row, color)
  }
}

function fillCircle(raster: Raster, cx: number, cy: number, radius: number, color: Rgb) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) setPixel(raster, x, y, color)
    }
  }
}

function pixel(raster: Raster, x: number, y: number) {
  const index = (y * raster.width + x) * 4
  return [raster.data[index], raster.data[index + 1], raster.data[index + 2]] as Rgb
}

function luminance(color: Rgb) {
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
}

function paperFraction(raster: Raster) {
  let paper = 0
  const total = raster.width * raster.height
  for (let index = 0; index < total; index += 1) {
    const base = index * 4
    const lum = raster.data[base] * 0.299 + raster.data[base + 1] * 0.587 + raster.data[base + 2] * 0.114
    if (lum > 150) paper += 1
  }
  return paper / total
}

function assertGrayscale(raster: Raster) {
  const step = Math.max(1, Math.floor((raster.width * raster.height) / 500))
  for (let index = 0; index < raster.width * raster.height; index += step) {
    const base = index * 4
    assert.equal(raster.data[base], raster.data[base + 1])
    assert.equal(raster.data[base + 1], raster.data[base + 2])
  }
}

function speckleFraction(raster: Raster) {
  let flips = 0
  let count = 0
  for (let y = 0; y < raster.height; y += 2) {
    for (let x = 0; x < raster.width - 1; x += 2) {
      const left = raster.data[(y * raster.width + x) * 4]
      const right = raster.data[(y * raster.width + x + 1) * 4]
      if (Math.abs(left - right) > 180) flips += 1
      count += 1
    }
  }
  return flips / Math.max(count, 1)
}

function lineBalance(raster: Raster) {
  const rows = new Float32Array(raster.height)
  const cols = new Float32Array(raster.width)
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (raster.data[(y * raster.width + x) * 4] > 80) continue
      rows[y] += 1
      cols[x] += 1
    }
  }
  const spread = (values: Float32Array) => {
    let mean = 0
    for (const value of values) mean += value
    mean /= values.length
    let sum = 0
    for (const value of values) sum += (value - mean) ** 2
    return sum / values.length
  }
  return { rowVar: spread(rows), colVar: spread(cols) }
}

function assertContains(corners: Point[], points: Point[], label: string) {
  for (const point of points) {
    assert.equal(pointInPolygon(point, corners), true, `${label} clipped text at ${point.x},${point.y}`)
  }
}

function insetColor(raster: Raster, fx: number, fy: number) {
  const x = Math.max(0, Math.min(raster.width - 1, Math.round(fx * (raster.width - 1))))
  const y = Math.max(0, Math.min(raster.height - 1, Math.round(fy * (raster.height - 1))))
  return pixel(raster, x, y)
}

const paper: Rgb = [246, 232, 206]
const ink: Rgb = [20, 16, 14]
const floor: Rgb = [28, 26, 24]

describe("signed receipt amounts", () => {
  it("treats parentheses and a leading minus as a return", () => {
    assert.equal(parseSignedAmount("(12.50)"), -12.5)
    assert.equal(parseSignedAmount("($12.50)"), -12.5)
    assert.equal(parseSignedAmount("-12.50"), -12.5)
    assert.equal(parseSignedAmount("-$12.50"), -12.5)
    assert.equal(parseSignedAmount(12.5), 12.5)
    assert.equal(parseSignedAmount(-4), -4)
    assert.equal(parseSignedAmount("12.50"), 12.5)
  })
})

describe("receipt crop", () => {
  it("crops a receipt on a dark floor without black-and-white noise", async () => {
    const photo = create(480, 360, floor)
    const quad: Point[] = [
      { x: 90, y: 40 },
      { x: 390, y: 55 },
      { x: 370, y: 310 },
      { x: 70, y: 295 },
    ]
    fillPolygon(photo, quad, paper)
    const text = [
      { x: 110, y: 80 },
      { x: 340, y: 90 },
      { x: 120, y: 270 },
      { x: 330, y: 275 },
    ]
    for (const point of text) fillRect(photo, point.x, point.y, 28, 4, ink)
    const cropped = await cropReceipt(photo)
    assert.equal(cropped.method, "auto")
    assert.equal(cropped.needsManualCrop, false)
    assert.ok(cropped.confidence > 0.5)
    assertContains(cropped.corners, text.map((point) => ({ x: point.x + 4, y: point.y + 2 })), "dark floor")
    assert.equal(pointInPolygon({ x: 8, y: 8 }, cropped.corners), false)
    assert.ok(paperFraction(cropped.image) > 0.72, `paper fraction ${paperFraction(cropped.image)}`)
    assert.ok(speckleFraction(cropped.image) < 0.08, `speckle fraction ${speckleFraction(cropped.image)}`)
    assertGrayscale(cropped.image)
    const center = insetColor(cropped.image, 0.5, 0.5)
    assert.ok(luminance(center) > 170, `paper went dark: ${center.join(",")}`)
    assert.ok(Math.max(cropped.image.width, cropped.image.height) <= 2000)
  })

  it("keeps the centered receipt when another receipt touches the edge", async () => {
    const photo = create(600, 400, [92, 64, 42])
    const main: Point[] = [
      { x: 150, y: 40 },
      { x: 400, y: 55 },
      { x: 385, y: 350 },
      { x: 135, y: 330 },
    ]
    fillPolygon(photo, main, paper)
    fillRect(photo, 470, 0, 130, 400, [250, 248, 242])
    const mainText = [
      { x: 180, y: 80 },
      { x: 340, y: 300 },
    ]
    for (const point of mainText) fillRect(photo, point.x, point.y, 36, 5, ink)
    fillRect(photo, 500, 40, 40, 8, ink)
    const cropped = await cropReceipt(photo)
    assert.notEqual(cropped.method, "none")
    assertContains(cropped.corners, mainText.map((point) => ({ x: point.x + 4, y: point.y + 2 })), "center receipt")
    assert.equal(pointInPolygon({ x: 530, y: 80 }, cropped.corners), false)
    const centerX = cropped.corners.reduce((sum, point) => sum + point.x, 0) / 4
    assert.ok(centerX < 430, `picked the edge receipt at x ${centerX}`)
  })

  it("perspective-corrects a skewed receipt", async () => {
    const photo = create(600, 420, floor)
    const quad: Point[] = [
      { x: 70, y: 30 },
      { x: 540, y: 70 },
      { x: 470, y: 370 },
      { x: 40, y: 300 },
    ]
    fillPolygon(photo, quad, paper)
    const text = [
      { x: 120, y: 90 },
      { x: 430, y: 120 },
      { x: 100, y: 250 },
      { x: 400, y: 300 },
    ]
    for (const point of text) fillRect(photo, point.x, point.y, 30, 4, ink)
    const cropped = await cropReceipt(photo)
    assert.equal(cropped.method, "auto")
    assertContains(cropped.corners, text.map((point) => ({ x: point.x + 6, y: point.y + 2 })), "skew")
    for (const spot of [
      [0.15, 0.15],
      [0.85, 0.15],
      [0.85, 0.85],
      [0.15, 0.85],
    ] as const) {
      const color = insetColor(cropped.image, spot[0], spot[1])
      assert.ok(luminance(color) > 160, `skew corner stayed background ${color.join(",")} at ${spot.join(",")}`)
    }
    assert.ok(paperFraction(cropped.image) > 0.75)
  })

  it("keeps text on both sides of a shadow", async () => {
    const photo = create(520, 380, floor)
    const quad: Point[] = [
      { x: 80, y: 36 },
      { x: 440, y: 48 },
      { x: 430, y: 340 },
      { x: 70, y: 328 },
    ]
    fillPolygon(photo, quad, (x) => {
      const shade = 158 + ((x - 70) / 370) * 88
      return [shade, shade * 0.97, shade * 0.9]
    })
    const text = [
      { x: 100, y: 80 },
      { x: 360, y: 90 },
      { x: 110, y: 280 },
      { x: 350, y: 290 },
    ]
    for (const point of text) fillRect(photo, point.x, point.y, 34, 5, ink)
    const cropped = await cropReceipt(photo)
    assert.notEqual(cropped.method, "none")
    assertContains(cropped.corners, text.map((point) => ({ x: point.x + 4, y: point.y + 2 })), "shadow")
    assert.ok(speckleFraction(cropped.image) < 0.12, `speckle fraction ${speckleFraction(cropped.image)}`)
    assertGrayscale(cropped.image)
    const center = insetColor(cropped.image, 0.5, 0.5)
    assert.ok(luminance(center) > 140)
  })

  it("does not cut handwriting on a crumpled edge", async () => {
    const photo = create(420, 460, floor)
    fillRect(photo, 70, 50, 230, 340, paper)
    fillCircle(photo, 300, 220, 42, paper)
    fillRect(photo, 100, 90, 40, 5, ink)
    fillRect(photo, 312, 210, 12, 12, ink)
    const cropped = await cropReceipt(photo)
    assert.notEqual(cropped.method, "none")
    assertContains(
      cropped.corners,
      [
        { x: 110, y: 92 },
        { x: 316, y: 214 },
      ],
      "crumpled",
    )
  })

  it("keeps the original when no paper is confident", async () => {
    const photo = create(360, 280, floor)
    fillRect(photo, 40, 40, 36, 28, paper)
    const cropped = await cropReceipt(photo)
    assert.equal(cropped.method, "none")
    assert.equal(cropped.needsManualCrop, true)
    assert.equal(cropped.confidence, 0)
    assert.equal(cropped.image.width, photo.width)
    assert.equal(cropped.image.height, photo.height)
    assert.equal(pointInPolygon({ x: 40, y: 40 }, cropped.corners), true)
    assert.equal(pointInPolygon({ x: 300, y: 200 }, cropped.corners), true)
    assertGrayscale(cropped.image)
  })

  it("turns sideways writing upright", async () => {
    const photo = create(480, 360, floor)
    const quad: Point[] = [
      { x: 80, y: 40 },
      { x: 400, y: 50 },
      { x: 390, y: 310 },
      { x: 70, y: 300 },
    ]
    fillPolygon(photo, quad, paper)
    for (const x of [150, 190, 230, 270, 310]) fillRect(photo, x, 80, 5, 170, ink)
    const cropped = await cropReceipt(photo)
    assert.notEqual(cropped.method, "none")
    assertContains(
      cropped.corners,
      [150, 190, 230, 270, 310].map((x) => ({ x: x + 2, y: 160 })),
      "sideways",
    )
    const lines = lineBalance(cropped.image)
    assert.ok(lines.rowVar > lines.colVar * 1.3, `still sideways row ${lines.rowVar} col ${lines.colVar}`)
    assertGrayscale(cropped.image)
    assert.ok(speckleFraction(cropped.image) < 0.1)
  })
})
