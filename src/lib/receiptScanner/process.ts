import { detectReceipt } from "@/lib/receiptScanner/detect"
import { enhanceReceipt } from "@/lib/receiptScanner/enhance"
import type { CvMat, OpenCv, Point, ScanMode } from "@/lib/receiptScanner/types"
import { warpReceipt } from "@/lib/receiptScanner/warp"

export type RgbaImage = {
  width: number
  height: number
  rgba: Uint8Array
}

export type RenderedReceipt = {
  corners: Point[] | null
  detected: boolean
  glareRatio: number
  glareSevere: boolean
  scan: RgbaImage
  warped: RgbaImage | null
}

export function renderRgba(
  cv: OpenCv,
  width: number,
  height: number,
  data: ArrayLike<number>,
  corners: Point[] | null,
  mode: ScanMode,
  detect: boolean,
): RenderedReceipt {
  const src = cv.matFromArray(height, width, cv.CV_8UC4, data)
  try {
    const found = detect ? detectReceipt(cv, src) : corners
    const useCorners = found && found.length === 4 ? found : null
    const warped = useCorners ? warpReceipt(cv, src, useCorners) : src.clone()
    try {
      const enhanced = enhanceReceipt(cv, warped, mode)
      try {
        return {
          corners: useCorners,
          detected: detect ? Boolean(useCorners) : Boolean(corners && corners.length === 4),
          glareRatio: enhanced.glareRatio,
          glareSevere: enhanced.glareSevere,
          scan: rgbaFromMat(cv, enhanced.image),
          warped: useCorners ? rgbaFromMat(cv, warped) : null,
        }
      } finally {
        enhanced.image.delete()
      }
    } finally {
      warped.delete()
    }
  } finally {
    src.delete()
  }
}

export function detectRgba(cv: OpenCv, width: number, height: number, data: ArrayLike<number>) {
  const src = cv.matFromArray(height, width, cv.CV_8UC4, data)
  try {
    return detectReceipt(cv, src)
  } finally {
    src.delete()
  }
}

function rgbaFromMat(cv: OpenCv, mat: CvMat): RgbaImage {
  const rgba = new cv.Mat()
  try {
    if (mat.channels() === 4) mat.copyTo(rgba)
    else if (mat.channels() === 1) cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA)
    else cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA)
    return { width: rgba.cols, height: rgba.rows, rgba: new Uint8Array(rgba.data) }
  } finally {
    rgba.delete()
  }
}
