"use client"

import { useActionState } from "react"
import Link from "next/link"

import { submitSignup, type UserFormState } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: UserFormState = { error: null, message: null }

export function SignupForm() {
  const [state, formAction, pending] = useActionState(submitSignup, initial)
  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-emerald-800" role="status">
          {state.message}
        </p>
        <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" name="email" type="email" autoComplete="email" required maxLength={200} className="h-10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-project">Project name</Label>
        <Input id="signup-project" name="projectName" autoComplete="off" required maxLength={200} className="h-10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-address">Address</Label>
        <textarea
          id="signup-address"
          name="address"
          required
          maxLength={300}
          rows={3}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Sending…" : "Request access"}
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Already have a login
      </Link>
    </form>
  )
}
