"use client"

import { useActionState } from "react"

import { signIn, type LoginState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signIn,
    { error: initialError ?? null },
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-id">Login ID</Label>
        <Input
          id="login-id"
          name="loginId"
          autoComplete="username"
          required
        />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Please wait…" : "Sign in"}
      </Button>
    </form>
  )
}
