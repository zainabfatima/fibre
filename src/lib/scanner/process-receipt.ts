/**
 * Document scan for a receipt on a dark table.
 * OpenCV.js (from the CDN) finds the paper, warps it flat, trims leftover table,
 * turns the text upright, then whitens the page. Every Mat created here is deleted.
 */

export type ScanPoint = { x: number; y: number }

export type ProcessedReceipt = {
  blob: Blob
  verified: boolean
  corners: ScanPoint[] | null
  width: number
  height: number
  /** Highest dark-pixel share among the four border bands. Lower is cleaner. */
  borderDark: number
}

type CvMat = {
  rows: number
  cols: number
  data: Uint8Array
  data32S: Int32Array
  delete: () => void
  clone: () => CvMat
  ucharPtr: (row: number) => Uint8Array
}

type MatVector = {
  size: () => number
  get: (index: number) => CvMat
  delete: () => void
}

type RotatedRect = {
  center: ScanPoint
  size: { width: number; height: number }
  angle: number
}

export type ScannerCv = {
  Mat: new () => CvMat
  MatVector: new () => MatVector
  Size: new (width: number, height: number) => unknown
  CV_8UC1: number
  CV_8UC4: number
  CV_32FC2: number
  COLOR_RGBA2GRAY: number
  COLOR_GRAY2RGBA: number
  THRESH_BINARY: number
  THRESH_OTSU: number
  MORPH_RECT: number
  MORPH_CLOSE: number
  MORPH_OPEN: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number
  INTER_LINEAR: number
  BORDER_REPLICATE: number
  imread: (canvas: HTMLCanvasElement) => CvMat
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void
  GaussianBlur: (src: CvMat, dst: CvMat, size: unknown, sigma: number) => void
  threshold: (src: CvMat, dst: CvMat, thresh: number, max: number, type: number) => number
  getStructuringElement: (shape: number, size: unknown) => CvMat
  morphologyEx: (src: CvMat, dst: CvMat, op: number, kernel: CvMat) => void
  Canny: (src: CvMat, dst: CvMat, low: number, high: number) => void
  dilate: (src: CvMat, dst: CvMat, kernel: CvMat) => void
  findContours: (src: CvMat, contours: MatVector, hierarchy: CvMat, mode: number, method: number) => void
  contourArea: (contour: CvMat) => number
  arcLength: (contour: CvMat, closed: boolean) => number
  approxPolyDP: (curve: CvMat, approx: CvMat, epsilon: number, closed: boolean) => void
  minAreaRect: (contour: CvMat) => RotatedRect
  matFromArray: (rows: number, cols: number, type: number, array: ArrayLike<number>) => CvMat
  getPerspectiveTransform: (src: CvMat, dst: CvMat) => CvMat
  warpPerspective: (
    src: CvMat,
    dst: CvMat,
    transform: CvMat,
    size: unknown,
    flags?: number,
    borderMode?: number,
  ) => void
  medianBlur: (src: CvMat, dst: CvMat, ksize: number) => void
  divide: (src1: CvMat, src2: CvMat, dst: CvMat, scale: number, dtype?: number) => void
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void
}

export type DetectedQuad = {
  corners: ScanPoint[]
  areaRatio: number
}

const DARK = 70

export function orderQuad(points: ScanPoint[]): ScanPoint[] {
  if (points.length !== 4) return points.slice(0, 4)
  const sums = points.map((point) => point.x + point.y)
  const diffs = points.map((point) => point.y - point.x)
  return [
    points[indexOfMin(sums)],
    points[indexOfMin(diffs)],
    points[indexOfMax(sums)],
    points[indexOfMax(diffs)],
  ]
}

/** Largest corner travel, as a fraction of the frame width. */
export function quadShift(previous: ScanPoint[], next: ScanPoint[], width: number) {
  const before = orderQuad(previous)
  const after = orderQuad(next)
  let max = 0
  for (let index = 0; index < 4; index += 1) {
    max = Math.max(max, Math.hypot(before[index].x - after[index].x, before[index].y - after[index].y))
  }
  return max / Math.max(width, 1)
}

