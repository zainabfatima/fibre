"use client"

import { useRef, useState } from "react"
import Link from "next/link"

import { lookupReceiptHash, uploadReceipt } from "@/app/actions/expenses"
import { Button } from "@/components/ui/button"

type Item = {
  id: string
  name: string
  status: "queued" | "uploading" | "extracting" | "ready" | "duplicate" | "error"
  detail?: string
  expenseId?: string
}

async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function toJpeg(file: File) {
  const lower = file.name.toLowerCase()
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    return { upload: file, thumb: null as Blob | null }
  }
  let blob: Blob = file
  if (lower.endsWith(".heic") || lower.endsWith(".heif") || file.type.includes("heic")) {
    const heic2any = (await import("heic2any")).default
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })
    blob = Array.isArray(converted) ? converted[0] : converted
  }
  const imageCompression = (await import("browser-image-compression")).default
  const source = new File([blob], "receipt.jpg", { type: "image/jpeg" })
  const compressed = await imageCompression(source, {
    maxWidthOrHeight: 1600,
    initialQuality: 0.8,
    fileType: "image/jpeg",
    useWebWorker: true,
  })
  const thumb = await makeThumb(compressed)
  return { upload: compressed, thumb }
}

async function makeThumb(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const edge = Math.max(bitmap.width, bitmap.height)
  const scale = 300 / edge
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return null
  context.drawImage(bitmap, 0, 0, width, height)
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", 0.8)
  })
}

export function UploadQueue({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const filesRef = useRef(new Map<string, File>())

  function update(id: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function processFile(item: Item, file: File) {
    try {
      update(item.id, { status: "uploading", detail: "Checking for a duplicate" })
      const hash = await sha256(file)
      const existing = await lookupReceiptHash(projectId, hash)
      if (existing.error) throw new Error(existing.error)
      if (existing.duplicate) {
        update(item.id, {
          status: "duplicate",
          detail: `Duplicate receipt — already uploaded on ${existing.duplicate.date}`,
          expenseId: existing.duplicate.id,
        })
        return
      }
      update(item.id, { detail: "Compressing" })
      const prepared = await toJpeg(file)
      const body = new FormData()
      body.set("projectId", projectId)
      body.set("hash", hash)
      body.set("file", prepared.upload, file.name)
      if (prepared.thumb) body.set("thumb", prepared.thumb, "thumb.jpg")
      const uploaded = await uploadReceipt(body)
      if (uploaded.error) {
        update(item.id, {
          status: uploaded.existingId ? "duplicate" : "error",
          detail: uploaded.error,
          expenseId: uploaded.existingId,
        })
        return
      }
      update(item.id, { status: "extracting", detail: "Reading the receipt", expenseId: uploaded.id })
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId: uploaded.id }),
      })
      const result = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || result.ok === false) {
        update(item.id, {
          status: "ready",
          detail: result.error || "Saved for review. Extraction needs another try.",
          expenseId: uploaded.id,
        })
        return
      }
      update(item.id, { status: "ready", detail: "Ready for review", expenseId: uploaded.id })
    } catch (cause) {
      update(item.id, {
        status: "error",
        detail: cause instanceof Error ? cause.message : "Upload failed",
      })
    }
  }

  async function run(files: File[]) {
    const queued = files.map((file) => {
      const id = crypto.randomUUID()
      filesRef.current.set(id, file)
      return {
        id,
        name: file.name,
        status: "queued" as const,
        file,
      }
    })
    setItems((current) => [...queued.map(({ file: _file, ...item }) => item), ...current])
    setRunning(true)
    const queue = [...queued]
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) return
        await processFile(next, next.file)
      }
    })
    await Promise.all(workers)
    setRunning(false)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div
        className="rounded-xl border border-dashed border-border bg-card p-5 text-center sm:p-8"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void run([...event.dataTransfer.files])
        }}
      >
        <p className="font-medium">Drop receipts here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          JPG, PNG, HEIC, or PDF. You can drop 50 or more at once.
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
                void run(files)
              }}
            />
          </label>
          <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm">
            Camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ""
                void run(files)
              }}
            />
          </label>
        </div>
      </div>
      {running ? <p className="text-sm text-muted-foreground">Working through the queue…</p> : null}
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
            {item.status === "error" && filesRef.current.get(item.id) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  const file = filesRef.current.get(item.id)
                  if (file) void processFile(item, file)
                }}
              >
                Retry
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
