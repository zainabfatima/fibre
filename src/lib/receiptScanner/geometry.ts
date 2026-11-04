import type { Point } from "@/lib/receiptScanner/types"

export function orderCorners(points: Point[]): Point[] {
  if (points.length !== 4) return points.slice(0, 4)
  const topLeft = points.reduce((best, point) => (point.x + point.y < best.x + best.y ? point : best))
  const bottomRight = points.reduce((best, point) => (point.x + point.y > best.x + best.y ? point : best))
  const topRight = points.reduce((best, point) => (point.y - point.x < best.y - best.x ? point : best))
  const bottomLeft = points.reduce((best, point) => (point.y - point.x > best.y - best.x ? point : best))
  return [topLeft, topRight, bottomRight, bottomLeft]
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function insetCorners(width: number, height: number, fraction = 0.05): Point[] {
  const x = width * fraction
  const y = height * fraction
  return orderCorners([
    { x, y },
    { x: Math.max(x + 1, width - 1 - x), y },
    { x: Math.max(x + 1, width - 1 - x), y: Math.max(y + 1, height - 1 - y) },
    { x, y: Math.max(y + 1, height - 1 - y) },
  ])
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]
    const prior = polygon[previous]
    const crosses = current.y > point.y !== prior.y > point.y
    if (!crosses) continue
    const x = ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y + 0.00001) + current.x
    if (point.x < x) inside = !inside
  }
  return inside
}

export function glareRatioInQuad(image: ImageData, corners: Point[]) {
  if (corners.length !== 4) return 0
  let glare = 0
  let seen = 0
  const step = 2
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      if (!pointInPolygon({ x, y }, corners)) continue
      const index = (y * image.width + x) * 4
      const red = image.data[index] / 255
      const green = image.data[index + 1] / 255
      const blue = image.data[index + 2] / 255
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      const saturation = max === 0 ? 0 : ((max - min) / max) * 255
      const value = max * 255
      seen += 1
      if (value > 235 && saturation < 25) glare += 1
    }
  }
  return seen === 0 ? 0 : glare / seen
}

export function cornersAreStable(previous: Point[] | null, next: Point[], frameWidth: number) {
  if (!previous || previous.length !== next.length) return false
  const limit = frameWidth * 0.02
  return next.every((point, index) => distance(point, previous[index]) < limit)
}
