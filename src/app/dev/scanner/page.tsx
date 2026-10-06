"use client"

import { useState } from "react"

import { ReceiptScanner } from "@/components/scanner/receipt-scanner"
import { ReceiptViewer } from "@/components/scanner/receipt-viewer"
import type { ScanResult } from "@/lib/scanner/types"

export default function ScannerTestPage() {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Scanner test</h1>
      <p className="text-sm text-muted-foreground">
        Try the camera, an upload, a long receipt, or a multi-page document. Nothing is saved from this page.
      </p>
      <ReceiptScanner
        onCancel={() => setResult(null)}
        onComplete={async (results) => {
          const first = results[0]
          if (!first) return
          if (url) URL.revokeObjectURL(url)
          setResult(first)
          setUrl(URL.createObjectURL(first.fileBlob))
        }}
      />
      {result && url ? (
        <section className="grid gap-2 text-sm">
          <p>
            {result.fileType} · {result.pageCount} page{result.pageCount === 1 ? "" : "s"} · {result.captureType} · {result.filter}
          </p>
          <p>{result.pages.map((page) => `${page.width}×${page.height}`).join(", ")}</p>
          <ReceiptViewer src={url} fileType={result.fileType} pageCount={result.pageCount} onClose={() => setUrl(null)} />
        </section>
      ) : null}
    </main>
  )
}
