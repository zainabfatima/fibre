/**
 * Receipt crop: find the paper, perspective-correct it, and drop the background.
 *
 * Detection follows the usual document scan:
 * downscale → grayscale → blur → Canny → dilate → contours → 4-point quad.
 * OpenCV.js is loaded only in the browser and only adds contour candidates.
 * If it fails to load, the built-in detector still runs. The saved scan is
 * clean black and white (not a noisy threshold) and rotated so the text is upright.
 */

export type Point = { x: number; y: number }

export type CropMethod = "auto" | "fallback" | "manual" | "none"

export type Raster = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type CropDetection = {
  image: Raster
  corners: Point[]
  method: CropMethod
  confidence: number
  needsManualCrop: boolean
}

export type CropResult = CropDetection & {
  blob: Blob
}

const DETECT_LONG_SIDE = 1000
const EXPORT_LONG_SIDE = 2000
const DECODE_LONG_SIDE = 4096
const OPENCV_SRC = "https://docs.opencv.org/4.10.0/opencv.js"

type CvMat = {
  rows: number
  data32S: Int32Array
  delete: () => void
}

type CvApi = {
  Mat: new () => CvMat & { delete: () => void }
  MatVector: new () => { size: () => number; get: (index: number) => CvMat; delete: () => void }
  Size: new (width: number, height: number) => unknown
  CV_8UC1: number
  COLOR_RGBA2GRAY?: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number
  MORPH_RECT: number
  matFromArray: (rows: number, cols: number, type: number, array: Uint8Array) => CvMat
  GaussianBlur: (src: CvMat, dst: CvMat, size: unknown, sigma: number) => void
  Canny: (src: CvMat, dst: CvMat, low: number, high: number) => void
  dilate: (src: CvMat, dst: CvMat, kernel: CvMat) => void
  getStructuringElement: (shape: number, size: unknown) => CvMat
  findContours: (src: CvMat, contours: { size: () => number }, hierarchy: CvMat, mode: number, method: number) => void
  arcLength: (contour: CvMat, closed: boolean) => number
  approxPolyDP: (curve: CvMat, approx: CvMat, epsilon: number, closed: boolean) => void
  contourArea: (contour: CvMat, oriented?: boolean) => number
  onRuntimeInitialized?: () => void
  calledRun?: boolean
}

let openCvPromise: Promise<CvApi | null> | null = null

export function fullFrameCorners(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: Math.max(0, width - 1), y: 0 },
    { x: Math.max(0, width - 1), y: Math.max(0, height - 1) },
    { x: 0, y: Math.max(0, height - 1) },
  ]
}

export function orderCorners(points: Point[]): Point[] {
  if (points.length !== 4) return points.slice(0, 4)
  const sums = points.map((point) => point.x + point.y)
  const diffs = points.map((point) => point.y - point.x)
  const tl = points[indexOfMin(sums)]
  const br = points[indexOfMax(sums)]
  const tr = points[indexOfMin(diffs)]
  const bl = points[indexOfMax(diffs)]
  return [tl, tr, br, bl]
}

export function polygonArea(points: Point[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    sum += points[index].x * next.y - next.x * points[index].y
  }
  return Math.abs(sum) / 2
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]
    const b = polygon[previous]
    const crosses = a.y > point.y !== b.y > point.y
    if (!crosses) continue
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 0.00001) + a.x
    if (point.x < x) inside = !inside
  }
  return inside
}

export function cornersAreUsable(corners: Point[]) {
  if (corners.length !== 4) return false
  if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false
  if (polygonArea(corners) < 64) return false
  return isConvex(orderCorners(corners))
}

export async function loadOpenCv(timeoutMs = 8000): Promise<CvApi | null> {
  if (typeof window === "undefined") return null
  const ready = readOpenCv()
  if (ready) return ready
  if (!openCvPromise) openCvPromise = injectOpenCv()
  return Promise.race([
    openCvPromise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
}

export async function cropReceipt(raster: Raster): Promise<CropDetection> {
  if (raster.width < 2 || raster.height < 2) return noneResult(raster)
  const found = await findDocument(raster)
  if (found.method === "none") return noneResult(raster)
  const safe = containInk(raster, found.corners)
  if (safe.gaveUp) return noneResult(raster)
  const warped = renderCrop(raster, safe.corners, found.method, found.confidence)
  if (meanLuminance(warped.image) < 12) return noneResult(raster)
  return warped
}

export function renderCrop(
  raster: Raster,
  corners: Point[],
  method: CropMethod,
  confidence = method === "manual" ? 1 : 0,
): CropDetection {
  const ordered = orderCorners(corners)
  if (method === "none" || !cornersAreUsable(ordered)) {
    return noneResult(raster)
  }
  const size = outputSize(ordered)
  const flat = warpRaster(raster, ordered, size.width, size.height)
  const image = scaleLongSide(cleanScan(orientUpright(flat)), EXPORT_LONG_SIDE)
  return {
    image,
    corners: ordered,
    method,
    confidence,
    needsManualCrop: false,
  }
}

export async function cropReceiptFile(file: Blob): Promise<CropResult> {
  const raster = await decodeReceiptFile(file)
  const cropped = await cropReceipt(raster)
  const blob = await rasterToJpegBlob(cropped.image, 0.85)
  return { ...cropped, blob }
}

export async function decodeReceiptFile(file: Blob): Promise<Raster> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot read the photo")
  }
  let blob = file
  const name = file instanceof File ? file.name.toLowerCase() : ""
  const type = file.type.toLowerCase()
  if (name.endsWith(".heic") || name.endsWith(".heif") || type.includes("heic") || type.includes("heif")) {
    try {
      const heic2any = (await import("heic2any")).default
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })
      blob = Array.isArray(converted) ? converted[0] : converted
    } catch {
      throw new Error("This HEIC photo could not be read. Export it as a JPEG and try again.")
    }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    throw new Error("This photo could not be opened")
  }
  const scale = Math.min(1, DECODE_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error("This photo could not be opened")
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const image = context.getImageData(0, 0, width, height)
  return { width, height, data: image.data }
}

