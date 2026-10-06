import { redirect } from "next/navigation"

import { ClientLoginForm } from "@/components/client-login-form"
import { ClientShell } from "@/components/client-shell"
import { getClientProjectCode } from "@/lib/client-session"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project expenses",
  robots: { index: false, follow: false },
}

export default async function ClientHomePage() {
  const code = await getClientProjectCode()
  if (code) redirect(`/client/${code}`)

  return (
    <ClientShell>
      <ClientLoginForm />
    </ClientShell>
  )
}
