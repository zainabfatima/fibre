import { distance, orderCorners } from "@/lib/receiptScanner/geometry"
import type { CvMat, OpenCv, Point } from "@/lib/receiptScanner/types"

export function warpReceipt(cv: OpenCv, src: CvMat, corners: Point[]): CvMat {
  const [topLeft, topRight, bottomRight, bottomLeft] = orderCorners(corners)
  const outW = Math.max(1, Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))))
  const outH = Math.max(1, Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))))
  const source = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.x,
    topLeft.y,
    topRight.x,
    topRight.y,
    bottomRight.x,
    bottomRight.y,
    bottomLeft.x,
    bottomLeft.y,
  ])
  const destination = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW - 1, 0, outW - 1, outH - 1, 0, outH - 1])
  const transform = cv.getPerspectiveTransform(source, destination)
  const warped = new cv.Mat()
  try {
    cv.warpPerspective(src, warped, transform, new cv.Size(outW, outH), cv.INTER_CUBIC, cv.BORDER_REPLICATE)
    const insetX = Math.round(outW * 0.015)
    const insetY = Math.round(outH * 0.015)
    const cropW = outW - insetX * 2
    const cropH = outH - insetY * 2
    if (cropW < 2 || cropH < 2) return warped
    const view = warped.roi(new cv.Rect(insetX, insetY, cropW, cropH))
    const trimmed = view.clone()
    view.delete()
    warped.delete()
    return trimmed
  } catch (cause) {
    warped.delete()
    throw cause
  } finally {
    source.delete()
    destination.delete()
    transform.delete()
  }
}
