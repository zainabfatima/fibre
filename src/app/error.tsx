"use client"

import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const message =
    error.name === "ZodError" || error.message.trim().startsWith("[{")
      ? "The page could not be loaded. Please try again."
      : error.message
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  )
}
