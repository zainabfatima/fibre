import { orderCorners } from "@/lib/receiptScanner/geometry"
import type { CvMat, OpenCv, Point } from "@/lib/receiptScanner/types"

const DETECT_LONG_SIDE = 800

export function detectReceipt(cv: OpenCv, src: CvMat): Point[] | null {
  const trash: CvMat[] = []
  const keep = (mat: CvMat) => {
    trash.push(mat)
    return mat
  }
  try {
    const longSide = Math.max(src.cols, src.rows)
    const scale = longSide > DETECT_LONG_SIDE ? DETECT_LONG_SIDE / longSide : 1
    const small = keep(new cv.Mat())
    cv.resize(
      src,
      small,
      new cv.Size(Math.max(1, Math.round(src.cols * scale)), Math.max(1, Math.round(src.rows * scale))),
      0,
      0,
      cv.INTER_AREA,
    )
    const gray = keep(new cv.Mat())
    if (small.channels() === 1) small.copyTo(gray)
    else cv.cvtColor(small, gray, small.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY)
    const blurred = keep(new cv.Mat())
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    const edges = keep(new cv.Mat())
    cv.Canny(blurred, edges, 50, 150)
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
    const dilated = keep(new cv.Mat())
    cv.dilate(edges, dilated, kernel)
    cv.dilate(dilated, dilated, kernel)

    const fromEdges = firstQuad(cv, dilated, small.cols, small.rows)
    const found = fromEdges ?? otsuQuad(cv, blurred, small.cols, small.rows, keep) ?? minAreaQuad(cv, dilated, small.cols, small.rows)
    if (!found) return null
    const inv = 1 / scale
    return orderCorners(
      found.map((point) => ({
        x: clamp(point.x * inv, 0, src.cols - 1),
        y: clamp(point.y * inv, 0, src.rows - 1),
      })),
    )
  } finally {
    for (const mat of trash) mat.delete()
  }
}

function otsuQuad(cv: OpenCv, blurred: CvMat, width: number, height: number, keep: (mat: CvMat) => CvMat) {
  const binary = keep(new cv.Mat())
  cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
  return firstQuad(cv, binary, width, height) ?? minAreaQuad(cv, binary, width, height)
}

function firstQuad(cv: OpenCv, binary: CvMat, width: number, height: number): Point[] | null {
  const imageArea = width * height
  const ranked = rankedContours(cv, binary)
  try {
    for (const contour of ranked.slice(0, 5)) {
      const approx = new cv.Mat()
      try {
        const perimeter = cv.arcLength(contour, true)
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true)
        if (approx.rows !== 4) continue
        if (!cv.isContourConvex(approx)) continue
        if (cv.contourArea(approx) < imageArea * 0.2) continue
        const points = pointsFromContour(approx)
        if (!points || isPhotoFrame(points, width, height)) continue
        return points
      } finally {
        approx.delete()
      }
    }
    return null
  } finally {
    for (const contour of ranked) contour.delete()
  }
}

function minAreaQuad(cv: OpenCv, binary: CvMat, width: number, height: number): Point[] | null {
  const imageArea = width * height
  const ranked = rankedContours(cv, binary)
  try {
    for (const contour of ranked.slice(0, 5)) {
      if (cv.contourArea(contour) < imageArea * 0.2) continue
      const rect = cv.minAreaRect(contour)
      const raw = cv.boxPoints ? cv.boxPoints(rect) : cv.RotatedRect.points(rect)
      if (!raw || raw.length !== 4) continue
      const points = raw.map((point) => ({ x: point.x, y: point.y }))
      if (isPhotoFrame(points, width, height)) continue
      return points
    }
    return null
  } finally {
    for (const contour of ranked) contour.delete()
  }
}

function isPhotoFrame(points: Point[], width: number, height: number) {
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.012))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return (
    Math.min(...xs) <= margin &&
    Math.min(...ys) <= margin &&
    Math.max(...xs) >= width - 1 - margin &&
    Math.max(...ys) >= height - 1 - margin
  )
}

function rankedContours(cv: OpenCv, binary: CvMat) {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const copy = binary.clone()
  try {
    cv.findContours(copy, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    const items: Array<{ contour: CvMat; area: number }> = []
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index)
      const area = cv.contourArea(contour)
      items.push({ contour: contour.clone(), area })
      contour.delete()
    }
    items.sort((a, b) => b.area - a.area)
    return items.map((item) => item.contour)
  } finally {
    hierarchy.delete()
    contours.delete()
    copy.delete()
  }
}

function pointsFromContour(approx: CvMat): Point[] | null {
  const data = approx.data32S
  if (!data || data.length < 8) return null
  const points: Point[] = []
  for (let index = 0; index < 4; index += 1) {
    points.push({ x: data[index * 2], y: data[index * 2 + 1] })
  }
  return points
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
