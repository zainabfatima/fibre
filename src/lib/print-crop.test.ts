import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildImagePrintHtml, cropDarkOuterBorder, mapPrintCrop } from "./print-crop.ts"

function gray(width: number, height: number, value: number) {
  const pixels = new Uint8Array(width * height)
  pixels.fill(value)
  return pixels
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  value: number,
) {
  for (let row = y; row < y + rectHeight; row += 1) {
    pixels.fill(value, row * width + x, row * width + x + rectWidth)
  }
}

describe("print crop", () => {
  it("drops inset side bars and keeps binder holes and rules", () => {
    const width = 200
    const height = 180
    const pixels = gray(width, height, 255)
    fillRect(pixels, width, 8, 0, 16, height, 12)
    fillRect(pixels, width, 178, 0, 15, height, 110)
    fillRect(pixels, width, 0, 3, width, 10, 70)
    fillRect(pixels, width, 36, 88, 140, 2, 0)
    fillRect(pixels, width, 30, 48, 6, 6, 0)
    fillRect(pixels, width, 30, 130, 6, 6, 0)

    const rect = cropDarkOuterBorder(pixels, width, height)
    assert.ok(rect.x >= 24 && rect.x < 30, `left ${rect.x}`)
    assert.ok(rect.x + rect.width <= 178, `right ${rect.x + rect.width}`)
    assert.ok(rect.x + rect.width > 160, `right ${rect.x + rect.width}`)
    assert.ok(rect.y > 12 && rect.y < 30, `top ${rect.y}`)
    assert.equal(rect.y + rect.height, height)
    assert.ok(rect.x < 30 && rect.x + rect.width > 36, "binder hole was cropped off")
    assert.ok(rect.y < 88 && rect.y + rect.height > 90, "rule was cropped off")
    assert.equal(pixels[15 * width + 10], 12)
  })

  it("drops a dark border that sits on the image edge", () => {
    const width = 80
    const height = 60
    const pixels = gray(width, height, 230)
    fillRect(pixels, width, 0, 0, 8, height, 0)
    fillRect(pixels, width, 72, 0, 8, height, 0)
    fillRect(pixels, width, 0, 0, width, 6, 0)
    fillRect(pixels, width, 0, 54, width, 6, 0)
    pixels[20 * width + 20] = 0

    const rect = cropDarkOuterBorder(pixels, width, height)
    assert.ok(rect.x >= 8 && rect.x <= 10, `x ${rect.x}`)
    assert.ok(rect.y >= 6 && rect.y <= 8, `y ${rect.y}`)
    assert.ok(rect.x + rect.width <= 72, `right ${rect.x + rect.width}`)
    assert.ok(rect.y + rect.height <= 54, `bottom ${rect.y + rect.height}`)
    assert.ok(rect.x < 20 && rect.y < 20)
    assert.ok(rect.x + rect.width > 20 && rect.y + rect.height > 20)
  })

  it("leaves a page that is already paper", () => {
    const pixels = gray(100, 80, 220)
    const rect = cropDarkOuterBorder(pixels, 100, 80)
    assert.deepEqual(rect, { x: 0, y: 0, width: 100, height: 80 })
  })

  it("keeps a text rule and does not split the page", () => {
    const width = 100
    const height = 100
    const pixels = gray(width, height, 250)
    fillRect(pixels, width, 0, 50, width, 3, 0)
    const rect = cropDarkOuterBorder(pixels, width, height)
    assert.deepEqual(rect, { x: 0, y: 0, width: 100, height: 100 })
  })

  it("drops thick side bars when most of the frame is dark", () => {
    const width = 100
    const height = 40
    const pixels = gray(width, height, 245)
    fillRect(pixels, width, 0, 0, 25, height, 10)
    fillRect(pixels, width, 75, 0, 25, height, 10)
    const rect = cropDarkOuterBorder(pixels, width, height)
    assert.ok(rect.x >= 24 && rect.x <= 26, `x ${rect.x}`)
    assert.ok(rect.x + rect.width <= 76 && rect.x + rect.width >= 74, `right ${rect.x + rect.width}`)
    assert.equal(rect.y, 0)
    assert.equal(rect.height, height)
  })

  it("does not crop an image that is dark all the way through", () => {
    const pixels = gray(40, 30, 15)
    assert.deepEqual(cropDarkOuterBorder(pixels, 40, 30), { x: 0, y: 0, width: 40, height: 30 })
  })

  it("reads RGBA the same way as gray", () => {
    const width = 80
    const height = 40
    const grayPixels = gray(width, height, 240)
    fillRect(grayPixels, width, 0, 0, 10, height, 5)
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < grayPixels.length; index += 1) {
      rgba[index * 4] = grayPixels[index]
      rgba[index * 4 + 1] = grayPixels[index]
      rgba[index * 4 + 2] = grayPixels[index]
      rgba[index * 4 + 3] = 255
    }
    assert.deepEqual(
      cropDarkOuterBorder(rgba, width, height, 4),
      cropDarkOuterBorder(grayPixels, width, height, 1),
    )
  })

  it("maps a downscaled crop back onto the source", () => {
    assert.deepEqual(mapPrintCrop({ x: 0, y: 0, width: 100, height: 50 }, 200, 100, 100, 50), {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    })
    const mapped = mapPrintCrop({ x: 10, y: 0, width: 80, height: 50 }, 200, 100, 100, 50)
    assert.ok(mapped.x >= 20 && mapped.x <= 24, `x ${mapped.x}`)
    assert.ok(mapped.width < 170, `width ${mapped.width}`)
  })

  it("builds a white print page that crops before printing", () => {
    const html = buildImagePrintHtml(`/r/expense-1`)
    assert.match(html, /background:\s*#fff/)
    assert.match(html, /@page \{ margin: 0\.4in; \}/)
    assert.match(html, /cropDarkOuterBorder/)
    assert.doesNotMatch(html, /background:\s*#000/)
    assert.doesNotMatch(html, /background:\s*black/)
    const run = new Function(`return (${cropDarkOuterBorder.toString()})`)() as typeof cropDarkOuterBorder
    const pixels = gray(40, 30, 240)
    assert.deepEqual(run(pixels, 40, 30, 1), cropDarkOuterBorder(pixels, 40, 30, 1))
  })
})
