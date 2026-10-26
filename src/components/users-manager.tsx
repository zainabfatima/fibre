"use client"

import { useActionState, useEffect, useState } from "react"

import {
  addAccount,
  removeAccount,
  resendAccount,
  reviewSignup,
  submitTestEmail,
  updateAccount,
  type UserFormState,
} from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ProjectOption = {
  id: string
  name: string
  address: string | null
}

type SignupRequest = {
  id: string
  login_id: string
  email: string | null
  requested_project_name: string | null
  requested_address: string | null
  status: string
  suggestedPassword: string
  matchText: string
  suggestedProjectId: string
}

type AccountRow = {
  id: string
  login_id: string
  email: string | null
  role: "admin" | "client"
  project_ids: string[]
}

const initial: UserFormState = { error: null, message: null }
const fieldClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function Notice({ state }: { state: UserFormState }) {
  if (state.error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  }
  if (state.message) {
    return (
      <p className="text-sm text-emerald-800" role="status">
        {state.message}
      </p>
    )
  }
  return null
}

function ProjectChecks({
  projects,
  selected,
  onChange,
  defaultSelected,
  id,
}: {
  projects: ProjectOption[]
  selected?: string[]
  onChange?: (ids: string[]) => void
  defaultSelected?: string[]
  id?: string
}) {
  const controlled = selected !== undefined
  const initial = new Set(defaultSelected ?? [])
  return (
    <div id={id} className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-input p-2">
      {projects.length === 0 ? (
        <p className="px-1 py-1.5 text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        projects.map((project) => (
          <label key={project.id} className="flex items-start gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-accent">
            <input
              type="checkbox"
              name="projectIds"
              value={project.id}
              className="mt-0.5"
              {...(controlled
                ? {
                    checked: selected.includes(project.id),
                    onChange: (event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(project.id)
                      else next.delete(project.id)
                      onChange?.([...next])
                    },
                  }
                : { defaultChecked: initial.has(project.id) })}
            />
            <span>
              {project.name}
              {project.address ? <span className="block text-xs text-muted-foreground">{project.address}</span> : null}
            </span>
          </label>
        ))
      )}
    </div>
  )
}

function TestMail() {
  const [state, action, pending] = useActionState(submitTestEmail, initial)
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">Check the office mailbox with a test message.</p>
      <div className="flex flex-col gap-2 sm:items-end">
        <Button type="submit" variant="outline" className="h-10" disabled={pending}>
          {pending ? "Sending…" : "Send test email"}
        </Button>
        <Notice state={state} />
      </div>
    </form>
  )
}

function RequestCard({ request, projects }: { request: SignupRequest; projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState(reviewSignup, initial)
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
    <form action={action} autoComplete="off" className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={request.id} />
      <div>
        <p className="font-medium">{request.email || request.login_id}</p>
        <p className="text-sm text-muted-foreground">
          {request.status === "rejected" ? "Rejected. " : ""}
          {request.requested_project_name || "No project name"}
          {request.requested_address ? ` — ${request.requested_address}` : ""}
        </p>
        <p className="mt-1 text-sm">{request.matchText}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`login-${request.id}`}>User ID</Label>
          <Input id={`login-${request.id}`} name="loginId" defaultValue={request.email || request.login_id} required className="h-10" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`email-${request.id}`}>Email</Label>
          <Input id={`email-${request.id}`} name="email" type="email" defaultValue={request.email || request.login_id} required className="h-10" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`password-${request.id}`}>Password</Label>
          <Input id={`password-${request.id}`} name="password" defaultValue={request.suggestedPassword} required className="h-10" autoComplete="new-password" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`project-${request.id}`}>Projects</Label>
          <ProjectChecks
            id={`project-${request.id}`}
            projects={projects}
            defaultSelected={request.suggestedProjectId ? [request.suggestedProjectId] : []}
          />
        </div>
      </div>
      <Notice state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="approve" className="h-10" disabled={pending}>
          {pending ? "Saving…" : "Approve and email"}
        </Button>
        <Button type="submit" name="intent" value="reject" variant="outline" className="h-10" disabled={pending}>
          Reject
        </Button>
      </div>
    </form>
    <DeleteUserButton userId={request.id} loginId={request.email || request.login_id} />
    </div>
  )
}

