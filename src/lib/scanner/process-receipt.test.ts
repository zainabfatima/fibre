import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  bordersAreClean,
  flattenPage,
  insetTowardCenter,
  orderQuad,
  quadIsStable,
  quadShift,
  rotateGray,
  trimDarkBounds,
  uprightQuarter,
  whitenPaper,
} from "./process-receipt.ts"

describe("receipt document scan", () => {
  it("treats a still quad as stable and a jump as not", () => {
    const quad = [
      { x: 10, y: 10 },
      { x: 200, y: 12 },
      { x: 198, y: 400 },
      { x: 8, y: 398 },
    ]
    const nudged = quad.map((point) => ({ x: point.x + 1, y: point.y }))
    assert.equal(quadIsStable(quadShift(quad, nudged, 1000)), true)
    const jumped = quad.map((point) => ({ x: point.x + 40, y: point.y }))
    assert.equal(quadIsStable(quadShift(quad, jumped, 1000)), false)
  })

  it("orders corners and insets them toward the center", () => {
    const ordered = orderQuad([
      { x: 10, y: 90 },
      { x: 10, y: 10 },
      { x: 80, y: 90 },
      { x: 80, y: 12 },
    ])
    assert.deepEqual(ordered[0], { x: 10, y: 10 })
    assert.deepEqual(ordered[2], { x: 80, y: 90 })
    const inset = insetTowardCenter(ordered, 0.5)
    assert.ok(inset[0].x > ordered[0].x && inset[0].y > ordered[0].y)
    assert.ok(inset[2].x < ordered[2].x && inset[2].y < ordered[2].y)
  })

  it("trims a dark table border and rejects a border that is still dark", () => {
    const width = 100
    const height = 80
    const gray = new Uint8Array(width * height)
    gray.fill(240)
    for (let y = 0; y < 4; y += 1) gray.fill(20, y * width, (y + 1) * width)
    const bounds = trimDarkBounds(gray, width, height)
    assert.equal(bounds.y, 4)
    assert.equal(bounds.height, height - 4)
    assert.equal(bordersAreClean(gray, width, height).verified, false)

    const clean = new Uint8Array(width * height)
    clean.fill(240)
    assert.equal(bordersAreClean(clean, width, height).verified, true)

    const page = new Uint8Array(width * height)
    page.fill(210)
    for (let y = 0; y < 6; y += 1) page.fill(12, y * width, (y + 1) * width)
    for (let x = 20; x < 55; x += 1) page[(height - 4) * width + x] = 18
    const kept = trimDarkBounds(page, width, height)
    assert.equal(kept.y, 6)
    assert.equal(kept.y + kept.height, height)
  })

  it("turns shaded gray paper white and keeps dark text dark", () => {
    const shaded = new Uint8Array(100)
    for (let index = 0; index < shaded.length; index += 1) shaded[index] = 140 + (index % 50)
    whitenPaper(shaded)
    assert.ok(shaded.every((value) => value === 255))

    const page = new Uint8Array(200)
    page.fill(175)
    for (let index = 0; index < 12; index += 1) page[index] = 32
    whitenPaper(page)
    assert.equal(page[40], 255)
    assert.ok(page[0] < 80, `text became ${page[0]}`)
  })

  it("lifts shaded speckled paper to white and keeps ink black", () => {
    const width = 160
    const height = 120
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const shade = 115 + (x / width) * 75
        const speckle = ((x * 13 + y * 7) % 19) - 9
        pixels[y * width + x] = Math.max(0, Math.min(255, Math.round(shade + speckle)))
      }
    }
    for (let y = 48; y < 54; y += 1) {
      for (let x = 24; x < 110; x += 1) pixels[y * width + x] = 30
    }
    flattenPage(pixels, width, height)
    assert.equal(pixels[12 * width + 20], 255)
    assert.equal(pixels[12 * width + 140], 255)
    assert.ok(pixels[50 * width + 60] < 50, `ink became ${pixels[50 * width + 60]}`)
    let gray = 0
    for (let index = 0; index < pixels.length; index += 1) {
      if (pixels[index] > 40 && pixels[index] < 250) gray += 1
    }
    assert.ok(gray / pixels.length < 0.02, `speckle fraction ${gray / pixels.length}`)
  })

  it("turns a sideways receipt so the lines read left to right", () => {
    const width = 220
    const height = 150
    const pixels = new Uint8Array(width * height)
    pixels.fill(236)
    for (const x0 of [36, 72, 108, 144]) {
      for (let y = 18; y < 132; y += 1) {
        for (let dx = 0; dx < 6; dx += 1) pixels[y * width + x0 + dx] = 22
      }
    }
    const turns = uprightQuarter(pixels, width, height)
    const turned = rotateGray(pixels, width, height, turns)
    const lines = lineVariance(turned.data, turned.width, turned.height)
    assert.ok(lines.rowVar > lines.colVar * 1.3, `still sideways row ${lines.rowVar} col ${lines.colVar} turns ${turns}`)
    assert.ok(turns % 2 === 1)
  })

  it("flips upside-down lines right side up without cropping them", () => {
    const width = 180
    const height = 200
    const upsideDown = receiptLines(width, height, true)
    const turns = uprightQuarter(upsideDown, width, height)
    assert.equal(turns, 2)
    const turned = rotateGray(upsideDown, width, height, turns)
    assert.equal(turned.width, width)
    assert.equal(turned.height, height)
    assert.ok(turned.data[(height - 1 - 30) * width + (width - 1 - 40)] < 80)
    const upright = receiptLines(width, height, false)
    assert.equal(uprightQuarter(upright, width, height), 0)
  })
})

function receiptLines(width: number, height: number, heavyAtTop: boolean) {
  const pixels = new Uint8Array(width * height)
  pixels.fill(238)
  for (const y0 of [28, 70, 112, 154]) {
    for (let row = 0; row < 14; row += 1) {
      const heavy = heavyAtTop ? row < 5 : row > 8
      const step = heavy ? 2 : 3
      for (let x = 16; x < width - 16; x += step) pixels[(y0 + row) * width + x] = 18
    }
  }
  return pixels
}

function lineVariance(pixels: Uint8Array, width: number, height: number) {
  const rows = new Float32Array(height)
  const cols = new Float32Array(width)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] > 80) continue
      rows[y] += 1
      cols[x] += 1
    }
  }
  return { rowVar: varianceOf(rows), colVar: varianceOf(cols) }
}

function varianceOf(values: Float32Array) {
  let mean = 0
  for (const value of values) mean += value
  mean /= Math.max(values.length, 1)
  let sum = 0
  for (const value of values) sum += (value - mean) * (value - mean)
  return sum / Math.max(values.length, 1)
}
