"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Unmatched = { row: number; name: string; amount: string; reason: string }

export function BudgetSheetUpload() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<Unmatched[]>([])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get("file")
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose an Excel file.")
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/budgets", { method: "POST", body: data })
      const result = (await response.json()) as {
        error?: string | null
        matched?: number
        unmatched?: Unmatched[]
      }
      setUnmatched(result.unmatched ?? [])
      if (!response.ok || result.error) {
        setError(result.error || "Could not save that budget sheet")
        return
      }
      const matched = result.matched ?? 0
      const skipped = result.unmatched?.length ?? 0
      setMessage(
        `Set the default budget for ${matched} ${matched === 1 ? "category" : "categories"}. Categories left off the sheet are $0.00. Every project uses these amounts unless that category was changed by hand.${skipped ? " Rows that did not match are listed below and were not saved." : ""}`,
      )
      form.reset()
      router.refresh()
    } catch {
      setError("Could not upload that budget sheet")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div>
        <h2 className="font-medium">Budget sheet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload an Excel file with two columns: category name and budget amount. Claude matches each
          row to the 59 categories, even if a name is slightly different. This becomes the default
          budget on every project, including projects you create later. A new file replaces those
          defaults. A budget you change by hand on one project stays on that project only.
        </p>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Excel file</span>
        <input
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="block w-full min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:text-sm file:font-medium file:text-primary-foreground"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-fit"
      >
        {pending ? "Reading sheet…" : "Upload budget sheet"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {unmatched.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">These rows were not saved</p>
          <ul className="mt-2 grid gap-1">
            {unmatched.map((row) => (
              <li key={`${row.row}-${row.name}`} className="break-words">
                Row {row.row}: {row.name || "Blank name"} ({row.amount}) — {row.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  )
}
