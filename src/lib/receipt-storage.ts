const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ReceiptFileType = "image" | "pdf"

export function isUuid(value: string) {
  return UUID.test(value)
}

export function planReceiptPaths(
  projectId: string,
  id: string,
  fileType: ReceiptFileType,
  originalCount: number,
  includeThumb: boolean,
) {
  if (!isUuid(projectId) || !isUuid(id)) return null
  const count = Math.max(0, Math.min(20, Math.floor(originalCount)))
  if (count !== originalCount) return null
  const extension = fileType === "pdf" ? "pdf" : "jpg"
  const filePath = `${projectId}/0/${id}.${extension}`
  const originals = Array.from({ length: count }, (_, index) =>
    `originals/${projectId}/${count > 1 ? `${id}-p${index + 1}` : id}.jpg`,
  )
  const thumbPath = includeThumb ? `${projectId}/thumbs/${id}.webp` : null
  return { filePath, originals, thumbPath }
}

export function samePathList(expected: string[], actual: string[]) {
  return expected.length === actual.length && expected.every((path, index) => path === actual[index])
}

export function isReceiptPathForProject(projectId: string, path: string) {
  if (!isUuid(projectId) || path.includes("..")) return false
  return (
    path.startsWith(`${projectId}/0/`) ||
    path.startsWith(`${projectId}/thumbs/`) ||
    path.startsWith(`originals/${projectId}/`)
  )
}