export function quadIsStable(shift: number) {
  return shift < 0.015
}

export function insetTowardCenter(points: ScanPoint[], ratio = 0.006): ScanPoint[] {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
  return points.map((point) => ({
    x: point.x + (center.x - point.x) * ratio,
    y: point.y + (center.y - point.y) * ratio,
  }))
}

export function trimDarkBounds(gray: Uint8Array, width: number, height: number) {
  const maxX = Math.floor(width * 0.08)
  const maxY = Math.floor(height * 0.08)
  let top = 0
  let bottom = height - 1
  let left = 0
  let right = width - 1
  while (top < maxY && rowDarkRatio(gray, width, top, left, right) > 0.4) top += 1
  while (bottom > height - 1 - maxY && bottom > top && rowDarkRatio(gray, width, bottom, left, right) > 0.4) bottom -= 1
  while (left < maxX && colDarkRatio(gray, width, left, top, bottom) > 0.4) left += 1
  while (right > width - 1 - maxX && right > left && colDarkRatio(gray, width, right, top, bottom) > 0.4) right -= 1
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

export function bordersAreClean(gray: Uint8Array, width: number, height: number) {
  const bandX = Math.max(1, Math.round(width * 0.015))
  const bandY = Math.max(1, Math.round(height * 0.015))
  const ratios = [
    regionDarkRatio(gray, width, 0, 0, width, bandY),
    regionDarkRatio(gray, width, 0, height - bandY, width, bandY),
    regionDarkRatio(gray, width, 0, 0, bandX, height),
    regionDarkRatio(gray, width, width - bandX, 0, bandX, height),
  ]
  const borderDark = Math.max(...ratios)
  return { verified: ratios.every((ratio) => ratio < 0.08), borderDark }
}

export function detectReceiptQuad(cv: ScannerCv, src: CvMat): DetectedQuad | null {
  const primary = detectFromMask(cv, src, "otsu")
  if (primary) return primary
  return detectFromMask(cv, src, "canny")
}

export async function processReceipt(cv: ScannerCv, imageOrCanvas: CanvasImageSource): Promise<ProcessedReceipt> {
  const canvas = await imageSourceCanvas(imageOrCanvas)
  const source = cv.imread(canvas)
  const owned: CvMat[] = [source]
  try {
    const detected = detectReceiptQuad(cv, source)
    let page = source
    let corners: ScanPoint[] | null = null
    if (detected) {
      corners = detected.corners
      const first = warpToQuad(cv, source, orderQuad(detected.corners))
      owned.push(first)
      page = first
      const again = detectReceiptQuad(cv, first)
      // Only shave a thin leftover border. A tighter quad would cut off the total.
      if (again && again.areaRatio >= 0.88 && again.areaRatio <= 0.97) {
        const second = warpToQuad(cv, first, orderQuad(again.corners))
        owned.push(second)
        page = second
        corners = again.corners
      }
    }
    const gray = toGray(cv, page)
    owned.push(gray)
    const packed = packedGray(gray)
    const bounds = trimDarkBounds(packed.data, packed.width, packed.height)
    const trimmed = cropPacked(packed.data, packed.width, bounds)
    const check = bordersAreClean(trimmed.data, trimmed.width, trimmed.height)
    const turned = rotateGray(
      trimmed.data,
      trimmed.width,
      trimmed.height,
      uprightQuarter(trimmed.data, trimmed.width, trimmed.height),
    )
    const grayPage = cv.matFromArray(turned.height, turned.width, cv.CV_8UC1, turned.data)
    owned.push(grayPage)
    const enhanced = enhanceScan(cv, grayPage)
    owned.push(enhanced)
    const blob = await grayToJpeg(cv, enhanced)
    return {
      blob,
      verified: detected ? check.verified : false,
      corners,
      width: enhanced.cols,
      height: enhanced.rows,
      borderDark: detected ? check.borderDark : 1,
    }
  } finally {
    release(owned)
  }
}

function detectFromMask(cv: ScannerCv, src: CvMat, kind: "otsu" | "canny"): DetectedQuad | null {
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const mask = new cv.Mat()
  const morphed = new cv.Mat()
  const opened = kind === "otsu" ? new cv.Mat() : null
  const kernel = oddKernel(cv, src.cols, src.rows, kind === "otsu" ? 80 : 100)
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const owned: Array<CvMat | null> = [gray, blurred, mask, morphed, opened, kernel, hierarchy]
  try {
    toGrayInto(cv, src, gray)
    const blur = oddSize(Math.max(5, Math.round(Math.min(src.cols, src.rows) / 200)))
    cv.GaussianBlur(gray, blurred, new cv.Size(blur, blur), 0)
    if (kind === "otsu") {
      cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
      cv.morphologyEx(mask, morphed, cv.MORPH_CLOSE, kernel)
      cv.morphologyEx(morphed, opened as CvMat, cv.MORPH_OPEN, kernel)
    } else {
      cv.Canny(blurred, mask, 50, 150)
      cv.dilate(mask, morphed, kernel)
    }
    const binary = kind === "otsu" ? (opened as CvMat) : morphed
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    return largestQuad(cv, contours, src.cols * src.rows)
  } finally {
    contours.delete()
    release(owned)
  }
}

function largestQuad(cv: ScannerCv, contours: MatVector, frameArea: number): DetectedQuad | null {
  let best: CvMat | null = null
  let bestArea = 0
  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index)
    const area = cv.contourArea(contour)
    const ratio = area / Math.max(frameArea, 1)
    if (ratio < 0.15 || ratio > 0.98 || area <= bestArea) {
      contour.delete()
      continue
    }
    best?.delete()
    best = contour
    bestArea = area
  }
  if (!best) return null
  const areaRatio = bestArea / Math.max(frameArea, 1)
  const approx = new cv.Mat()
  try {
    const perimeter = cv.arcLength(best, true)
    cv.approxPolyDP(best, approx, Math.max(2, 0.02 * perimeter), true)
    const sampled = pointsFromApprox(approx)
    if (sampled.length === 4 && isConvexQuad(sampled)) {
      return { corners: orderQuad(sampled), areaRatio }
    }
    return { corners: orderQuad(boxPoints(cv.minAreaRect(best))), areaRatio }
  } finally {
    approx.delete()
    best.delete()
  }
}

