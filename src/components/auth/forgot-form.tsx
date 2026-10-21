"use client"

import { useActionState } from "react"
import Link from "next/link"

import { submitForgotPassword, type UserFormState } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: UserFormState = { error: null, message: null }

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(submitForgotPassword, initial)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="forgot-email">Email or user ID</Label>
        <Input id="forgot-email" name="email" autoComplete="email" required maxLength={200} className="h-10" />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="text-sm text-emerald-800" role="status">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Sending…" : "Email my login"}
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </form>
  )
}
