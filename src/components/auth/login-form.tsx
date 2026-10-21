"use client"

import { useActionState } from "react"
import Link from "next/link"

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
        <Label htmlFor="login-id">User ID</Label>
        <Input
          id="login-id"
          name="loginId"
          autoComplete="username"
          required
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10"
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
      <div className="flex items-center justify-between gap-3 text-sm">
        <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
          Request access
        </Link>
        <Link href="/forgot" className="text-muted-foreground underline-offset-4 hover:underline">
          Forgot password
        </Link>
      </div>
    </form>
  )
}
