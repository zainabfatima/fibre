import { BrandLogo } from "@/components/brand-logo"
import { ForgotForm } from "@/components/auth/forgot-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Forgot password",
}

export default function ForgotPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-16">
      <Card className="w-full max-w-md border-t-4 border-t-primary">
        <CardHeader className="justify-items-center text-center">
          <BrandLogo size="login" />
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>
            We email the user ID and password for the existing account. The project view stays the one already assigned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotForm />
        </CardContent>
      </Card>
    </main>
  )
}
