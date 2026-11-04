import { detectRgba, renderRgba, type RgbaImage } from "@/lib/receiptScanner/process"
import { loadOpenCV } from "@/lib/receiptScanner/opencvLoader"
import type { Point, ScanMode, ScanReceiptResult } from "@/lib/receiptScanner/types"

type WorkerResponse = {
  id: number
  error?: string
  corners?: Point[] | null
  detected?: boolean
  glareRatio?: number
  glareSevere?: boolean
  width?: number
  height?: number
  scan?: ArrayBuffer
  warped?: ArrayBuffer | null
}

type Pending = {
  resolve: (value: WorkerResponse) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()

function scannerWorker() {
  if (workerBroken || typeof Worker === "undefined") return null
  if (worker) return worker
  try {
    worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    if (event.data.error) {
      workerBroken = true
      worker?.terminate()
      worker = null
      job.reject(new Error(event.data.error))
    } else job.resolve(event.data)
  }
  worker.onerror = () => {
    workerBroken = true
    worker?.terminate()
    worker = null
    for (const job of pending.values()) job.reject(new Error("Scanner worker failed"))
    pending.clear()
  }
  return worker
}

function askWorker(message: Omit<WorkerResponse, "id"> & Record<string, unknown>, buffer: ArrayBuffer) {
  const active = scannerWorker()
  if (!active) return Promise.resolve(null)
  const id = nextId
  nextId += 1
  const copy = buffer.slice(0)
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    active.postMessage({ ...message, id, buffer: copy }, [copy])
  })
}

export async function canvasFromBlob(file: Blob) {
  try {
    return bitmapToCanvas(await createImageBitmap(file, { imageOrientation: "from-image" }))
  } catch {
    const heic2any = (await import("heic2any")).default
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })
    const jpeg = Array.isArray(converted) ? converted[0] : converted
    return bitmapToCanvas(await createImageBitmap(jpeg, { imageOrientation: "from-image" }))
  }
}

export function bitmapToCanvas(bitmap: ImageBitmap) {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not read the photo")
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  if (!blob) throw new Error("Could not save the photo")
  return blob
}

export async function detectCanvas(canvas: HTMLCanvasElement) {
  const image = readCanvas(canvas)
  const remote = await askWorker({ op: "detect", width: image.width, height: image.height }, image.data.buffer).catch(() => null)
  if (remote && !remote.error) return remote.corners ?? null
  const cv = await loadOpenCV()
  return detectRgba(cv, image.width, image.height, image.data)
}

export async function scanReceipt(fileOrCanvas: Blob | HTMLCanvasElement, mode: ScanMode = "scan") {
  const canvas = fileOrCanvas instanceof HTMLCanvasElement ? fileOrCanvas : await canvasFromBlob(fileOrCanvas)
  return renderCanvas(canvas, null, mode, true)
}

export async function renderCanvas(
  canvas: HTMLCanvasElement,
  corners: Point[] | null,
  mode: ScanMode,
  detect = corners == null,
): Promise<ScanReceiptResult & { warpedBlob: Blob | null }> {
  const image = readCanvas(canvas)
  const remote = await askWorker(
    { op: "render", width: image.width, height: image.height, corners, mode, detect },
    image.data.buffer,
  ).catch(() => null)
  if (remote?.scan && remote.width && remote.height) {
    return {
      blob: new Blob([remote.scan], { type: "image/jpeg" }),
      warpedBlob: remote.warped ? new Blob([remote.warped], { type: "image/jpeg" }) : null,
      width: remote.width,
      height: remote.height,
      corners: remote.corners ?? null,
      detected: Boolean(remote.detected),
      glareRatio: remote.glareRatio ?? 0,
      glareSevere: Boolean(remote.glareSevere),
    }
  }
  const cv = await loadOpenCV()
  const rendered = renderRgba(cv, image.width, image.height, image.data, corners, mode, detect)
  return {
    blob: await rgbaToJpeg(rendered.scan),
    warpedBlob: rendered.warped ? await rgbaToJpeg(rendered.warped) : null,
    width: rendered.scan.width,
    height: rendered.scan.height,
    corners: rendered.corners,
    detected: rendered.detected,
    glareRatio: rendered.glareRatio,
    glareSevere: rendered.glareSevere,
  }
}

function readCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Could not read the photo")
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function rgbaToJpeg(image: RgbaImage) {
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not save the scan")
  context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)
  return canvasToJpeg(canvas)
}