export async function rasterToJpegBlob(raster: Raster, quality = 0.85) {
  const canvas = document.createElement("canvas")
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not prepare the receipt image")
  const copy = new Uint8ClampedArray(raster.data)
  context.putImageData(new ImageData(copy, raster.width, raster.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  if (!blob) throw new Error("Could not save the receipt image")
  return blob
}

export function rasterToDataUrl(raster: Raster, maxSide = 900, quality = 0.8) {
  const sized = scaleLongSide(raster, maxSide)
  const canvas = document.createElement("canvas")
  canvas.width = sized.width
  canvas.height = sized.height
  const context = canvas.getContext("2d")
  if (!context) return ""
  context.putImageData(new ImageData(new Uint8ClampedArray(sized.data), sized.width, sized.height), 0, 0)
  return canvas.toDataURL("image/jpeg", quality)
}

export function rotateRaster(raster: Raster, turns: number): Raster {
  const quarter = ((turns % 4) + 4) % 4
  if (quarter === 0) return raster
  const width = quarter % 2 === 0 ? raster.width : raster.height
  const height = quarter % 2 === 0 ? raster.height : raster.width
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      let nx = x
      let ny = y
      if (quarter === 1) {
        nx = raster.height - 1 - y
        ny = x
      } else if (quarter === 2) {
        nx = raster.width - 1 - x
        ny = raster.height - 1 - y
      } else {
        nx = y
        ny = raster.width - 1 - x
      }
      const from = (y * raster.width + x) * 4
      data.set(raster.data.subarray(from, from + 4), (ny * width + nx) * 4)
    }
  }
  return { width, height, data }
}

export function scaleLongSide(raster: Raster, maxSide: number): Raster {
  const longSide = Math.max(raster.width, raster.height)
  if (longSide <= maxSide) return raster
  const scale = maxSide / longSide
  return resize(raster, Math.max(1, Math.round(raster.width * scale)), Math.max(1, Math.round(raster.height * scale)))
}

