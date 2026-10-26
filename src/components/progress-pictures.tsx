"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { deleteProgressPicture, saveProgressPicture } from "@/app/actions/progress-pictures"
import { CameraCapture } from "@/components/scanner/camera-capture"
import { formatCategory } from "@/lib/format"
import { groupProgressPictures } from "@/lib/progress-pictures"
import { decodeReceiptFile, rasterToJpegBlob, scaleLongSide } from "@/lib/receiptCrop"

type CategoryOption = {
  id: number
  code: number
  name: string
}

type Picture = {
  id: string
  categoryId: number
  categoryCode: number
  categoryName: string
  createdAt: string
  url: string | null
}

function takenAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function photoError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "This photo could not be opened"
  return message.replaceAll("receipt", "photo").replaceAll("Receipt", "Photo")
}

async function toJpeg(file: Blob) {
  const raster = scaleLongSide(await decodeReceiptFile(file), 2400)
  return rasterToJpegBlob(raster, 0.9)
}

export function ProgressPictures({
  projectId,
  categories,
  pictures,
}: {
  projectId: string
  categories: CategoryOption[]
  pictures: Picture[]
}) {
  const router = useRouter()
  const storageKey = `fibre-progress-category:${projectId}`
  const [categoryId, setCategoryId] = useState("")
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved && categories.some((category) => String(category.id) === saved)) {
        setCategoryId(saved)
      }
    } catch {
      // Keep the empty selection.
    }
    setHydrated(true)
  }, [storageKey, categories])

  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(storageKey, categoryId)
    } catch {
      // The next picture can be chosen again.
    }
  }, [hydrated, categoryId, storageKey])

  const groups = groupProgressPictures(pictures)
  const openPicture = pictures.find((picture) => picture.id === openId) ?? null

  function chosenCategoryId() {
    const parsed = Number(categoryId)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function requireCategory() {
    if (chosenCategoryId()) {
      setCategoryError(null)
      return true
    }
    setCategoryError("Pick a category before taking a picture.")
    return false
  }

  async function upload(file: Blob) {
    const locked = chosenCategoryId()
    if (locked == null) {
      setCategoryError("Pick a category before taking a picture.")
      return
    }
    setUploadError(null)
    setNotice("Saving the picture…")
    try {
      const jpeg = await toJpeg(file)
      const body = new FormData()
      body.set("projectId", projectId)
      body.set("categoryId", String(locked))
      body.set("file", new File([jpeg], "progress.jpg", { type: "image/jpeg" }))
      const saved = await saveProgressPicture(body)
      if (saved.error || !saved.id) {
        setUploadError(saved.error || "The picture could not be saved.")
        return
      }
      router.refresh()
    } catch (cause) {
      setUploadError(photoError(cause))
    } finally {
      setNotice(null)
    }
  }

  async function remove(pictureId: string) {
    if (!window.confirm("Delete this progress picture?")) return
    setUploadError(null)
    setNotice("Deleting the picture…")
    try {
      const result = await deleteProgressPicture(projectId, pictureId)
      if (result.error) {
        setUploadError(result.error)
        return
      }
      if (openId === pictureId) setOpenId(null)
      router.refresh()
    } finally {
      setNotice(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-x-hidden px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="grid gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
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
            This category stays selected for the next pictures.
          </span>
        </label>
        {categoryError ? (
          <p role="alert" className="text-sm text-red-700">
            {categoryError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(notice)}
            className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => {
              if (requireCategory()) setCamera(true)
            }}
          >
            Take picture
          </button>
          <label
            className={`inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-2 text-sm ${notice ? "opacity-50" : "cursor-pointer"}`}
            onClick={(event) => {
              if (notice || !requireCategory()) event.preventDefault()
            }}
          >
            Choose photo
            <input
              type="file"
              accept="image/*,.heic,.heif"
              disabled={Boolean(notice)}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) void upload(file)
              }}
            />
          </label>
        </div>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        {uploadError ? (
          <p role="alert" className="text-sm text-red-700">
            {uploadError}
          </p>
        ) : null}
      </div>

      {camera ? (
        <CameraCapture
          pageNumber={1}
          fullFrame
          onClose={() => setCamera(false)}
          onCapture={(blob) => {
            setCamera(false)
            void upload(blob)
          }}
        />
      ) : null}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No progress pictures yet.</p>
      ) : (
        <div className="grid gap-8">
          <p className="text-sm text-muted-foreground">
            In each category, the newest picture is first. Earlier pictures follow in the order they were taken.
          </p>
          {groups.map((group) => {
            const [latest, ...earlier] = group.pictures
            if (!latest) return null
            return (
              <section key={group.categoryId} className="grid gap-3">
                <h2 className="text-lg font-medium">{formatCategory(group.categoryCode, group.categoryName)}</h2>
                <PictureCard
                  picture={latest}
                  label="Latest"
                  pending={Boolean(notice)}
                  onOpen={() => setOpenId(latest.id)}
                  onDelete={() => void remove(latest.id)}
                />
                {earlier.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {earlier.map((picture) => (
                      <PictureCard
                        key={picture.id}
                        picture={picture}
                        pending={Boolean(notice)}
                        onOpen={() => setOpenId(picture.id)}
                        onDelete={() => void remove(picture.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      {openPicture ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black text-white"
          role="dialog"
          aria-modal="true"
          aria-label={formatCategory(openPicture.categoryCode, openPicture.categoryName)}
        >
          <div className="flex items-center justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div>
              <p className="font-medium">{formatCategory(openPicture.categoryCode, openPicture.categoryName)}</p>
              <p className="text-sm text-white/80">{takenAt(openPicture.createdAt)}</p>
            </div>
            <button type="button" onClick={() => setOpenId(null)} className="min-h-11 rounded-lg bg-white/15 px-3 text-sm">
              Close
            </button>
          </div>
          {openPicture.url ? (
            <img
              src={openPicture.url}
              alt={`${formatCategory(openPicture.categoryCode, openPicture.categoryName)} progress picture`}
              className="min-h-0 flex-1 object-contain"
            />
          ) : (
            <p className="px-4 text-sm">This picture is unavailable.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function PictureCard({
  picture,
  label,
  pending,
  onOpen,
  onDelete,
}: {
  picture: Picture
  label?: string
  pending: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const when = takenAt(picture.createdAt)
  const title = formatCategory(picture.categoryCode, picture.categoryName)
  return (
    <figure className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        {picture.url ? (
          <img
            src={picture.url}
            alt={`${title}, ${when}`}
            className="aspect-[4/3] w-full bg-muted object-contain"
          />
        ) : (
          <span className="flex aspect-[4/3] items-center justify-center bg-muted px-3 text-center text-sm text-muted-foreground">
            Picture unavailable
          </span>
        )}
      </button>
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span>
          {label ? <span className="font-medium">{label}</span> : null}
          {label ? <span className="text-muted-foreground"> · </span> : null}
          <span className="text-muted-foreground">{when}</span>
        </span>
        <button type="button" onClick={onDelete} disabled={pending} className="shrink-0 underline disabled:opacity-50">
          Delete
        </button>
      </figcaption>
    </figure>
  )
}
