"use client"

import { useEffect } from "react"
import { toast } from "sonner"

import { retakeExpenseReceipt } from "@/app/actions/expenses"
import { ReceiptScanner } from "@/components/scanner/receipt-scanner"
import type { ScanResult } from "@/lib/scanner/types"

export function ReceiptRetake({
  projectId,
  expenseId,
  categoryId,
  onClose,
  onSaved,
}: {
  projectId: string
  expenseId: string
  categoryId: number | null
  onClose: () => void
  onSaved: () => void
}) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  async function save(results: ScanResult[]) {
    const result = results[0]
    if (!result || results.length !== 1) {
      throw new Error("Retake replaces this one receipt. Add extra photos as pages, then tap Done.")
    }
    const body = new FormData()
    body.set("projectId", projectId)
    body.set("expenseId", expenseId)
    body.set("hashes", result.pageHashes.join(","))
    body.set("captureType", result.captureType)
    body.set("pageCount", String(result.pageCount))
    body.set("cropMethod", result.cropMethod)
    body.set("needsManualCrop", result.needsManualCrop ? "true" : "false")
    body.set("cropCorners", JSON.stringify(result.pages.map((page) => page.cropCorners)))
    body.set(
      "file",
      result.fileType === "pdf"
        ? new File([result.fileBlob], "receipt.pdf", { type: "application/pdf" })
        : new File([result.fileBlob], "receipt.jpg", { type: "image/jpeg" }),
    )
    result.originals.forEach((original) => {
      body.append("original", new File([original], "original.jpg", { type: original.type || "image/jpeg" }))
    })
    body.set("thumb", new File([result.thumbnailBlob], "thumb.webp", { type: result.thumbnailBlob.type || "image/webp" }))
    const uploaded = await retakeExpenseReceipt(body)
    if (uploaded.error || !uploaded.id) throw new Error(uploaded.error || "Could not save the new photo")

    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(categoryId == null ? { expenseId } : { expenseId, categoryId }),
    })
    const extracted = (await response.json()) as { ok?: boolean; error?: string }
    if (uploaded.warning) toast.message(uploaded.warning)
    else if (extracted.ok === false) toast.message(extracted.error || "Photo saved. The amount still needs a look.")
    else toast.success("New photo saved")
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <ReceiptScanner replacing startInCamera onCancel={onClose} onComplete={save} />
    </div>
  )
}