export function warpRaster(raster: Raster, corners: Point[], width = outputSize(corners).width, height = outputSize(corners).height) {
  const dest = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]
  const map = homography(dest, orderCorners(corners))
  const data = new Uint8ClampedArray(width * height * 4)
  if (!map) return { width, height, data }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = map
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const weight = h6 * x + h7 * y + 1
      const sx = (h0 * x + h1 * y + h2) / weight
      const sy = (h3 * x + h4 * y + h5) / weight
      const pixel = sample(raster, sx, sy)
      data.set(pixel, (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

export function cornersNear(a: Point[], b: Point[], tolerance: number) {
  if (a.length !== 4 || b.length !== 4) return false
  const left = orderCorners(a)
  const right = orderCorners(b)
  return left.every((point, index) => Math.hypot(point.x - right[index].x, point.y - right[index].y) <= tolerance)
}

async function findDocument(raster: Raster): Promise<{ corners: Point[]; method: CropMethod; confidence: number }> {
  const working = downscaleBox(raster, DETECT_LONG_SIDE)
  const scaleX = raster.width / working.width
  const scaleY = raster.height / working.height
  const quads: Point[][] = []
  const cv = await loadOpenCv(1800)
  if (cv) {
    try {
      quads.push(...openCvQuads(cv, working))
    } catch {
      // OpenCV can fail on a single frame. The built-in detector still runs.
    }
  }
  quads.push(...builtinQuads(working))
  const picked = pickQuad(quads, working.width, working.height)
  if (picked) {
    const safe = containInk(working, expandCorners(picked.corners, 0.02, working.width, working.height))
    if (safe.gaveUp) {
      return { corners: fullFrameCorners(raster.width, raster.height), method: "none", confidence: 0 }
    }
    return {
      corners: scaleCorners(safe.corners, scaleX, scaleY),
      method: "auto",
      confidence: picked.confidence,
    }
  }
  const bright = largestBrightRect(working)
  if (!bright) return { corners: fullFrameCorners(raster.width, raster.height), method: "none", confidence: 0 }
  const expanded = containInk(working, expandCorners(bright, 0.02, working.width, working.height))
  if (expanded.gaveUp) return { corners: fullFrameCorners(raster.width, raster.height), method: "none", confidence: 0 }
  const area = polygonArea(expanded.corners) / (working.width * working.height)
  if (area > 0.96) return { corners: fullFrameCorners(raster.width, raster.height), method: "none", confidence: 0 }
  return {
    corners: scaleCorners(expanded.corners, scaleX, scaleY),
    method: "fallback",
    confidence: 0.42,
  }
}

function builtinQuads(raster: Raster) {
  const gray = grayscale(raster)
  const edges = dilateBinary(canny(gray, raster.width, raster.height), raster.width, raster.height, 2)
  return quadsFromBinary(edges, raster.width, raster.height)
}

function quadsFromBinary(binary: Uint8Array, width: number, height: number) {
  const groups = findContours(binary, width, height)
  const quads: Point[][] = []
  const ranked = groups
    .map((points) => ({ points, hull: convexHull(points) }))
    .sort((a, b) => polygonArea(b.hull) - polygonArea(a.hull))
    .slice(0, 12)
  for (const group of ranked) {
    const contour = boundaryLoop(group.points, width, height) ?? group.hull
    const quad = quadFromContour(contour) ?? (group.hull.length >= 4 ? quadFromContour(group.hull) : null)
    if (quad) quads.push(quad)
  }
  return quads
}

function pickQuad(quads: Point[][], width: number, height: number) {
  const imageArea = width * height
  const center = { x: width / 2, y: height / 2 }
  const diagonal = Math.hypot(width, height)
  const candidates = quads
    .map((quad) => orderCorners(quad))
    .filter((quad) => quad.length === 4 && isReasonableQuad(quad, width, height))
    .map((quad) => {
      const area = polygonArea(quad)
      const centroid = polygonCentroid(quad)
      return {
        corners: quad,
        area,
        dist: Math.hypot(centroid.x - center.x, centroid.y - center.y) / diagonal,
        confidence: quadConfidence(quad, imageArea),
      }
    })
    .filter((candidate) => candidate.area > imageArea * 0.2 && borderSides(candidate.corners, width, height) < 2)
  if (candidates.length === 0) return null
  const largest = Math.max(...candidates.map((candidate) => candidate.area))
  const large = candidates.filter((candidate) => candidate.area >= largest * 0.65)
  large.sort((a, b) => a.dist - b.dist || b.area - a.area)
  return large[0] ?? null
}

function largestBrightRect(raster: Raster) {
  const mask = paperMask(raster)
  if (!mask) return null
  const groups = connectedComponents(mask, raster.width, raster.height)
    .map((points) => boundsOf(points))
    .filter((box) => box.area > raster.width * raster.height * 0.15)
    .filter((box) => borderSides(rectPoints(box), raster.width, raster.height) < 2)
    .sort((a, b) => b.area - a.area)
  const box = groups[0]
  if (!box) return null
  return rectPoints(box)
}

function containInk(raster: Raster, corners: Point[]) {
  const mask = paperMask(raster)
  const nearPaper = mask ? inkInside(mask, corners, raster.width, raster.height) : null
  const ink = nearPaper ? inkBounds(raster, nearPaper) : null
  if (!ink) return { corners, gaveUp: false }
  const pad = Math.max(2, Math.round(Math.min(raster.width, raster.height) * 0.008))
  const targets = [
    { x: ink.minX - pad, y: ink.minY - pad },
    { x: ink.maxX + pad, y: ink.minY - pad },
    { x: ink.maxX + pad, y: ink.maxY + pad },
    { x: ink.minX - pad, y: ink.maxY + pad },
  ]
  let current = corners.map((point) => ({ ...point }))
  for (let step = 0; step < 8; step += 1) {
    if (targets.every((point) => pointInPolygon(point, current))) return { corners: current, gaveUp: false }
    current = expandCorners(current, 0.025, raster.width, raster.height)
  }
  if (targets.every((point) => pointInPolygon(point, current))) return { corners: current, gaveUp: false }
  const box = boundsOf([...current, ...targets])
  const rect = expandCorners(rectPoints(box), 0.01, raster.width, raster.height)
  if (polygonArea(rect) > raster.width * raster.height * 0.94) {
    return { corners: fullFrameCorners(raster.width, raster.height), gaveUp: true }
  }
  return { corners: rect, gaveUp: false }
}

function inkInside(mask: Uint8Array, corners: Point[], width: number, height: number) {
  const region = expandCorners(corners, 0.04, width, height)
  const local = new Uint8Array(mask.length)
  let count = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (!mask[index] || !pointInPolygon({ x, y }, region)) continue
      local[index] = 1
      count += 1
    }
  }
  return count > 12 ? local : null
}

function paperMask(raster: Raster) {
  const { width, height, data } = raster
  const mask = new Uint8Array(width * height)
  let count = 0
  for (let index = 0; index < mask.length; index += 1) {
    const base = index * 4
    if (!isPaperPixel(data[base], data[base + 1], data[base + 2])) continue
    mask[index] = 1
    count += 1
  }
  if (count < width * height * 0.05) return null
  const radius = Math.max(3, Math.round(Math.min(width, height) / 70))
  return closeBinary(mask, width, height, radius)
}

function isPaperPixel(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114
  const saturation = max === 0 ? 0 : (max - min) / max
  return luminance >= 140 && saturation <= 0.48
}