function warpToQuad(cv: ScannerCv, src: CvMat, corners: ScanPoint[]) {
  const ordered = orderQuad(corners)
  const width = Math.max(
    1,
    Math.round(Math.max(distance(ordered[0], ordered[1]), distance(ordered[3], ordered[2]))),
  )
  const height = Math.max(
    1,
    Math.round(Math.max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2]))),
  )
  const sourcePts = cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flatMap((point) => [point.x, point.y]))
  const destPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1])
  const transform = cv.getPerspectiveTransform(sourcePts, destPts)
  const warped = new cv.Mat()
  try {
    cv.warpPerspective(
      src,
      warped,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    )
    return warped
  } catch (cause) {
    warped.delete()
    throw cause
  } finally {
    release([sourcePts, destPts, transform])
  }
}

function enhanceScan(cv: ScannerCv, gray: CvMat) {
  if (gray.cols < 3 || gray.rows < 3) return gray.clone()
  const packed = packedGray(gray)
  flattenPage(packed.data, packed.width, packed.height)
  return cv.matFromArray(packed.height, packed.width, cv.CV_8UC1, packed.data)
}

/**
 * Lift a cropped page onto white paper.
 * A coarse paper estimate (large block, not grain) removes shade, then the
 * divide is stretched so the page is white. Ink stays black. Grain is not amplified.
 */
