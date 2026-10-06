import { stitchVertical } from "@/lib/scanner/image"
import type { PageChecks, Point, ScanFilter } from "@/lib/scanner/types"

type JobResult = {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  checks: PageChecks
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (image: ImageData) => void; checks: (checks: PageChecks) => void; reject: (error: Error) => void }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  worker.onmessage = (event: MessageEvent<JobResult>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    job.checks(event.data.checks)
    job.resolve(new ImageData(new Uint8ClampedArray(event.data.buffer), event.data.width, event.data.height))
  }
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new Error("Scanner worker failed"))
    pending.clear()
    worker = null
  }
  return worker
}

export function scanPage(
  image: ImageData,
  corners: Point[],
  filter: ScanFilter,
  kind: "receipt" | "document",
) {
  const id = nextId
  nextId += 1
  const buffer = image.data.buffer.slice(0)
  return new Promise<{ image: ImageData; checks: PageChecks }>((resolve, reject) => {
    let checks: PageChecks = { blurry: false, tooSmall: false, glare: false, dark: false, joins: false }
    pending.set(id, {
      resolve: (processed) => resolve({ image: processed, checks }),
      checks: (value) => {
        checks = value
      },
      reject,
    })
    try {
      getWorker().postMessage({ id, width: image.width, height: image.height, buffer, corners, filter, kind }, [buffer])
    } catch (cause) {
      pending.delete(id)
      reject(cause instanceof Error ? cause : new Error("Could not start the scanner"))
    }
  })
}

export async function imageDataToBlob(image: ImageData, type: "image/webp" | "image/jpeg" | "image/png", quality = 0.9) {
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not prepare the scan")
  context.putImageData(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  if (blob) return blob
  if (type === "image/webp") {
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    if (jpeg) return jpeg
  }
  throw new Error("This browser could not save the scan")
}

export async function blobFromFile(file: Blob) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not read the photo")
  context.drawImage(bitmap, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  bitmap.close()
  return image
}

export function previewUrl(image: ImageData) {
  const canvas = document.createElement("canvas")
  const scale = Math.min(1, 900 / image.width)
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext("2d")
  if (!context) return ""
  const source = document.createElement("canvas")
  source.width = image.width
  source.height = image.height
  source.getContext("2d")?.putImageData(image, 0, 0)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.8)
}

export async function combinePages(images: ImageData[], capture: "long" | "multi_page" | "single", filter: ScanFilter) {
  if (capture !== "long" || images.length < 2) return { image: images[0], aligned: true, filter }
  const stitched = stitchVertical(images)
  return { image: stitched.image, aligned: stitched.aligned, filter }
}