function inkBounds(raster: Raster, mask: Uint8Array) {
  const gray = grayscale(raster)
  const radius = Math.max(4, Math.round(Math.min(raster.width, raster.height) / 36))
  const local = boxBlur(gray, raster.width, raster.height, radius)
  let minX = raster.width
  let minY = raster.height
  let maxX = 0
  let maxY = 0
  let count = 0
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = y * raster.width + x
      if (!mask[index]) continue
      if (gray[index] > local[index] - 14 || gray[index] > 170) continue
      count += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (count < 12) return null
  return { minX, minY, maxX, maxY, area: count }
}

function noneResult(raster: Raster): CropDetection {
  return {
    image: scaleLongSide(cleanScan(raster), EXPORT_LONG_SIDE),
    corners: fullFrameCorners(raster.width, raster.height),
    method: "none",
    confidence: 0,
    needsManualCrop: true,
  }
}

function expandCorners(corners: Point[], ratio: number, width: number, height: number) {
  const center = polygonCentroid(corners)
  const distance = Math.hypot(width * ratio, height * ratio)
  return corners.map((point) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const length = Math.hypot(dx, dy) || 1
    return {
      x: point.x + (dx / length) * distance,
      y: point.y + (dy / length) * distance,
    }
  })
}

function scaleCorners(corners: Point[], scaleX: number, scaleY: number) {
  return corners.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }))
}

function quadFromContour(contour: Point[]) {
  if (contour.length < 4) return null
  const length = perimeter(contour)
  for (const factor of [0.02, 0.015, 0.03, 0.045, 0.06]) {
    const approx = approximateClosed(contour, Math.max(2, factor * length))
    if (approx.length === 4) return orderCorners(approx)
  }
  return null
}

function isReasonableQuad(corners: Point[], width: number, height: number) {
  if (!isConvex(corners)) return false
  const edges = [0, 1, 2, 3].map((index) => Math.hypot(
    corners[(index + 1) % 4].x - corners[index].x,
    corners[(index + 1) % 4].y - corners[index].y,
  ))
  const minEdge = Math.min(...edges)
  if (minEdge < Math.min(width, height) * 0.08) return false
  const ratio = Math.max(...edges) / Math.max(minEdge, 1)
  if (ratio > 8) return false
  return cornerAngles(corners).every((angle) => angle > 50 && angle < 130)
}

function quadConfidence(corners: Point[], imageArea: number) {
  const angles = cornerAngles(corners)
  const angleScore = angles.reduce((sum, angle) => sum + (1 - Math.min(1, Math.abs(angle - 90) / 40)), 0) / 4
  const areaRatio = polygonArea(corners) / imageArea
  const areaScore = areaRatio > 0.2 && areaRatio < 0.9 ? 1 : 0.55
  return Math.max(0.5, Math.min(0.97, 0.5 + angleScore * 0.35 + areaScore * 0.12))
}

function borderSides(points: Point[], width: number, height: number) {
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.012))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  let sides = 0
  if (Math.min(...xs) <= margin) sides += 1
  if (Math.min(...ys) <= margin) sides += 1
  if (Math.max(...xs) >= width - 1 - margin) sides += 1
  if (Math.max(...ys) >= height - 1 - margin) sides += 1
  return sides
}

function orientUpright(raster: Raster): Raster {
  const sample = downscaleBox(raster, 280)
  const score = projectionScores(sample)
  if (score.ink < 36) return raster
  const turned = projectionScores(rotateRaster(sample, 1))
  const uprightness = score.rowVar / (score.colVar + 1)
  const turnedUprightness = turned.rowVar / (turned.colVar + 1)
  if (Math.max(uprightness, turnedUprightness) < 1.35) return raster
  const quarter = turned.rowVar > score.rowVar * 1.12 ? 1 : 0
  const uprightSample = quarter === 0 ? sample : rotateRaster(sample, quarter)
  const lean = baselineLean(uprightSample)
  const flippedLean = baselineLean(rotateRaster(uprightSample, 2))
  const turns = flippedLean > lean + 0.06 ? (quarter + 2) % 4 : quarter
  const rotated = turns === 0 ? raster : rotateRaster(raster, turns)
  const angle = deskewAngle(downscaleBox(rotated, 240))
  if (Math.abs(angle) < 1.25) return rotated
  return rotateDegrees(rotated, angle)
}

function deskewAngle(sample: Raster) {
  const zero = projectionScores(sample).rowVar
  let best = 0
  let bestScore = zero
  for (let angle = -8; angle <= 8; angle += 1) {
    if (angle === 0) continue
    const score = projectionScores(rotateDegrees(sample, angle, false)).rowVar
    if (score > bestScore) {
      bestScore = score
      best = angle
    }
  }
  if (bestScore < zero * 1.12) return 0
  return best
}

function projectionScores(raster: Raster) {
  const mask = textInk(raster)
  const rows = new Float32Array(raster.height)
  const cols = new Float32Array(raster.width)
  let ink = 0
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (!mask[y * raster.width + x]) continue
      rows[y] += 1
      cols[x] += 1
      ink += 1
    }
  }
  return { rowVar: variance(rows), colVar: variance(cols), ink, rows }
}