function DeleteUserButton({ userId, loginId }: { userId: string; loginId: string }) {
  const [state, action, pending] = useActionState(removeAccount, initial)
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${loginId}? This login will stop working.`)) event.preventDefault()
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Notice state={state} />
      <Button type="submit" variant="destructive" className="h-10" disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
    </form>
  )
}

function AddAccount({ projects }: { projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState(addAccount, initial)
  const [role, setRole] = useState<"client" | "admin">("client")
  return (
    <form action={action} autoComplete="off" className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">Add a user</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-login">User ID</Label>
          <Input id="new-login" name="loginId" required className="h-10" autoComplete="off" placeholder="name@email.com" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" name="email" type="email" className="h-10" autoComplete="off" placeholder="Same as user ID if blank" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">Password</Label>
          <Input id="new-password" name="password" required className="h-10" autoComplete="new-password" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-role">Access</Label>
          <select
            id="new-role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "client")}
            className={fieldClass}
          >
            <option value="client">Client view of assigned projects</option>
            <option value="admin">Admin, full access</option>
          </select>
        </div>
        {role === "client" ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="new-project">Projects</Label>
            <ProjectChecks id="new-project" projects={projects} />
          </div>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sendEmail" defaultChecked />
        Email the user ID and password
      </label>
      <Notice state={state} />
      <Button type="submit" className="h-10 w-fit" disabled={pending}>
        {pending ? "Saving…" : "Add user"}
      </Button>
    </form>
  )
}

function AccountCard({ account, projects }: { account: AccountRow; projects: ProjectOption[] }) {
  const [saveState, saveAction, saving] = useActionState(updateAccount, initial)
  const [mailState, mailAction, mailing] = useActionState(resendAccount, initial)
  const [loginId, setLoginId] = useState(account.login_id)
  const [email, setEmail] = useState(account.email ?? "")
  const [role, setRole] = useState<"admin" | "client">(account.role)
  const [projectIds, setProjectIds] = useState(account.project_ids)
  const [password, setPassword] = useState("")
  const locked = account.login_id === "fibre"
  const projectKey = account.project_ids.join(",")
  const assignedNames = projects.filter((project) => account.project_ids.includes(project.id)).map((project) => project.name)

  useEffect(() => {
    setLoginId(account.login_id)
    setEmail(account.email ?? "")
    setRole(account.role)
    setProjectIds(projectKey ? projectKey.split(",") : [])
    setPassword("")
  }, [account.login_id, account.email, account.role, projectKey])

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {account.role === "client" ? (
        <p className="text-sm text-muted-foreground">
          {assignedNames.length > 0 ? assignedNames.join(", ") : "No projects assigned"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Admin, full access</p>
      )}
      <form action={saveAction} autoComplete="off" className="flex flex-col gap-3">
        <input type="hidden" name="userId" value={account.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`account-login-${account.id}`}>User ID</Label>
            <Input
              id={`account-login-${account.id}`}
              name="loginId"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              required
              readOnly={locked}
              className="h-10"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`account-email-${account.id}`}>Email</Label>
            <Input
              id={`account-email-${account.id}`}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`account-role-${account.id}`}>Access</Label>
            <select
              id={`account-role-${account.id}`}
              name="role"
              value={role}
              disabled={locked}
              onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "client")}
              className={fieldClass}
            >
              <option value="client">Client view of assigned projects</option>
              <option value="admin">Admin, full access</option>
            </select>
            {locked ? <input type="hidden" name="role" value="admin" /> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`account-password-${account.id}`}>New password</Label>
            <Input
              id={`account-password-${account.id}`}
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10"
              autoComplete="new-password"
              placeholder="Leave blank to keep"
            />
          </div>
          {role === "client" ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor={`account-project-${account.id}`}>Projects</Label>
              <ProjectChecks
                id={`account-project-${account.id}`}
                projects={projects}
                selected={projectIds}
                onChange={setProjectIds}
              />
            </div>
          ) : null}
        </div>
        <Notice state={saveState} />
        <Button type="submit" variant="outline" className="h-10 w-fit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <form action={mailAction}>
          <input type="hidden" name="userId" value={account.id} />
          <Notice state={mailState} />
          <Button type="submit" variant="outline" className="h-10" disabled={mailing}>
            {mailing ? "Sending…" : "Email saved password"}
          </Button>
        </form>
        {locked ? null : <DeleteUserButton userId={account.id} loginId={account.login_id} />}
      </div>
    </div>
  )
}

export function UsersManager({
  projects,
  requests,
  accounts,
}: {
  projects: ProjectOption[]
  requests: SignupRequest[]
  accounts: AccountRow[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <TestMail />
      <AddAccount projects={projects} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Signup requests</h2>
        {requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No requests waiting.</p>
        ) : (
          requests.map((request) => <RequestCard key={request.id} request={request} projects={projects} />)
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Accounts</h2>
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} projects={projects} />
        ))}
      </section>
    </div>
  )
}
