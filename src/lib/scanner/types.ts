export type ScanFilter = "original" | "clean" | "bw" | "gray"
export type CaptureType = "single" | "long" | "multi_page"

export type Point = { x: number; y: number }

export type PageChecks = {
  blurry: boolean
  tooSmall: boolean
  glare: boolean
  dark: boolean
  joins: boolean
}

export type ScanPageMeta = {
  width: number
  height: number
  cropCorners: Point[]
  filter: ScanFilter
  checks: PageChecks
}

export type ScanResult = {
  fileBlob: Blob
  fileType: "image" | "pdf"
  pageCount: number
  thumbnailBlob: Blob
  originals: Blob[]
  pageHashes: string[]
  filter: ScanFilter
  captureType: CaptureType
  cropMethod: "auto" | "fallback" | "manual" | "none"
  needsManualCrop: boolean
  pages: ScanPageMeta[]
  /** Re-render the same crops with another filter. Used when extraction confidence is low. */
  rerender: (filter: ScanFilter) => Promise<Blob>
}
