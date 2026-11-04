export type Point = { x: number; y: number }

export type ScanMode = "scan" | "color"

export type ScanReceiptResult = {
  blob: Blob
  width: number
  height: number
  corners: Point[] | null
  detected: boolean
  glareRatio: number
  glareSevere: boolean
}

export type CvMat = {
  rows: number
  cols: number
  data: Uint8Array
  data32S: Int32Array
  channels: () => number
  type: () => number
  clone: () => CvMat
  copyTo: (destination: CvMat) => void
  roi: (rect: unknown) => CvMat
  setTo: (value: unknown, mask?: CvMat) => void
  delete: () => void
}

export type CvContourVector = {
  size: () => number
  get: (index: number) => CvMat
  push_back: (mat: CvMat) => void
  delete: () => void
}

export type OpenCv = {
  Mat: {
    new (): CvMat
    new (rows: number, cols: number, type: number, scalar?: unknown): CvMat
  }
  MatVector: new () => CvContourVector
  Size: new (width: number, height: number) => unknown
  Rect: new (x: number, y: number, width: number, height: number) => unknown
  Scalar: new (v0: number, v1?: number, v2?: number, v3?: number) => unknown
  CLAHE: new (clipLimit: number, tileGridSize: unknown) => { apply: (src: CvMat, dst: CvMat) => void; delete: () => void }
  CV_8UC1: number
  CV_8UC3: number
  CV_8UC4: number
  CV_8U: number
  CV_32FC2: number
  COLOR_RGBA2GRAY: number
  COLOR_RGB2GRAY: number
  COLOR_RGBA2RGB: number
  COLOR_RGB2RGBA: number
  COLOR_GRAY2RGB: number
  COLOR_GRAY2RGBA: number
  COLOR_RGB2HSV: number
  COLOR_HSV2RGB: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number
  MORPH_RECT: number
  MORPH_CLOSE: number
  THRESH_BINARY: number
  THRESH_OTSU: number
  INTER_AREA: number
  INTER_CUBIC: number
  BORDER_REPLICATE: number
  INPAINT_TELEA: number
  matFromArray: (rows: number, cols: number, type: number, array: ArrayLike<number>) => CvMat
  matFromImageData?: (imageData: ImageData) => CvMat
  resize: (src: CvMat, dst: CvMat, size: unknown, fx: number, fy: number, interpolation: number) => void
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void
  GaussianBlur: (src: CvMat, dst: CvMat, size: unknown, sigma: number) => void
  Canny: (src: CvMat, dst: CvMat, low: number, high: number) => void
  dilate: (src: CvMat, dst: CvMat, kernel: CvMat) => void
  getStructuringElement: (shape: number, size: unknown) => CvMat
  findContours: (image: CvMat, contours: CvContourVector, hierarchy: CvMat, mode: number, method: number) => void
  arcLength: (curve: CvMat, closed: boolean) => number
  approxPolyDP: (curve: CvMat, approx: CvMat, epsilon: number, closed: boolean) => void
  contourArea: (contour: CvMat) => number
  isContourConvex: (contour: CvMat) => boolean
  threshold: (src: CvMat, dst: CvMat, thresh: number, maxval: number, type: number) => number
  minAreaRect: (points: CvMat) => unknown
  boxPoints?: (rect: unknown) => Array<{ x: number; y: number }>
  RotatedRect: { points: (rect: unknown) => Array<{ x: number; y: number }> }
  getPerspectiveTransform: (src: CvMat, dst: CvMat) => CvMat
  warpPerspective: (src: CvMat, dst: CvMat, matrix: CvMat, size: unknown, flags: number, borderMode: number) => void
  inRange: (src: CvMat, lower: CvMat, upper: CvMat, dst: CvMat) => void
  countNonZero: (src: CvMat) => number
  inpaint: (src: CvMat, mask: CvMat, dst: CvMat, radius: number, flags: number) => void
  morphologyEx: (src: CvMat, dst: CvMat, op: number, kernel: CvMat) => void
  add: (src1: CvMat, src2: CvMat, dst: CvMat) => void
  divide: (src1: CvMat, src2: CvMat, dst: CvMat, scale: number, dtype: number) => void
  split: (src: CvMat, planes: CvContourVector) => void
  merge: (planes: CvContourVector, dst: CvMat) => void
}
