"use client"

import { useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"

import { deleteProject } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deleting = useRef(false)

  function close() {
    if (deleting.current) return
    setOpen(false)
    setError(null)
  }

  return (
    <>
      <Button type="button" variant="destructive" className="min-h-11" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            className="w-full max-w-md rounded-xl bg-card p-4 shadow-lg ring-1 ring-foreground/15"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="delete-project-title" className="font-medium">
              Delete this project?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{projectName}</span> and everything in it will be
              permanently deleted, including receipts, expenses, invoices, and payments. This cannot be undone.
            </p>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <form
              className="mt-4 grid gap-2"
              action={async () => {
                deleting.current = true
                const result = await deleteProject(projectId)
                if (result?.error) {
                  deleting.current = false
                  setError(result.error)
                }
              }}
            >
              <ConfirmActions onCancel={close} />
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ConfirmActions({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel, pending])

  return (
    <>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="min-h-11 w-full bg-red-700 text-white hover:bg-red-800"
      >
        {pending ? "Deleting…" : "Delete project"}
      </Button>
      <Button type="button" variant="outline" autoFocus disabled={pending} className="min-h-11 w-full" onClick={onCancel}>
        Cancel
      </Button>
    </>
  )
}
