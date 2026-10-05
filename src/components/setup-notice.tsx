export function SetupNotice() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-medium">Supabase is not configured yet.</p>
      <p className="text-muted-foreground">
        Copy <code className="text-foreground">.env.example</code> to{" "}
        <code className="text-foreground">.env.local</code> and set{" "}
        <code className="text-foreground">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
        Restart the dev server after saving.
      </p>
    </div>
  )
}