export function flattenPage(pixels: Uint8Array, width: number, height: number) {
  if (width < 3 || height < 3 || pixels.length < width * height) return
  const background = smoothPaper(pixels, width, height)
  for (let index = 0; index < pixels.length; index += 1) {
    const bg = Math.max(1, background[index])
    pixels[index] = Math.min(255, Math.round((pixels[index] * 255) / bg))
  }
  whitenPaper(pixels)
}

/** Turn a shaded gray page into white paper. Dark text becomes black. Paper grain is snapped to white, not stretched into speckle. */
export function whitenPaper(pixels: Uint8Array) {
  if (pixels.length === 0) return
  const hist = new Uint32Array(256)
  for (let index = 0; index < pixels.length; index += 1) hist[pixels[index]] += 1
  const snap = whiteCutoff(hist, pixels.length)
  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index]
    if (value >= snap) {
      pixels[index] = 255
      continue
    }
    const ratio = value / snap
    pixels[index] = Math.min(48, Math.round(ratio * ratio * 48))
  }
}

function whiteCutoff(hist: Uint32Array, total: number) {
  const tail = percentileFromHist(hist, total, 0.005)
  const paper = Math.max(1, percentileFromHist(hist, total, 0.55))
  if (paper - tail < 28) return Math.max(1, tail)
  let valley = tail
  let valleyCount = Number.POSITIVE_INFINITY
  for (let value = tail + 1; value < paper; value += 1) {
    let count = 0
    for (let offset = -2; offset <= 2; offset += 1) {
      const bin = value + offset
      if (bin >= 0 && bin < 256) count += hist[bin]
    }
    if (count < valleyCount) {
      valleyCount = count
      valley = value
    }
  }
  let paperCount = 0
  for (let offset = -2; offset <= 2; offset += 1) {
    const bin = paper + offset
    if (bin >= 0 && bin < 256) paperCount += hist[bin]
  }
  if (valleyCount > paperCount * 0.35) return Math.max(1, percentileFromHist(hist, total, 0.02))
  return Math.max(1, valley)
}

function smoothPaper(pixels: Uint8Array, width: number, height: number) {
  const long = Math.max(width, height)
  const block = Math.max(12, Math.round(long / 16))
  const gridWidth = Math.ceil(width / block)
  const gridHeight = Math.ceil(height / block)
  let grid = new Float32Array(gridWidth * gridHeight)
  const hist = new Uint32Array(256)
  for (let by = 0; by < gridHeight; by += 1) {
    const y0 = by * block
    const y1 = Math.min(height, y0 + block)
    for (let bx = 0; bx < gridWidth; bx += 1) {
      hist.fill(0)
      const x0 = bx * block
      const x1 = Math.min(width, x0 + block)
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        const row = y * width
        for (let x = x0; x < x1; x += 1) {
          hist[pixels[row + x]] += 1
          count += 1
        }
      }
      grid[by * gridWidth + bx] = percentileFromHist(hist, count, 0.72)
    }
  }
  grid = blurGrid(grid, gridWidth, gridHeight)
  grid = blurGrid(grid, gridWidth, gridHeight)
  const background = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      background[y * width + x] = Math.max(1, Math.min(255, Math.round(sampleGrid(grid, gridWidth, gridHeight, block, x, y))))
    }
  }
  return background
}

function blurGrid(grid: Float32Array, width: number, height: number) {
  const next = new Float32Array(grid.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          sum += grid[yy * width + xx]
          count += 1
        }
      }
      next[y * width + x] = sum / count
    }
  }
  return next
}

function sampleGrid(grid: Float32Array, gridWidth: number, gridHeight: number, block: number, x: number, y: number) {
  const gx = (x + 0.5) / block - 0.5
  const gy = (y + 0.5) / block - 0.5
  const x0 = clampIndex(Math.floor(gx), gridWidth)
  const y0 = clampIndex(Math.floor(gy), gridHeight)
  const x1 = Math.min(gridWidth - 1, x0 + 1)
  const y1 = Math.min(gridHeight - 1, y0 + 1)
  const fx = x0 === x1 ? 0 : gx - x0
  const fy = y0 === y1 ? 0 : gy - y0
  return (
    grid[y0 * gridWidth + x0] * (1 - fx) * (1 - fy) +
    grid[y0 * gridWidth + x1] * fx * (1 - fy) +
    grid[y1 * gridWidth + x0] * (1 - fx) * fy +
    grid[y1 * gridWidth + x1] * fx * fy
  )
}

