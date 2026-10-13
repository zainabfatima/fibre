/**
 * Crop used only while printing. It drops the dark outer border around a
 * lighter receipt so those pixels are not sent to the printer. The stored
 * scan is left unchanged.
 */
export type PrintCropRect = { x: number; y: number; width: number; height: number }

export const PRINT_ANALYSIS_EDGE = 1400
export const PRINT_OUTPUT_EDGE = 2400

export function cropDarkOuterBorder(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channels: 1 | 4 = 1,
): PrintCropRect {
  function shadeAt(hist: Uint32Array, total: number, ratio: number) {
    const target = Math.min(total - 1, Math.floor(total * ratio))
    let seen = 0
    for (let shade = 0; shade < 256; shade += 1) {
      seen += hist[shade]
      if (seen > target) return shade
    }
    return 0
  }

  function lineMedian(axis: "x" | "y", index: number, step: number) {
    const along = axis === "x" ? height : width
    const hist = new Uint32Array(256)
    let count = 0
    for (let cursor = 0; cursor < along; cursor += step) {
      const x = axis === "x" ? index : cursor
      const y = axis === "x" ? cursor : index
      const offset = (y * width + x) * channels
      const shade =
        channels === 1
          ? pixels[offset]
          : Math.round((pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3)
      hist[shade] += 1
      count += 1
    }
    return shadeAt(hist, count, 0.5)
  }

  function axisSpan(axis: "x" | "y") {
    const length = axis === "x" ? width : height
    const along = axis === "x" ? height : width
    if (length < 2) return { start: 0, end: length }
    const step = Math.max(1, Math.floor(along / 220))
    const medians = new Uint8Array(length)
    const hist = new Uint32Array(256)
    for (let index = 0; index < length; index += 1) {
      const median = lineMedian(axis, index, step)
      medians[index] = median
      hist[median] += 1
    }
    let page = shadeAt(hist, length, 0.6)
    if (page < 120) {
      const brighter = shadeAt(hist, length, 0.88)
      if (brighter >= 150) page = brighter
    }
    if (page < 120) return { start: 0, end: length }

    const cut = Math.max(100, Math.min(page - 30, Math.floor(page * 0.8)))
    const minBridge = Math.max(6, Math.round(length * 0.009))
    const edge = Math.max(1, Math.round(length * 0.09))
    const keep = new Uint8Array(length)
    let index = 0
    while (index < length) {
      if (medians[index] >= cut) {
        keep[index] = 1
        index += 1
        continue
      }
      let end = index
      while (end < length && medians[end] < cut) end += 1
      const gap = end - index
      const touchesEdge = index < edge || end > length - edge
      if (gap < minBridge || !touchesEdge) {
        for (let cursor = index; cursor < end; cursor += 1) keep[cursor] = 1
      }
      index = end
    }

    const center = Math.floor((length - 1) / 2)
    let start = 0
    let finish = length - 1
    if (keep[center]) {
      start = center
      finish = center
      while (start > 0 && keep[start - 1]) start -= 1
      while (finish < length - 1 && keep[finish + 1]) finish += 1
    } else {
      let bestStart = -1
      let bestEnd = -1
      let cursor = 0
      while (cursor < length) {
        if (!keep[cursor]) {
          cursor += 1
          continue
        }
        let end = cursor
        while (end < length - 1 && keep[end + 1]) end += 1
        if (bestStart < 0 || end - cursor > bestEnd - bestStart) {
          bestStart = cursor
          bestEnd = end
        }
        cursor = end + 1
      }
      if (bestStart < 0) return { start: 0, end: length }
      start = bestStart
      finish = bestEnd
    }

    const bright = Math.round(page * 0.92)
    const limit = Math.max(1, Math.round(length * 0.015))
    if (start > 0) {
      let steps = 0
      while (start < finish && steps < limit && medians[start] < bright) {
        start += 1
        steps += 1
      }
    }
    if (finish < length - 1) {
      let steps = 0
      while (finish > start && steps < limit && medians[finish] < bright) {
        finish -= 1
        steps += 1
      }
    }
    if (finish - start + 1 < length * 0.12) return { start: 0, end: length }
    return { start, end: finish + 1 }
  }

  if (width < 8 || height < 8) return { x: 0, y: 0, width, height }
  const x = axisSpan("x")
  const y = axisSpan("y")
  return { x: x.start, y: y.start, width: x.end - x.start, height: y.end - y.start }
}

/** Map a crop measured on a downscaled copy back onto the original pixels. */
export function mapPrintCrop(
  rect: PrintCropRect,
  sourceWidth: number,
  sourceHeight: number,
  analysisWidth: number,
  analysisHeight: number,
): PrintCropRect {
  if (
    rect.x === 0 &&
    rect.y === 0 &&
    rect.width === analysisWidth &&
    rect.height === analysisHeight
  ) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  }
  const scaleX = sourceWidth / analysisWidth
  const scaleY = sourceHeight / analysisHeight
  let left = Math.floor(rect.x * scaleX)
  let top = Math.floor(rect.y * scaleY)
  let right = Math.ceil((rect.x + rect.width) * scaleX)
  let bottom = Math.ceil((rect.y + rect.height) * scaleY)
  const padX = analysisWidth < sourceWidth ? Math.ceil(scaleX) : 0
  const padY = analysisHeight < sourceHeight ? Math.ceil(scaleY) : 0
  if (rect.x > 0) left += padX
  if (rect.y > 0) top += padY
  if (rect.x + rect.width < analysisWidth) right -= padX
  if (rect.y + rect.height < analysisHeight) bottom -= padY
  left = Math.max(0, Math.min(left, sourceWidth - 1))
  top = Math.max(0, Math.min(top, sourceHeight - 1))
  right = Math.max(left + 1, Math.min(right, sourceWidth))
  bottom = Math.max(top + 1, Math.min(bottom, sourceHeight))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

/** Standalone print page: white paper, cropped image, then the print dialog. */
export function buildImagePrintHtml(imageUrl: string) {
  const crop = cropDarkOuterBorder.toString().replaceAll("</", "<\\/")
  const map = mapPrintCrop.toString().replaceAll("</", "<\\/")
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Receipt</title>
<style>
  @page { margin: 0.4in; }
  html, body { margin: 0; padding: 0; background: #fff; color-scheme: light; }
  img { display: block; width: 100%; height: auto; background: #fff; }
  @media print {
    html, body { background: #fff !important; color-scheme: light; }
    img { background: #fff !important; }
  }
</style>
</head>
<body>
<img id="shot" alt="Receipt" src="${escapeHtml(imageUrl)}">
<script>
const ANALYSIS = ${PRINT_ANALYSIS_EDGE};
const OUTPUT = ${PRINT_OUTPUT_EDGE};
const cropDarkOuterBorder = ${crop};
const mapPrintCrop = ${map};
const img = document.getElementById("shot");
function printNow() { window.focus(); window.print(); }
function prepare() {
  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return printNow();
    const scale = Math.min(1, ANALYSIS / Math.max(width, height));
    const aw = Math.max(1, Math.round(width * scale));
    const ah = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = aw;
    canvas.height = ah;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return printNow();
    context.drawImage(img, 0, 0, aw, ah);
    const frame = context.getImageData(0, 0, aw, ah);
    const found = cropDarkOuterBorder(frame.data, aw, ah, 4);
    const rect = mapPrintCrop(found, width, height, aw, ah);
    if (rect.width < width || rect.height < height) {
      const printScale = Math.min(1, OUTPUT / Math.max(rect.width, rect.height));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(rect.width * printScale));
      out.height = Math.max(1, Math.round(rect.height * printScale));
      const outContext = out.getContext("2d");
      if (!outContext) return printNow();
      outContext.fillStyle = "#ffffff";
      outContext.fillRect(0, 0, out.width, out.height);
      outContext.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
      img.addEventListener("load", printNow, { once: true });
      img.src = out.toDataURL("image/jpeg", 0.92);
      return;
    }
  } catch (error) {}
  printNow();
}
if (img.complete && img.naturalWidth) prepare();
else img.addEventListener("load", prepare);
img.addEventListener("error", printNow);
</script>
</body>
</html>`
}