function baselineLean(raster: Raster) {
  const { rows, ink } = projectionScores(raster)
  if (ink < 36) return 0
  let peak = 0
  for (const value of rows) if (value > peak) peak = value
  if (peak < 4) return 0
  const cutoff = peak * 0.4
  let lean = 0
  let bands = 0
  let y = 0
  while (y < raster.height) {
    if (rows[y] < cutoff) {
      y += 1
      continue
    }
    const start = y
    while (y < raster.height && rows[y] >= cutoff) y += 1
    const height = y - start
    if (height < 3) continue
    let mass = 0
    let moment = 0
    for (let row = start; row < y; row += 1) {
      mass += rows[row]
      moment += rows[row] * (row - start + 0.5)
    }
    if (mass < 8) continue
    lean += moment / mass / height - 0.5
    bands += 1
  }
  return bands === 0 ? 0 : lean / bands
}

function textInk(raster: Raster) {
  const gray = grayscale(raster)
  const radius = Math.max(3, Math.round(Math.min(raster.width, raster.height) / 28))
  const local = boxBlur(gray, raster.width, raster.height, radius)
  const mask = new Uint8Array(gray.length)
  for (let index = 0; index < gray.length; index += 1) {
    if (gray[index] < local[index] - 16 && gray[index] < 155) mask[index] = 1
  }
  return mask
}

function variance(values: Float32Array) {
  let mean = 0
  for (const value of values) mean += value
  mean /= Math.max(values.length, 1)
  let sum = 0
  for (const value of values) {
    const delta = value - mean
    sum += delta * delta
  }
  return sum / Math.max(values.length, 1)
}

function rotateDegrees(raster: Raster, degrees: number, expand = true): Raster {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const cx = (raster.width - 1) / 2
  const cy = (raster.height - 1) / 2
  const swung = [
    [-cx, -cy],
    [raster.width - 1 - cx, -cy],
    [raster.width - 1 - cx, raster.height - 1 - cy],
    [-cx, raster.height - 1 - cy],
  ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos])
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of swung) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const width = expand ? Math.max(1, Math.round(maxX - minX + 1)) : raster.width
  const height = expand ? Math.max(1, Math.round(maxY - minY + 1)) : raster.height
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const originX = (width - 1) / 2
  const originY = (height - 1) / 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - originX
      const dy = y - originY
      const sx = cos * dx + sin * dy + cx
      const sy = -sin * dx + cos * dy + cy
      if (sx < -0.5 || sy < -0.5 || sx > raster.width - 0.5 || sy > raster.height - 0.5) continue
      data.set(sample(raster, sx, sy), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function cleanScan(raster: Raster): Raster {
  const { width, height } = raster
  const gray = grayscale(raster)
  const soft = boxBlur(gray, width, height, 1)
  const radius = Math.max(8, Math.round(Math.min(width, height) / 22))
  const background = boxBlur(soft, width, height, radius)
  const lifted = new Float32Array(gray.length)
  for (let index = 0; index < gray.length; index += 1) {
    lifted[index] = (soft[index] / Math.max(background[index], 24)) * 242
  }
  const histogram = new Uint32Array(256)
  for (let index = 0; index < lifted.length; index += 1) histogram[clampByte(lifted[index])] += 1
  const total = lifted.length
  let seen = 0
  let low = 0
  let high = 255
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]
    if (seen >= total * 0.01) {
      low = value
      break
    }
  }
  seen = 0
  for (let value = 255; value >= 0; value -= 1) {
    seen += histogram[value]
    if (seen >= total * 0.01) {
      high = value
      break
    }
  }
  const span = Math.max(24, high - low)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < lifted.length; index += 1) {
    let value = ((lifted[index] - low) / span) * 255
    if (value > 208) value = 208 + (value - 208) * 1.45
    const byte = clampByte(value)
    const base = index * 4
    data[base] = byte
    data[base + 1] = byte
    data[base + 2] = byte
    data[base + 3] = 255
  }
  return { width, height, data }
}