type GrayPage = { data: Uint8Array; width: number; height: number }

/** Quarter-turns clockwise, matching rotateRaster. 1 turns vertical text horizontal. */
export function rotateGray(pixels: Uint8Array, width: number, height: number, turns: number): GrayPage {
  const quarter = ((turns % 4) + 4) % 4
  if (quarter === 0) return { data: pixels, width, height }
  const nextWidth = quarter % 2 === 0 ? width : height
  const nextHeight = quarter % 2 === 0 ? height : width
  const data = new Uint8Array(nextWidth * nextHeight)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nx = x
      let ny = y
      if (quarter === 1) {
        nx = height - 1 - y
        ny = x
      } else if (quarter === 2) {
        nx = width - 1 - x
        ny = height - 1 - y
      } else {
        nx = y
        ny = width - 1 - x
      }
      data[ny * nextWidth + nx] = pixels[y * width + x]
    }
  }
  return { data, width: nextWidth, height: nextHeight }
}

/** How many clockwise quarter-turns make receipt lines read left to right and right side up. */
export function uprightQuarter(pixels: Uint8Array, width: number, height: number) {
  const sample = downscaleGray(pixels, width, height, 280)
  const score = projectionScores(sample)
  if (score.ink < 36) return 0
  const turned = projectionScores(rotateGray(sample.data, sample.width, sample.height, 1))
  const uprightness = score.rowVar / (score.colVar + 1)
  const turnedUprightness = turned.rowVar / (turned.colVar + 1)
  if (Math.max(uprightness, turnedUprightness) < 1.35) return 0
  const quarter = turned.rowVar > score.rowVar * 1.12 ? 1 : 0
  const upright = quarter === 0 ? sample : rotateGray(sample.data, sample.width, sample.height, quarter)
  const lean = baselineLean(upright)
  const flippedLean = baselineLean(rotateGray(upright.data, upright.width, upright.height, 2))
  return flippedLean > lean + 0.06 ? (quarter + 2) % 4 : quarter
}

function downscaleGray(pixels: Uint8Array, width: number, height: number, longSide: number): GrayPage {
  const long = Math.max(width, height)
  if (long <= longSide) return { data: pixels, width, height }
  const scale = longSide / long
  const nextWidth = Math.max(8, Math.round(width * scale))
  const nextHeight = Math.max(8, Math.round(height * scale))
  const data = new Uint8Array(nextWidth * nextHeight)
  for (let y = 0; y < nextHeight; y += 1) {
    const y0 = Math.floor((y * height) / nextHeight)
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor(((y + 1) * height) / nextHeight)))
    for (let x = 0; x < nextWidth; x += 1) {
      const x0 = Math.floor((x * width) / nextWidth)
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor(((x + 1) * width) / nextWidth)))
      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        const row = sy * width
        for (let sx = x0; sx < x1; sx += 1) {
          sum += pixels[row + sx]
          count += 1
        }
      }
      data[y * nextWidth + x] = count === 0 ? 255 : Math.round(sum / count)
    }
  }
  return { data, width: nextWidth, height: nextHeight }
}

function projectionScores(page: GrayPage) {
  const mask = textInk(page)
  const rows = new Float32Array(page.height)
  const cols = new Float32Array(page.width)
  let ink = 0
  for (let y = 0; y < page.height; y += 1) {
    for (let x = 0; x < page.width; x += 1) {
      if (!mask[y * page.width + x]) continue
      rows[y] += 1
      cols[x] += 1
      ink += 1
    }
  }
  return { rowVar: variance(rows), colVar: variance(cols), ink, rows }
}

