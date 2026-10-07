"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { saveScannedReceipt } from "@/app/actions/expenses"
import { ReceiptScanner } from "@/components/scanner/receipt-scanner"
import { formatCategory } from "@/lib/format"
import type { ScanResult } from "@/lib/scanner/types"

type Item = {
  id: string
  name: string
  status: "uploading" | "extracting" | "duplicate" | "error"
  detail?: string
  expenseId?: string
}

type CategoryOption = {
  id: number
  code: number
  name: string
}

async function readReceipt(expenseId: string, categoryId: number | null) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(categoryId == null ? { expenseId } : { expenseId, categoryId }),
  })
  return (await response.json()) as { ok?: boolean; error?: string; confidence?: number }
}

export function UploadQueue({
  projectId,
  categories,
}: {
  projectId: string
  categories: CategoryOption[]
}) {
  const router = useRouter()
  const storageKey = `fibre-upload-category:${projectId}`
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [scan, setScan] = useState<{ files: File[]; camera: boolean } | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [manual, setManual] = useState(true)
  const [categoryId, setCategoryId] = useState("")
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { manual?: unknown; categoryId?: unknown }
        if (typeof parsed.manual === "boolean") setManual(parsed.manual)
        if (
          typeof parsed.categoryId === "string" &&
          categories.some((category) => String(category.id) === parsed.categoryId)
        ) {
          setCategoryId(parsed.categoryId)
        }
      }
    } catch {
      // Keep the default: manual category on, nothing selected yet.
    }
    setHydrated(true)
  }, [storageKey, categories])

  useEffect(() => {
    if (!hydrated) return
    sessionStorage.setItem(storageKey, JSON.stringify({ manual, categoryId }))
  }, [hydrated, manual, categoryId, storageKey])

  function update(id: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function chosenCategoryId() {
    if (!manual) return null
    const parsed = Number(categoryId)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function startScan(files: File[], camera: boolean) {
    if (manual && !chosenCategoryId()) {
      setCategoryError("Pick a category before uploading receipts.")
      return
    }
    setCategoryError(null)
    setScan({ files, camera })
  }

  async function saveResults(results: ScanResult[]) {
    const fromCamera = scan?.camera === true
    const lockedCategory = chosenCategoryId()
    if (manual && lockedCategory == null) {
      setCategoryError("Pick a category before uploading receipts.")
      setScan(null)
      return
    }
    setScan(null)
    setRunning(true)
    setReviewId(null)
    setSavedNote(null)
    let firstReady: string | null = null
    let hadProblem = false
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
        if (lockedCategory != null) body.set("categoryId", String(lockedCategory))
        const uploaded = await saveScannedReceipt(body)
        if (uploaded.error || !uploaded.id) {
          hadProblem = true
          update(id, {
            status: uploaded.existingId ? "duplicate" : "error",
            detail: uploaded.error,
            expenseId: uploaded.existingId,
          })
          continue
        }
        update(id, { status: "extracting", detail: "Reading the amount", expenseId: uploaded.id })
        const extracted = await readReceipt(uploaded.id, lockedCategory)
        if (extracted.ok === false) {
          hadProblem = true
          update(id, {
            status: "error",
            detail: extracted.error || "Saved for review. The amount still needs a look.",
            expenseId: uploaded.id,
          })
        } else {
          setItems((current) => current.filter((item) => item.id !== id))
        }
        firstReady = firstReady ?? uploaded.id
      } catch (cause) {
        hadProblem = true
        update(id, { status: "error", detail: cause instanceof Error ? cause.message : "Upload failed" })
      }
    }
    setRunning(false)
    if (!firstReady) return
    router.refresh()
    if (fromCamera) {
      if (hadProblem) setReviewId(firstReady)
      else setSavedNote("Saved. Open Review when you are ready.")
      return
    }
    if (!hadProblem) {
      router.push(`/projects/${projectId}/review?expense=${firstReady}`)
      return
    }
    setReviewId(firstReady)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="grid gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={manual}
            onChange={(event) => {
              setManual(event.target.checked)
              setCategoryError(null)
            }}
            className="size-5 shrink-0"
          />
          Choose category myself
        </label>
        {manual ? (
          <label className="grid gap-1 text-base">
            Category
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value)
                setCategoryError(null)
              }}
              className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base"
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {formatCategory(category.code, category.name)}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">
              This category stays selected for the next receipts.
            </span>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            Claude will suggest a category for each receipt.
          </p>
        )}
        {categoryError ? (
          <p role="alert" className="text-sm text-red-700">
            {categoryError}
          </p>
        ) : null}
      </div>
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
            startScan([...event.dataTransfer.files], false)
          }}
        >
          <p className="font-medium">Drop receipts here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every photo is saved as a black-and-white PDF.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <label
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={(event) => {
                if (manual && !chosenCategoryId()) {
                  event.preventDefault()
                  setCategoryError("Pick a category before uploading receipts.")
                }
              }}
            >
              Choose files
              <input
                type="file"
                accept="image/*,.heic,.heif,application/pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  event.target.value = ""
                  if (files.length) startScan(files, false)
                }}
              />
            </label>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => startScan([], true)}
            >
              Camera
            </button>
          </div>
        </div>
      )}
      {running ? <p className="text-sm text-muted-foreground">Saving the scan…</p> : null}
      {savedNote ? <p className="text-sm text-muted-foreground">{savedNote}</p> : null}
      {reviewId ? (
        <Link
          href={`/projects/${projectId}/review?expense=${reviewId}`}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Open Review
        </Link>
      ) : null}
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
