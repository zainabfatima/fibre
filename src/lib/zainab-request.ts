import "server-only"

import { headers } from "next/headers"

import { isZainabPath } from "@/lib/zainab-path"

export async function requestIsZainab() {
  const headerList = await headers()
  if (headerList.get("x-fibre-view") === "zainab") return true
  const nextUrl = headerList.get("next-url")
  if (nextUrl && isZainabPath(nextUrl)) return true
  const referer = headerList.get("referer")
  if (!referer) return false
  try {
    return isZainabPath(new URL(referer).pathname)
  } catch {
    return false
  }
}
