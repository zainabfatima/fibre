import { loadOpenCV } from "./opencvLoader"
import { detectRgba, renderRgba } from "./process"
import type { Point, ScanMode } from "./types"

type RequestMessage = {
  id: number
  op: "detect" | "render"
  width: number
  height: number
  buffer: ArrayBuffer
  corners?: Point[] | null
  mode?: ScanMode
  detect?: boolean
}

const port = self as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

port.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const message = event.data
  try {
    const cv = await loadOpenCV()
    const pixels = new Uint8Array(message.buffer)
    if (message.op === "detect") {
      const corners = detectRgba(cv, message.width, message.height, pixels)
      port.postMessage({ id: message.id, corners })
      return
    }
    const rendered = renderRgba(
      cv,
      message.width,
      message.height,
      pixels,
      message.corners ?? null,
      message.mode ?? "scan",
      message.detect !== false,
    )
    const scan = await encodeJpeg(rendered.scan.rgba, rendered.scan.width, rendered.scan.height)
    const warped = rendered.warped
      ? await encodeJpeg(rendered.warped.rgba, rendered.warped.width, rendered.warped.height)
      : null
    port.postMessage(
      {
        id: message.id,
        corners: rendered.corners,
        detected: rendered.detected,
        glareRatio: rendered.glareRatio,
        glareSevere: rendered.glareSevere,
        width: rendered.scan.width,
        height: rendered.scan.height,
        scan,
        warped,
      },
      warped ? [scan, warped] : [scan],
    )
  } catch (cause) {
    port.postMessage({
      id: message.id,
      error: cause instanceof Error ? cause.message : "The scanner failed",
    })
  }
}

async function encodeJpeg(rgba: Uint8Array, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not encode the scan")
  const copy = new Uint8ClampedArray(rgba)
  context.putImageData(new ImageData(copy, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })
  return blob.arrayBuffer()
}
