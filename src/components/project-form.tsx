"use client"

import { useActionState } from "react"

import { createProject, updateProject, type ActionState } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: ActionState = { error: null }

export function ProjectForm({
  project,
}: {
  project?: {
    id: string
    name: string
    address: string | null
    client_name: string | null
    client_email: string | null
    contract_amount: number | null
    status: "active" | "completed" | "on_hold"
    invoice_tracking: boolean
  }
}) {
  const action = project ? updateProject : createProject
  const [state, formAction, pending] = useActionState(action, initial)

  return (
    <form action={formAction} className="grid gap-4">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      <Field label="Project name" name="name" defaultValue={project?.name} required />
      <Field label="Address" name="address" defaultValue={project?.address ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client name" name="clientName" defaultValue={project?.client_name ?? ""} />
        <Field label="Client email" name="clientEmail" defaultValue={project?.client_email ?? ""} />
      </div>
      <Field
        label="Contract amount"
        name="contractAmount"
        defaultValue={project?.contract_amount == null ? "" : String(project.contract_amount)}
      />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Do you want invoice tracking?</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="invoiceTracking"
            value="yes"
            required
            defaultChecked={project?.invoice_tracking === true}
          />
          Yes — also track invoice numbers, files, and paid or unpaid on each expense
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="invoiceTracking"
            value="no"
            required
            defaultChecked={project ? !project.invoice_tracking : true}
          />
          No — expenses only
        </label>
        <p className="text-sm text-muted-foreground">
          Money received from the client is always available, either way.
        </p>
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={project?.status ?? "active"}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : project ? "Save project" : "Create project"}
      </Button>
    </form>
  )
}

function Field({
  label,
  name,
  defaultValue,
  required,
}: {
  label: string
  name: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} required={required} />
    </div>
  )
}
