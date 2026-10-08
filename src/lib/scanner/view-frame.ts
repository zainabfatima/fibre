import type { Point } from "./types"

/** Default picture frame, as fractions of the on-screen camera preview. */
export const defaultViewFrame: Point[] = [
  { x: 0.06, y: 0.24 },
  { x: 0.94, y: 0.24 },
  { x: 0.94, y: 0.72 },
  { x: 0.06, y: 0.72 },
]

/**
 * The part of the camera image that `object-cover` actually shows.
 * A wide sensor in a tall phone view hides the left and right edges.
 */
export function visibleSourceRect(sourceWidth: number, sourceHeight: number, viewWidth: number, viewHeight: number) {
  const safeViewW = Math.max(1, viewWidth)
  const safeViewH = Math.max(1, viewHeight)
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight)
  const viewAspect = safeViewW / safeViewH
  if (sourceAspect > viewAspect) {
    const width = sourceHeight * viewAspect
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight }
  }
  const height = sourceWidth / viewAspect
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height }
}

/** Map corners from the on-screen preview (0–1) into camera-image pixels. */
export function viewCornersToSource(
  corners: Point[],
  sourceWidth: number,
  sourceHeight: number,
  viewWidth: number,
  viewHeight: number,
): Point[] {
  const visible = visibleSourceRect(sourceWidth, sourceHeight, viewWidth, viewHeight)
  const maxX = Math.max(0, sourceWidth - 1)
  const maxY = Math.max(0, sourceHeight - 1)
  return corners.map((point) => ({
    x: clamp(visible.x + clamp01(point.x) * visible.width, 0, maxX),
    y: clamp(visible.y + clamp01(point.y) * visible.height, 0, maxY),
  }))
}

export function dragFrameCorner(frame: Point[], index: number, point: Point): Point[] {
  if (index < 0 || index >= frame.length) return frame
  const next = frame.map((corner, cornerIndex) =>
    cornerIndex === index ? { x: clamp01(point.x), y: clamp01(point.y) } : corner,
  )
  return quadIsUsable(next) ? next : frame
}

export function moveFrame(origin: Point[], dx: number, dy: number): Point[] {
  if (!quadIsUsable(origin)) return origin
  const minX = Math.min(...origin.map((point) => point.x))
  const maxX = Math.max(...origin.map((point) => point.x))
  const minY = Math.min(...origin.map((point) => point.y))
  const maxY = Math.max(...origin.map((point) => point.y))
  const shiftX = clamp(dx, -minX, 1 - maxX)
  const shiftY = clamp(dy, -minY, 1 - maxY)
  return origin.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }))
}

function quadIsUsable(points: Point[]) {
  if (points.length !== 4) return false
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false
  if (polygonArea(points) < 0.04) return false
  return isConvex(points)
}

function polygonArea(points: Point[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    sum += points[index].x * next.y - next.x * points[index].y
  }
  return Math.abs(sum) / 2
}

function isConvex(points: Point[]) {
  let sign = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const after = points[(index + 2) % points.length]
    const cross = (next.x - current.x) * (after.y - next.y) - (next.y - current.y) * (after.x - next.x)
    if (Math.abs(cross) < 1e-6) continue
    const nextSign = Math.sign(cross)
    if (sign && nextSign !== sign) return false
    sign = nextSign
  }
  return sign !== 0
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
