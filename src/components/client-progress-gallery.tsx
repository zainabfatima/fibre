"use client"

import { useEffect, useState } from "react"

import { formatCategory } from "@/lib/format"
import { groupProgressPictures } from "@/lib/progress-pictures"

type ClientProgressPicture = {
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

export function ClientProgressGallery({ pictures }: { pictures: ClientProgressPicture[] }) {
  const groups = groupProgressPictures(pictures)
  const [openId, setOpenId] = useState<string | null>(null)
  const openPicture = pictures.find((picture) => picture.id === openId) ?? null

  useEffect(() => {
    if (!openId) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId])

  return (
    <div className="grid gap-8 px-4 pb-6">
      <div>
        <h2 className="text-lg font-medium">Progress pictures</h2>
        <p className="text-sm text-muted-foreground">
          {groups.length === 0
            ? "No progress pictures yet."
            : "In each category, the newest picture is first. Earlier pictures follow in the order they were taken."}
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.categoryId} className="grid gap-3">
          <h3 className="font-medium">{formatCategory(group.categoryCode, group.categoryName)}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {group.pictures.map((picture, index) => (
              <PictureCard
                key={picture.id}
                picture={picture}
                label={index === 0 ? "Latest" : undefined}
                featured={index === 0}
                onOpen={() => setOpenId(picture.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {openPicture ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black text-white"
          role="dialog"
          aria-modal="true"
          aria-label={formatCategory(openPicture.categoryCode, openPicture.categoryName)}
        >
          <div className="flex items-center justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              <p className="font-medium break-words">
                {formatCategory(openPicture.categoryCode, openPicture.categoryName)}
              </p>
              <p className="text-sm text-white/80">{takenAt(openPicture.createdAt)}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="min-h-11 shrink-0 rounded-lg bg-white/15 px-3 text-sm"
            >
              Close
            </button>
          </div>
          {openPicture.url ? (
            // eslint-disable-next-line @next/next/no-img-element
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
  featured,
  onOpen,
}: {
  picture: ClientProgressPicture
  label?: string
  featured: boolean
  onOpen: () => void
}) {
  const when = takenAt(picture.createdAt)
  const title = formatCategory(picture.categoryCode, picture.categoryName)
  return (
    <figure className={`overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 ${featured ? "col-span-2" : ""}`}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        {picture.url ? (
          // eslint-disable-next-line @next/next/no-img-element
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
      <figcaption className="px-3 py-2 text-sm">
        {label ? <span className="font-medium">{label}</span> : null}
        {label ? <span className="text-muted-foreground"> · </span> : null}
        <span className="text-muted-foreground">{when}</span>
      </figcaption>
    </figure>
  )
}
