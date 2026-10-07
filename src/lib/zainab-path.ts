export const ZAINAB_PREFIX = "/zainab"

export function isZainabPath(pathname: string) {
  return pathname === ZAINAB_PREFIX || pathname.startsWith(`${ZAINAB_PREFIX}/`)
}

export function stripZainab(pathname: string) {
  if (!isZainabPath(pathname)) return pathname
  if (pathname === ZAINAB_PREFIX) return "/"
  return pathname.slice(ZAINAB_PREFIX.length) || "/"
}

export function withZainab(path: string, enabled: boolean) {
  if (!enabled) return path
  const hashAt = path.indexOf("#")
  const hash = hashAt >= 0 ? path.slice(hashAt) : ""
  const withoutHash = hashAt >= 0 ? path.slice(0, hashAt) : path
  const queryAt = withoutHash.indexOf("?")
  const pathname = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash
  const search = queryAt >= 0 ? withoutHash.slice(queryAt) : ""
  if (!pathname.startsWith("/") || isZainabPath(pathname)) return path
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/client") ||
    pathname.startsWith("/_next/")
  ) {
    return path
  }
  const next = pathname === "/" ? "" : pathname
  return `${ZAINAB_PREFIX}${next}${search}${hash}`
}
