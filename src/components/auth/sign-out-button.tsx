import { signOut } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline" className="h-10 px-3">
        Sign out
      </Button>
    </form>
  )
}
