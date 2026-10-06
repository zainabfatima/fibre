import { checksFor, enhance, nativeSize, pagePixelSize, scaleToWidth, warp } from "./image"
import type { PageChecks, Point, ScanFilter } from "./types"

type Job = {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  corners: Point[]
  filter: ScanFilter
  kind: "receipt" | "document"
}

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data
  const image = new ImageData(new Uint8ClampedArray(job.buffer), job.width, job.height)
  const native = nativeSize(job.corners)
  const flat = warp(image, job.corners, native.width, native.height)
  const checks: PageChecks = checksFor(flat, native.width)
  const target = pagePixelSize(job.corners, job.kind)
  const sized = scaleToWidth(flat, target.width)
  const output = enhance(sized, job.filter)
  const buffer = output.data.buffer
  const scope = self as unknown as {
    postMessage: (message: unknown, transfer: Transferable[]) => void
  }
  scope.postMessage({ id: job.id, width: output.width, height: output.height, buffer, checks }, [buffer])
}
