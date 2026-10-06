export function CategoryBudgetHeading({
  title,
  budget,
  spent,
  compact = false,
  heading = "h3",
}: {
  title: string
  budget: string | null
  spent: string
  compact?: boolean
  heading?: "h2" | "h3"
}) {
  const Title = heading
  return (
    <>
      <Title
        className={`min-w-0 leading-snug break-words ${compact ? "text-sm text-muted-foreground" : "font-medium"}`}
      >
        {title}
      </Title>
      <div
        className={`shrink-0 text-right tabular-nums ${compact ? "text-sm text-muted-foreground" : "text-sm"}`}
      >
        {budget != null ? <p>Budget {budget}</p> : null}
        <p className={compact ? "" : "text-base font-semibold"}>Spent {spent}</p>
      </div>
    </>
  )
}
