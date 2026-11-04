import type { CvMat, OpenCv, ScanMode } from "@/lib/receiptScanner/types"

export type EnhancedReceipt = {
  image: CvMat
  glareRatio: number
  glareSevere: boolean
}

export function enhanceReceipt(cv: OpenCv, warped: CvMat, mode: ScanMode): EnhancedReceipt {
  const trash: CvMat[] = []
  const keep = (mat: CvMat) => {
    trash.push(mat)
    return mat
  }
  try {
    const color = keep(toRgb(cv, warped))
    const hsv = keep(new cv.Mat())
    cv.cvtColor(color, hsv, cv.COLOR_RGB2HSV)
    const mask = keep(glareMask(cv, hsv))
    const glareRatio = cv.countNonZero(mask) / Math.max(1, mask.rows * mask.cols)
    const glareSevere = glareRatio >= 0.15
    const base = keep(color.clone())
    if (!glareSevere && glareRatio > 0) {
      const filled = new cv.Mat()
      cv.inpaint(base, mask, filled, 5, cv.INPAINT_TELEA)
      base.delete()
      trash[trash.lastIndexOf(base)] = filled
    }
    const prepared = trash.find((mat) => mat !== color && mat !== hsv && mat !== mask && mat.channels() === 3) ?? base

    if (mode === "color") {
      const normalized = keep(normalizeColor(cv, prepared))
      const output = new cv.Mat()
      cv.cvtColor(normalized, output, cv.COLOR_HSV2RGB)
      return { image: output, glareRatio, glareSevere }
    }

    const gray = keep(new cv.Mat())
    cv.cvtColor(prepared, gray, cv.COLOR_RGB2GRAY)
    return { image: whitenScan(cv, gray), glareRatio, glareSevere }
  } finally {
    for (const mat of trash) mat.delete()
  }
}

function toRgb(cv: OpenCv, src: CvMat) {
  const rgb = new cv.Mat()
  if (src.channels() === 4) cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
  else if (src.channels() === 1) cv.cvtColor(src, rgb, cv.COLOR_GRAY2RGB)
  else src.copyTo(rgb)
  return rgb
}

function glareMask(cv: OpenCv, hsv: CvMat) {
  const lower = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(0, 0, 236))
  const upper = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, new cv.Scalar(179, 24, 255))
  const mask = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  try {
    cv.inRange(hsv, lower, upper, mask)
    cv.dilate(mask, mask, kernel)
    return mask
  } finally {
    lower.delete()
    upper.delete()
    kernel.delete()
  }
}

function normalizeColor(cv: OpenCv, rgb: CvMat) {
  const hsv = new cv.Mat()
  const planes = new cv.MatVector()
  const merged = new cv.Mat()
  const replacement = new cv.MatVector()
  try {
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    cv.split(hsv, planes)
    const hue = planes.get(0).clone()
    const saturation = planes.get(1).clone()
    const lifted = normalizeChannel(cv, planes.get(2))
    try {
      replacement.push_back(hue)
      replacement.push_back(saturation)
      replacement.push_back(lifted)
      cv.merge(replacement, merged)
      return merged.clone()
    } finally {
      hue.delete()
      saturation.delete()
      lifted.delete()
    }
  } finally {
    hsv.delete()
    for (let index = 0; index < planes.size(); index += 1) planes.get(index).delete()
    planes.delete()
    replacement.delete()
    merged.delete()
  }
}

function whitenScan(cv: OpenCv, gray: CvMat) {
  const normalized = normalizeChannel(cv, gray)
  const clahe = new cv.CLAHE(2, new cv.Size(8, 8))
  const equalized = new cv.Mat()
  const white = new cv.Mat()
  try {
    clahe.apply(normalized, equalized)
    cv.threshold(equalized, white, 200, 255, cv.THRESH_BINARY)
    equalized.setTo(new cv.Scalar(255), white)
    return equalized.clone()
  } finally {
    normalized.delete()
    clahe.delete()
    equalized.delete()
    white.delete()
  }
}

function normalizeChannel(cv: OpenCv, gray: CvMat) {
  const kernelSize = oddKernel(Math.min(gray.rows, gray.cols))
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize))
  const background = new cv.Mat()
  const ones = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(1))
  const normalized = new cv.Mat()
  try {
    cv.morphologyEx(gray, background, cv.MORPH_CLOSE, kernel)
    cv.add(background, ones, background)
    cv.divide(gray, background, normalized, 255, cv.CV_8U)
    return normalized.clone()
  } finally {
    kernel.delete()
    background.delete()
    ones.delete()
    normalized.delete()
  }
}

function oddKernel(limit: number) {
  const size = Math.min(25, Math.max(3, limit))
  return size % 2 === 0 ? size - 1 : size
}
