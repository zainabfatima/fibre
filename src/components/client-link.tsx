"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

export function ClientLink({ code }: { code: string | null }) {
  const path = code ? `/client/${code}` : ""
  const [url, setUrl] = useState(path)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!path) return
    setUrl(`${window.location.origin}${path}`)
  }, [path])

  if (!code) {
    return (
      <p className="max-w-xs text-sm text-muted-foreground">This project has no client number.</p>
    )
  }

  async function copy() {
    const full = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="w-full rounded-lg bg-card p-3 ring-1 ring-foreground/10 sm:max-w-sm sm:shrink-0">
      <p className="text-sm font-medium">Client link</p>
      <p className="mt-1 text-sm break-all text-muted-foreground">{url}</p>
      <p className="mt-1 text-sm">Client enters {code}.</p>
      <Button type="button" variant="outline" className="mt-2 h-10 px-3" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  )
}
