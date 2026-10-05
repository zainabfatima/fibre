import { BrandLogo } from "@/components/brand-logo"
import { LoginForm } from "@/components/auth/login-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Sign in",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-16">
      <Card className="w-full max-w-md border-t-4 border-t-primary">
        <CardHeader className="justify-items-center text-center">
          <BrandLogo size="login" />
          <CardTitle className="text-2xl">Project expenses</CardTitle>
          <CardDescription>
            Enter your login ID to track receipts and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            initialError={
              params.error === "auth"
                ? "That sign-in link is invalid or expired."
                : null
            }
          />
        </CardContent>
      </Card>
    </main>
  )
}
