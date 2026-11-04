import type { OpenCv } from "@/lib/receiptScanner/types"

type CvModule = OpenCv & {
  onRuntimeInitialized?: () => void
  Mat?: OpenCv["Mat"]
}

let pending: Promise<OpenCv> | null = null

export function loadOpenCV(): Promise<OpenCv> {
  if (!pending) {
    const load = inWorker() ? loadWorker() : typeof document !== "undefined" ? loadScript() : loadNode()
    pending = load.catch((cause: unknown) => {
      pending = null
      throw cause
    })
  }
  return pending
}

function inWorker() {
  const protocol = (globalThis as { location?: { protocol?: string } }).location?.protocol
  return protocol === "http:" || protocol === "https:"
}

async function loadNode() {
  const imported = await import(
    /* turbopackIgnore: true */
    /* webpackIgnore: true */
    "@techstark/opencv-js"
  )
  return settle(imported as unknown as { default?: CvModule | Promise<CvModule> } & (CvModule | Promise<CvModule>))
}

function loadScript() {
  const existing = (window as unknown as { cv?: CvModule }).cv
  if (existing) return settle(existing)
  return new Promise<OpenCv>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/opencv.js"
    script.async = true
    script.onload = () => {
      const cv = (window as unknown as { cv?: CvModule }).cv
      if (!cv) {
        reject(new Error("OpenCV did not start"))
        return
      }
      resolve(settle(cv))
    }
    script.onerror = () => reject(new Error("OpenCV did not load"))
    document.head.appendChild(script)
  })
}

async function loadWorker() {
  const response = await fetch("/opencv.js")
  if (!response.ok) throw new Error("OpenCV did not load")
  const source = await response.text()
  ;(0, eval)(source)
  const cv = (self as unknown as { cv?: CvModule }).cv
  if (!cv) throw new Error("OpenCV did not start")
  return settle(cv)
}

async function settle(imported: { default?: CvModule | Promise<CvModule> } | CvModule | Promise<CvModule>) {
  const record = imported as { default?: CvModule | Promise<CvModule> }
  const cvModule = (record.default ?? imported) as CvModule | Promise<CvModule>
  if (isPromise(cvModule)) return (await cvModule) as OpenCv
  if (cvModule.Mat) return cvModule
  await new Promise<void>((resolve) => {
    cvModule.onRuntimeInitialized = () => resolve()
  })
  if (!cvModule.Mat) throw new Error("OpenCV did not start")
  return cvModule
}

function isPromise(value: CvModule | Promise<CvModule>): value is Promise<CvModule> {
  return typeof (value as Promise<CvModule>).then === "function"
}