function baselineLean(page: GrayPage) {
  const { rows, ink } = projectionScores(page)
  if (ink < 36) return 0
  let peak = 0
  for (const value of rows) if (value > peak) peak = value
  if (peak < 4) return 0
  const cutoff = peak * 0.4
  let lean = 0
  let bands = 0
  let y = 0
  while (y < page.height) {
    if (rows[y] < cutoff) {
      y += 1
      continue
    }
    const start = y
    while (y < page.height && rows[y] >= cutoff) y += 1
    const bandHeight = y - start
    if (bandHeight < 3) continue
    let mass = 0
    let moment = 0
    for (let row = start; row < y; row += 1) {
      mass += rows[row]
      moment += rows[row] * (row - start + 0.5)
    }
    if (mass < 8) continue
    lean += moment / mass / bandHeight - 0.5
    bands += 1
  }
  return bands === 0 ? 0 : lean / bands
}

function textInk(page: GrayPage) {
  const radius = Math.max(3, Math.round(Math.min(page.width, page.height) / 28))
  const local = boxBlur(page.data, page.width, page.height, radius)
  const mask = new Uint8Array(page.data.length)
  for (let index = 0; index < page.data.length; index += 1) {
    if (page.data[index] < local[index] - 16 && page.data[index] < 155) mask[index] = 1
  }
  return mask
}

function boxBlur(pixels: Uint8Array, width: number, height: number, radius: number) {
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += pixels[y * width + x]
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum
    }
  }
  const out = new Uint8Array(pixels.length)
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0]
      const count = (x1 - x0 + 1) * (y1 - y0 + 1)
      out[y * width + x] = Math.round(sum / count)
    }
  }
  return out
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

function clampIndex(value: number, length: number) {
  if (value < 0) return 0
  if (value >= length) return length - 1
  return value
}

function percentileFromHist(hist: Uint32Array, total: number, fraction: number) {
  const target = Math.max(1, Math.ceil(total * fraction))
  let seen = 0
  for (let value = 0; value < 256; value += 1) {
    seen += hist[value]
    if (seen >= target) return value
  }
  return 255
}

function toGray(cv: ScannerCv, src: CvMat) {
  const gray = new cv.Mat()
  try {
    toGrayInto(cv, src, gray)
    return gray
  } catch (cause) {
    gray.delete()
    throw cause
  }
}

function toGrayInto(cv: ScannerCv, src: CvMat, gray: CvMat) {
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
}

async function grayToJpeg(cv: ScannerCv, gray: CvMat) {
  const rgba = new cv.Mat()
  try {
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
    const canvas = document.createElement("canvas")
    canvas.width = rgba.cols
    canvas.height = rgba.rows
    cv.imshow(canvas, rgba)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
    if (!blob) throw new Error("Could not save the scan")
    return blob
  } finally {
    rgba.delete()
  }
}

function packedGray(gray: CvMat) {
  const width = gray.cols
  const height = gray.rows
  const data = new Uint8Array(width * height)
  if (typeof gray.ucharPtr === "function") {
    for (let y = 0; y < height; y += 1) data.set(gray.ucharPtr(y).subarray(0, width), y * width)
    return { data, width, height }
  }
  data.set(gray.data.subarray(0, data.length))
  return { data, width, height }
}

function cropPacked(gray: Uint8Array, width: number, bounds: { x: number; y: number; width: number; height: number }) {
  const data = new Uint8Array(bounds.width * bounds.height)
  for (let y = 0; y < bounds.height; y += 1) {
    const from = (bounds.y + y) * width + bounds.x
    data.set(gray.subarray(from, from + bounds.width), y * bounds.width)
  }
  return { data, width: bounds.width, height: bounds.height }
}

function rowDarkRatio(gray: Uint8Array, width: number, y: number, left: number, right: number) {
  let dark = 0
  const count = right - left + 1
  const start = y * width
  for (let x = left; x <= right; x += 1) if (gray[start + x] < DARK) dark += 1
  return dark / Math.max(count, 1)
}

