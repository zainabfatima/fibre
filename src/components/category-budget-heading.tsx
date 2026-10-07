export function CategoryBudgetHeading({
  title,
  budget,
  spent,
  overBy = null,
  compact = false,
  heading = "h3",
}: {
  title: string
  budget: string | null
  spent: string
  overBy?: string | null
  compact?: boolean
  heading?: "h2" | "h3"
}) {
  const Title = heading
  return (
    <>
      <Title
        className={`min-w-0 leading-snug break-words ${compact ? "text-sm text-muted-foreground" : "font-medium"} ${overBy ? "text-red-800" : ""}`}
      >
        {title}
      </Title>
      <div
        className={`shrink-0 text-right tabular-nums ${compact ? "text-sm text-muted-foreground" : "text-sm"}`}
      >
        {budget != null ? <p>Budget {budget}</p> : null}
        <p className={compact ? "" : "text-base font-semibold"}>Spent {spent}</p>
        {overBy ? <p className="font-medium text-red-700">Over budget by {overBy}</p> : null}
      </div>
    </>
  )
}
