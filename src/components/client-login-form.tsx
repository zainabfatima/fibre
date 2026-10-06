"use client"

import { useActionState } from "react"

import { signInClient, type ClientLoginState } from "@/app/actions/client-auth"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ClientLoginForm({ initialError }: { initialError?: string | null }) {
  const [state, formAction, pending] = useActionState<ClientLoginState, FormData>(
    signInClient,
    { error: initialError ?? null },
  )

  return (
    <Card className="mx-auto w-full max-w-md border-t-4 border-t-primary">
      <CardHeader className="justify-items-center text-center">
        <BrandLogo size="login" />
        <CardTitle className="text-2xl">Project expenses</CardTitle>
        <CardDescription>Enter the project number to view expenses and receipts.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-number">Project number</Label>
            <Input
              id="project-number"
              name="projectNumber"
              inputMode="numeric"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={32}
              required
              className="h-11 text-base"
            />
          </div>
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" className="h-11 w-full" disabled={pending}>
            {pending ? "Please wait…" : "View expenses"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