function canny(gray: Float32Array, width: number, height: number) {
  const blurred = gaussianBlur(gray, width, height, 1.15)
  const magnitude = new Float32Array(width * height)
  const direction = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx =
        -blurred[index - width - 1] +
        blurred[index - width + 1] -
        2 * blurred[index - 1] +
        2 * blurred[index + 1] -
        blurred[index + width - 1] +
        blurred[index + width + 1]
      const gy =
        -blurred[index - width - 1] -
        2 * blurred[index - width] -
        blurred[index - width + 1] +
        blurred[index + width - 1] +
        2 * blurred[index + width] +
        blurred[index + width + 1]
      magnitude[index] = Math.hypot(gx, gy)
      const angle = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180
      if (angle < 22.5 || angle >= 157.5) direction[index] = 0
      else if (angle < 67.5) direction[index] = 1
      else if (angle < 112.5) direction[index] = 2
      else direction[index] = 3
    }
  }
  const kept = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      let before = 0
      let after = 0
      if (direction[index] === 0) {
        before = magnitude[index - 1]
        after = magnitude[index + 1]
      } else if (direction[index] === 1) {
        before = magnitude[index - width + 1]
        after = magnitude[index + width - 1]
      } else if (direction[index] === 2) {
        before = magnitude[index - width]
        after = magnitude[index + width]
      } else {
        before = magnitude[index - width - 1]
        after = magnitude[index + width + 1]
      }
      if (magnitude[index] >= before && magnitude[index] >= after) kept[index] = magnitude[index]
    }
  }
  const histogram = new Uint32Array(512)
  let total = 0
  for (let index = 0; index < kept.length; index += 2) {
    if (kept[index] < 12) continue
    histogram[Math.min(511, Math.floor(kept[index] / 4))] += 1
    total += 1
  }
  let high = 48
  if (total > 24) {
    let accumulated = 0
    for (let bin = 0; bin < histogram.length; bin += 1) {
      accumulated += histogram[bin]
      if (accumulated >= total * 0.62) {
        high = Math.max(24, Math.min(220, bin * 4))
        break
      }
    }
  }
  const low = high * 0.4
  const output = new Uint8Array(width * height)
  const stack: number[] = []
  for (let index = 0; index < kept.length; index += 1) {
    if (kept[index] >= high) {
      output[index] = 1
      stack.push(index)
    }
  }
  while (stack.length > 0) {
    const index = stack.pop() as number
    const x = index % width
    const y = (index - x) / width
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue
        const next = ny * width + nx
        if (output[next] || kept[next] < low) continue
        output[next] = 1
        stack.push(next)
      }
    }
  }
  return output
}

function findContours(binary: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(binary.length)
  const groups: Point[][] = []
  const neighbors = [1, -1, width, -width]
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || seen[start]) continue
    const points: Point[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const current = stack.pop() as number
      const x = current % width
      const y = (current - x) / width
      points.push({ x, y })
      for (const offset of neighbors) {
        if (offset === 1 && x + 1 >= width) continue
        if (offset === -1 && x === 0) continue
        const next = current + offset
        if (next < 0 || next >= width * height || seen[next] || !binary[next]) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    if (points.length > 30) groups.push(points)
  }
  return groups
}

function connectedComponents(binary: Uint8Array, width: number, height: number) {
  return findContours(binary, width, height)
}

function boundaryLoop(points: Point[], width: number, height: number) {
  if (points.length < 4) return null
  let start = points[0]
  const filled = new Uint8Array(width * height)
  for (const point of points) filled[point.y * width + point.x] = 1
  for (const point of points) {
    if (point.y < start.y || (point.y === start.y && point.x < start.x)) start = point
  }
  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ]
  const contour: Point[] = []
  let x = start.x
  let y = start.y
  let previous = 4
  const limit = Math.min(points.length * 2, width * height)
  for (let step = 0; step < limit; step += 1) {
    contour.push({ x, y })
    let found = false
    for (let turn = 0; turn < 8; turn += 1) {
      const direction = (previous + 1 + turn) % 8
      const nx = x + directions[direction][0]
      const ny = y + directions[direction][1]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (!filled[ny * width + nx]) continue
      previous = (direction + 4) % 8
      x = nx
      y = ny
      found = true
      break
    }
    if (!found) break
    if (contour.length > 2 && x === start.x && y === start.y) break
  }
  if (contour.length < 12) return null
  const stride = Math.max(1, Math.floor(contour.length / 900))
  return contour.filter((_, index) => index % stride === 0)
}

function approximateClosed(points: Point[], epsilon: number) {
  const unique = points[0] && points.length > 2 && samePoint(points[0], points[points.length - 1])
    ? points.slice(0, -1)
    : points
  if (unique.length < 3) return unique
  let far = 1
  let farDistance = -1
  for (let index = 1; index < unique.length; index += 1) {
    const distance = Math.hypot(unique[index].x - unique[0].x, unique[index].y - unique[0].y)
    if (distance > farDistance) {
      farDistance = distance
      far = index
    }
  }
  const left = rdp(unique.slice(0, far + 1), epsilon)
  const right = rdp(unique.slice(far).concat(unique[0]), epsilon)
  return left.slice(0, -1).concat(right.slice(0, -1))
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  let maxDistance = 0
  let index = 0
  const start = points[0]
  const end = points[points.length - 1]
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const distance = pointLineDistance(points[cursor], start, end)
    if (distance > maxDistance) {
      maxDistance = distance
      index = cursor
    }
  }
  if (maxDistance > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon)
    const right = rdp(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [start, end]
}

