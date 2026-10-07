"use client"

import { createContext, useContext, useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { withZainab } from "@/lib/zainab-path"

const ViewModeContext = createContext(false)

export function ViewModeProvider({
  zainab,
  children,
}: {
  zainab: boolean
  children: ReactNode
}) {
  return <ViewModeContext.Provider value={zainab}>{children}</ViewModeContext.Provider>
}

export function useZainab() {
  return useContext(ViewModeContext)
}

export function ZainabLinkGuard() {
  const zainab = useZainab()
  const router = useRouter()

  useEffect(() => {
    if (!zainab) return
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a")
      if (!anchor || (anchor.target && anchor.target !== "_self")) return
      const raw = anchor.getAttribute("href")
      if (!raw || raw.startsWith("#")) return
      let path = raw
      if (raw.startsWith("http")) {
        try {
          const url = new URL(raw)
          if (url.origin !== window.location.origin) return
          path = `${url.pathname}${url.search}${url.hash}`
        } catch {
          return
        }
      }
      if (!path.startsWith("/")) return
      const next = withZainab(path, true)
      if (next === path) return
      event.preventDefault()
      event.stopPropagation()
      router.push(next)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [router, zainab])

  return null
}
