"use client"

import { useState } from "react"
import Link from "next/link"

import { saveScannedReceipt } from "@/app/actions/expenses"
import { ReceiptScanner } from "@/components/scanner/receipt-scanner"
import type { ScanResult } from "@/lib/scanner/types"

type Item = {
  id: string
  name: string
  status: "uploading" | "extracting" | "ready" | "duplicate" | "error"
  detail?: string
  expenseId?: string
}

async function readReceipt(expenseId: string) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expenseId }),
  })
  return (await response.json()) as { ok?: boolean; error?: string; confidence?: number }
}

export function UploadQueue({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [scan, setScan] = useState<{ files: File[]; camera: boolean } | null>(null)

  function update(id: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function saveResults(results: ScanResult[]) {
    setScan(null)
    setRunning(true)
    for (const result of results) {
      const id = crypto.randomUUID()
      setItems((current) => [
        { id, name: result.pageCount > 1 ? `Scan · ${result.pageCount} pages` : "Scanned receipt", status: "uploading", detail: "Saving the scan" },
        ...current,
      ])
      try {
        const body = new FormData()
        body.set("projectId", projectId)
        body.set("hashes", result.pageHashes.join(","))
        body.set("captureType", result.captureType)
        body.set("pageCount", String(result.pageCount))
        body.set("file", new File([result.fileBlob], "receipt.pdf", { type: "application/pdf" }))
        body.set("thumb", new File([result.thumbnailBlob], "thumb.webp", { type: result.thumbnailBlob.type || "image/webp" }))
        const uploaded = await saveScannedReceipt(body)
        if (uploaded.error || !uploaded.id) {
          update(id, {
            status: uploaded.existingId ? "duplicate" : "error",
            detail: uploaded.error,
            expenseId: uploaded.existingId,
          })
          continue
        }
        update(id, { status: "extracting", detail: "Reading the receipt", expenseId: uploaded.id })
        const extracted = await readReceipt(uploaded.id)
        update(id, {
          status: "ready",
          detail: extracted.ok === false ? extracted.error || "Saved for review. Extraction needs another try." : "Ready for review",
          expenseId: uploaded.id,
        })
      } catch (cause) {
        update(id, { status: "error", detail: cause instanceof Error ? cause.message : "Upload failed" })
      }
    }
    setRunning(false)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {scan ? (
        <ReceiptScanner
          initialFiles={scan.files}
          startInCamera={scan.camera}
          onCancel={() => setScan(null)}
          onComplete={saveResults}
        />
      ) : (
        <div
          className="rounded-xl border border-dashed border-border bg-card p-5 text-center sm:p-8"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setScan({ files: [...event.dataTransfer.files], camera: false })
          }}
        >
          <p className="font-medium">Drop receipts here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every photo is saved as a black-and-white PDF.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <label className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              Choose files
              <input
                type="file"
                accept="image/*,.heic,.heif,application/pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  event.target.value = ""
                  if (files.length) setScan({ files, camera: false })
                }}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => setScan({ files: [], camera: true })}
            >
              Camera
            </button>
          </div>
        </div>
      )}
      {running ? <p className="text-sm text-muted-foreground">Saving the scan…</p> : null}
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-muted-foreground">{item.detail || item.status}</p>
              </div>
              {item.expenseId ? (
                <Link href={`/projects/${projectId}/review?expense=${item.expenseId}`} className="underline">
                  Review
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
