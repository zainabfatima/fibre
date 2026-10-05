"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export function LiveRefresh() {
  const router = useRouter()
  useEffect(() => {
    const source = new EventSource("/api/realtime")
    source.onmessage = () => router.refresh()
    return () => source.close()
  }, [router])
  return null
}