function convexHull(points: Point[]) {
  const stride = Math.max(1, Math.floor(points.length / 4000))
  const sampled = points.filter((point, index) => index % stride === 0)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let left = points[0]
  let right = points[0]
  let top = points[0]
  let bottom = points[0]
  for (const point of points) {
    if (point.x < minX) {
      minX = point.x
      left = point
    }
    if (point.x > maxX) {
      maxX = point.x
      right = point
    }
    if (point.y < minY) {
      minY = point.y
      top = point
    }
    if (point.y > maxY) {
      maxY = point.y
      bottom = point
    }
  }
  sampled.push(left, right, top, bottom)
  const sorted = sampled.sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (origin: Point, a: Point, b: Point) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function openCvQuads(cv: CvApi, raster: Raster) {
  const gray = grayscale(raster)
  const bytes = new Uint8Array(gray.length)
  for (let index = 0; index < gray.length; index += 1) bytes[index] = clampByte(gray[index])
  const source = cv.matFromArray(raster.height, raster.width, cv.CV_8UC1, bytes)
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const quads: Point[][] = []
  try {
    cv.GaussianBlur(source, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 40, 120)
    cv.dilate(edges, edges, kernel)
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index)
      const length = cv.arcLength(contour, true)
      const approx = new cv.Mat()
      try {
        cv.approxPolyDP(contour, approx, 0.02 * length, true)
        if (approx.rows === 4 && cv.contourArea(approx) > raster.width * raster.height * 0.2) {
          const values = approx.data32S
          quads.push(orderCorners([
            { x: values[0], y: values[1] },
            { x: values[2], y: values[3] },
            { x: values[4], y: values[5] },
            { x: values[6], y: values[7] },
          ]))
        }
      } finally {
        approx.delete()
        contour.delete()
      }
    }
  } finally {
    source.delete()
    blurred.delete()
    edges.delete()
    kernel.delete()
    contours.delete()
    hierarchy.delete()
  }
  return quads
}

function readOpenCv() {
  const candidate = (window as unknown as { cv?: CvApi }).cv
  if (!candidate || typeof candidate.GaussianBlur !== "function" || typeof candidate.matFromArray !== "function") return null
  return candidate
}

function injectOpenCv() {
  return new Promise<CvApi | null>((resolve) => {
    const existing = readOpenCv()
    if (existing) {
      resolve(existing)
      return
    }
    const script = document.createElement("script")
    script.src = OPENCV_SRC
    script.async = true
    let settled = false
    const finish = (value: CvApi | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    script.onerror = () => finish(null)
    script.onload = () => {
      const cv = (window as unknown as { cv?: CvApi }).cv
      if (!cv) {
        finish(null)
        return
      }
      if (typeof cv.GaussianBlur === "function") {
        finish(cv)
        return
      }
      const previous = cv.onRuntimeInitialized
      cv.onRuntimeInitialized = () => {
        previous?.()
        finish(readOpenCv())
      }
    }
    document.head.appendChild(script)
  })
}

function grayscale(raster: Raster) {
  const gray = new Float32Array(raster.width * raster.height)
  for (let index = 0; index < gray.length; index += 1) {
    const base = index * 4
    gray[index] = raster.data[base] * 0.299 + raster.data[base + 1] * 0.587 + raster.data[base + 2] * 0.114
  }
  return gray
}

function gaussianBlur(source: Float32Array, width: number, height: number, sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 2))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma))
    kernel[offset + radius] = weight
    sum += weight
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum
  const horizontal = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset))
        value += source[y * width + sampleX] * kernel[offset + radius]
      }
      horizontal[y * width + x] = value
    }
  }
  const output = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset))
        value += horizontal[sampleY * width + x] * kernel[offset + radius]
      }
      output[y * width + x] = value
    }
  }
  return output
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  const horizontal = new Float32Array(source.length)
  const window = radius * 2 + 1
  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let x = -radius; x <= radius; x += 1) sum += source[y * width + Math.max(0, Math.min(width - 1, x))]
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / window
      sum -= source[y * width + Math.max(0, x - radius)]
      sum += source[y * width + Math.min(width - 1, x + radius + 1)]
    }
  }
  const output = new Float32Array(source.length)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x]
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window
      sum -= horizontal[Math.max(0, y - radius) * width + x]
      sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x]
    }
  }
  return output
}

function dilateBinary(source: Uint8Array, width: number, height: number, radius: number) {
  return dilateVertical(dilateHorizontal(source, width, height, radius), width, height, radius)
}

function closeBinary(source: Uint8Array, width: number, height: number, radius: number) {
  return erodeBinary(dilateBinary(source, width, height, radius), width, height, radius)
}

function erodeBinary(source: Uint8Array, width: number, height: number, radius: number) {
  const inverted = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 1) inverted[index] = source[index] ? 0 : 1
  const dilated = dilateBinary(inverted, width, height, radius)
  for (let index = 0; index < dilated.length; index += 1) dilated[index] = dilated[index] ? 0 : 1
  return dilated
}

function dilateHorizontal(source: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(source.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let count = 0
    for (let x = 0; x <= radius && x < width; x += 1) count += source[row + x]
    for (let x = 0; x < width; x += 1) {
      output[row + x] = count > 0 ? 1 : 0
      const remove = x - radius
      const add = x + radius + 1
      if (remove >= 0) count -= source[row + remove]
      if (add < width) count += source[row + add]
    }
  }
  return output
}

function dilateVertical(source: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(source.length)
  for (let x = 0; x < width; x += 1) {
    let count = 0
    for (let y = 0; y <= radius && y < height; y += 1) count += source[y * width + x]
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = count > 0 ? 1 : 0
      const remove = y - radius
      const add = y + radius + 1
      if (remove >= 0) count -= source[remove * width + x]
      if (add < height) count += source[add * width + x]
    }
  }
  return output
}

