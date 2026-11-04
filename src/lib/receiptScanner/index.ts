export { insetCorners, orderCorners } from "@/lib/receiptScanner/geometry"
export { loadOpenCV } from "@/lib/receiptScanner/opencvLoader"
export { canvasFromBlob, canvasToJpeg, detectCanvas, renderCanvas, scanReceipt } from "@/lib/receiptScanner/session"
export type { Point, ScanMode, ScanReceiptResult } from "@/lib/receiptScanner/types"