function colDarkRatio(gray: Uint8Array, width: number, x: number, top: number, bottom: number) {
  let dark = 0
  const count = bottom - top + 1
  for (let y = top; y <= bottom; y += 1) if (gray[y * width + x] < DARK) dark += 1
  return dark / Math.max(count, 1)
}

function regionDarkRatio(gray: Uint8Array, width: number, x: number, y: number, regionWidth: number, regionHeight: number) {
  let dark = 0
  const total = regionWidth * regionHeight
  for (let row = y; row < y + regionHeight; row += 1) {
    const start = row * width
    for (let col = x; col < x + regionWidth; col += 1) if (gray[start + col] < DARK) dark += 1
  }
  return dark / Math.max(total, 1)
}

function pointsFromApprox(approx: CvMat) {
  const points: ScanPoint[] = []
  const values = approx.data32S
  for (let index = 0; index < approx.rows; index += 1) {
    points.push({ x: values[index * 2], y: values[index * 2 + 1] })
  }
  return points
}

function boxPoints(rect: RotatedRect): ScanPoint[] {
  const angle = (rect.angle * Math.PI) / 180
  const a = Math.sin(angle) * 0.5
  const b = Math.cos(angle) * 0.5
  const first = {
    x: rect.center.x - a * rect.size.height - b * rect.size.width,
    y: rect.center.y + b * rect.size.height - a * rect.size.width,
  }
  const second = {
    x: rect.center.x + a * rect.size.height - b * rect.size.width,
    y: rect.center.y - b * rect.size.height - a * rect.size.width,
  }
  return [
    first,
    second,
    { x: 2 * rect.center.x - first.x, y: 2 * rect.center.y - first.y },
    { x: 2 * rect.center.x - second.x, y: 2 * rect.center.y - second.y },
  ]
}

function isConvexQuad(points: ScanPoint[]) {
  if (points.length !== 4) return false
  let sign = 0
  for (let index = 0; index < 4; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % 4]
    const after = points[(index + 2) % 4]
    const cross = (next.x - current.x) * (after.y - next.y) - (next.y - current.y) * (after.x - next.x)
    if (Math.abs(cross) < 1e-3) continue
    const nextSign = Math.sign(cross)
    if (sign && nextSign !== sign) return false
    sign = nextSign
  }
  return sign !== 0
}

function oddKernel(cv: ScannerCv, width: number, height: number, divisor: number) {
  const size = oddSize(Math.max(3, Math.min(21, Math.round(Math.min(width, height) / divisor))))
  return cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(size, size))
}

function oddSize(value: number) {
  const rounded = Math.max(3, Math.round(value))
  return rounded % 2 === 0 ? rounded + 1 : rounded
}

function distance(a: ScanPoint, b: ScanPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function indexOfMin(values: number[]) {
  let index = 0
  for (let cursor = 1; cursor < values.length; cursor += 1) if (values[cursor] < values[index]) index = cursor
  return index
}

function indexOfMax(values: number[]) {
  let index = 0
  for (let cursor = 1; cursor < values.length; cursor += 1) if (values[cursor] > values[index]) index = cursor
  return index
}

function release(mats: Array<CvMat | null | undefined>) {
  for (const mat of mats) {
    try {
      mat?.delete()
    } catch {
      // Already released.
    }
  }
}

async function imageSourceCanvas(source: CanvasImageSource) {
  if (source instanceof HTMLCanvasElement) return source
  const size = sourceSize(source)
  if (size.width < 2 || size.height < 2) throw new Error("Could not read the photo")
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not read the photo")
  context.drawImage(source, 0, 0, size.width, size.height)
  return canvas
}

function sourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight }
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) return { width: source.width, height: source.height }
  const sized = source as { width?: number; height?: number }
  return { width: sized.width ?? 0, height: sized.height ?? 0 }
}
