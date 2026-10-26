export type ProgressPictureRef = {
  id: string
  categoryId: number
  categoryCode: number
  categoryName: string
  createdAt: string
}

export type ProgressPictureGroup<T extends ProgressPictureRef> = {
  categoryId: number
  categoryCode: number
  categoryName: string
  pictures: T[]
}

/** Newest photo first, then the earlier photos in the order they were uploaded. */
export function orderProgressPictures<T extends { id: string; createdAt: string }>(pictures: T[]): T[] {
  const chronological = [...pictures].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt)
    if (byTime !== 0) return byTime
    return a.id.localeCompare(b.id)
  })
  if (chronological.length <= 1) return chronological
  const latest = chronological[chronological.length - 1]
  return [latest, ...chronological.slice(0, -1)]
}

/** Category sections follow category code. Inside each one, the latest photo leads. */
export function groupProgressPictures<T extends ProgressPictureRef>(pictures: T[]): ProgressPictureGroup<T>[] {
  const buckets = new Map<number, T[]>()
  for (const picture of pictures) {
    const bucket = buckets.get(picture.categoryId)
    if (bucket) bucket.push(picture)
    else buckets.set(picture.categoryId, [picture])
  }
  return [...buckets.values()]
    .map((bucket) => {
      const first = bucket[0]
      return {
        categoryId: first.categoryId,
        categoryCode: first.categoryCode,
        categoryName: first.categoryName,
        pictures: orderProgressPictures(bucket),
      }
    })
    .sort((a, b) => a.categoryCode - b.categoryCode || a.categoryName.localeCompare(b.categoryName))
}
