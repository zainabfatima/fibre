import { BrandLogo } from "@/components/brand-logo"
import { SignupForm } from "@/components/auth/signup-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Request access",
}

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-16">
      <Card className="w-full max-w-md border-t-4 border-t-primary">
        <CardHeader className="justify-items-center text-center">
          <BrandLogo size="login" />
          <CardTitle className="text-2xl">Request access</CardTitle>
          <CardDescription>
            Enter your email, project name, and address. After the office matches your project, you receive a user ID and password by email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  )
}