function downscaleBox(raster: Raster, maxSide: number) {
  const longSide = Math.max(raster.width, raster.height)
  if (longSide <= maxSide) return raster
  const scale = maxSide / longSide
  const width = Math.max(1, Math.round(raster.width * scale))
  const height = Math.max(1, Math.round(raster.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * raster.height) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * raster.height) / height))
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * raster.width) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * raster.width) / width))
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * raster.width + sx) * 4
          red += raster.data[index]
          green += raster.data[index + 1]
          blue += raster.data[index + 2]
          count += 1
        }
      }
      const output = (y * width + x) * 4
      data[output] = red / count
      data[output + 1] = green / count
      data[output + 2] = blue / count
      data[output + 3] = 255
    }
  }
  return { width, height, data }
}

function resize(raster: Raster, width: number, height: number): Raster {
  if (raster.width === width && raster.height === height) return raster
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = sample(raster, ((x + 0.5) * raster.width) / width - 0.5, ((y + 0.5) * raster.height) / height - 0.5)
      data.set(pixel, (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function outputSize(corners: Point[]) {
  const ordered = orderCorners(corners)
  const width = Math.max(
    1,
    Math.round((distance(ordered[0], ordered[1]) + distance(ordered[3], ordered[2])) / 2),
  )
  const height = Math.max(
    1,
    Math.round((distance(ordered[0], ordered[3]) + distance(ordered[1], ordered[2])) / 2),
  )
  const longSide = Math.max(width, height)
  if (longSide <= EXPORT_LONG_SIDE) return { width, height }
  const scale = EXPORT_LONG_SIDE / longSide
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function sample(raster: Raster, x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(raster.width - 1, x0 + 1)
  const y1 = Math.min(raster.height - 1, y0 + 1)
  const dx = x - x0
  const dy = y - y0
  const pixel = (px: number, py: number) => {
    const clampedX = Math.max(0, Math.min(raster.width - 1, px))
    const clampedY = Math.max(0, Math.min(raster.height - 1, py))
    const index = (clampedY * raster.width + clampedX) * 4
    return [raster.data[index], raster.data[index + 1], raster.data[index + 2], 255]
  }
  const a = pixel(x0, y0)
  const b = pixel(x1, y0)
  const c = pixel(x0, y1)
  const d = pixel(x1, y1)
  return [0, 1, 2, 3].map((channel) => {
    const top = a[channel] * (1 - dx) + b[channel] * dx
    const bottom = c[channel] * (1 - dx) + d[channel] * dx
    return clampByte(top * (1 - dy) + bottom * dy)
  })
}

function homography(from: Point[], to: Point[]) {
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index]
    const { x: u, y: v } = to[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  }
  return solve(matrix, values)
}

function solve(matrix: number[][], values: number[]) {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]])
  for (let col = 0; col < size; col += 1) {
    let pivot = col
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    }
    if (Math.abs(rows[pivot][col]) < 1e-8) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    const divisor = rows[col][col]
    for (let cell = col; cell <= size; cell += 1) rows[col][cell] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue
      const factor = rows[row][col]
      for (let cell = col; cell <= size; cell += 1) rows[row][cell] -= factor * rows[col][cell]
    }
  }
  return rows.map((row) => row[size])
}

function rectPoints(box: { minX: number; minY: number; maxX: number; maxY: number }): Point[] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]
}

function boundsOf(points: Point[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, maxX, maxY, area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) }
}

function polygonCentroid(points: Point[]) {
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length
  return { x, y }
}

function perimeter(points: Point[]) {
  let length = 0
  for (let index = 0; index < points.length; index += 1) {
    length += distance(points[index], points[(index + 1) % points.length])
  }
  return length
}

function cornerAngles(corners: Point[]) {
  return corners.map((corner, index) => {
    const previous = corners[(index + 3) % 4]
    const next = corners[(index + 1) % 4]
    const ax = previous.x - corner.x
    const ay = previous.y - corner.y
    const bx = next.x - corner.x
    const by = next.y - corner.y
    const dot = ax * bx + ay * by
    const magnitude = Math.hypot(ax, ay) * Math.hypot(bx, by)
    if (magnitude < 1e-6) return 0
    return (Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180) / Math.PI
  })
}

function isConvex(points: Point[]) {
  let sign = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const c = points[(index + 2) % points.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-3) continue
    const next = Math.sign(cross)
    if (sign === 0) sign = next
    else if (next !== sign) return false
  }
  return true
}

function pointLineDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return Math.hypot(point.x - start.x, point.y - start.y)
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function meanLuminance(raster: Raster) {
  let sum = 0
  const step = Math.max(1, Math.floor((raster.width * raster.height) / 4000))
  let count = 0
  for (let index = 0; index < raster.width * raster.height; index += step) {
    const base = index * 4
    sum += raster.data[base] * 0.299 + raster.data[base + 1] * 0.587 + raster.data[base + 2] * 0.114
    count += 1
  }
  return sum / Math.max(count, 1)
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

function indexOfMin(values: number[]) {
  let index = 0
  for (let cursor = 1; cursor < values.length; cursor += 1) {
    if (values[cursor] < values[index]) index = cursor
  }
  return index
}

function indexOfMax(values: number[]) {
  let index = 0
  for (let cursor = 1; cursor < values.length; cursor += 1) {
    if (values[cursor] > values[index]) index = cursor
  }
  return index
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}
