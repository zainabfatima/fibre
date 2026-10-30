"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

import type { SheetRow } from "@/components/expense-sheet"
import { amountMatchKind } from "@/lib/amount-search"

type CategoryRef = { id: number }

type ExpenseSearchValue = {
  query: string
  setQuery: (value: string) => void
  descriptionQuery: string
  setDescriptionQuery: (value: string) => void
  matchIds: string[]
  activeIndex: number
  goNext: () => void
  goPrev: () => void
}

const ExpenseSearchContext = createContext<ExpenseSearchValue | null>(null)

export function ExpenseSearchProvider({
  categories,
  rows,
  children,
}: {
  categories: CategoryRef[]
  rows: SheetRow[]
  children: ReactNode
}) {
  const [query, setQueryState] = useState("")
  const [descriptionQuery, setDescriptionQueryState] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)

  const matchIds = useMemo(() => {
    const amountQuery = query.trim()
    const terms = descriptionQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!amountQuery && terms.length === 0) return []
    const ordered: SheetRow[] = []
    for (const category of categories) {
      for (const row of rows) {
        if (row.categoryId === category.id) ordered.push(row)
      }
    }
    for (const row of rows) {
      if (row.categoryId == null) ordered.push(row)
    }
    const exact: string[] = []
    const partial: string[] = []
    const textOnly: string[] = []
    for (const row of ordered) {
      const haystack = (row.description ?? "").toLowerCase()
      if (terms.length > 0 && !terms.every((term) => haystack.includes(term))) continue
      if (!amountQuery) {
        textOnly.push(row.id)
        continue
      }
      const kind = amountMatchKind(amountQuery, row.amount)
      if (kind === "exact") exact.push(row.id)
      else if (kind === "partial") partial.push(row.id)
    }
    return [...exact, ...partial, ...textOnly]
  }, [categories, rows, query, descriptionQuery])

  const index = matchIds.length === 0 ? 0 : Math.min(activeIndex, matchIds.length - 1)

  function setQuery(value: string) {
    setQueryState(value)
    setActiveIndex(0)
  }

  function setDescriptionQuery(value: string) {
    setDescriptionQueryState(value)
    setActiveIndex(0)
  }

  function goNext() {
    if (matchIds.length < 2) return
    setActiveIndex((index + 1) % matchIds.length)
  }

  function goPrev() {
    if (matchIds.length < 2) return
    setActiveIndex((index - 1 + matchIds.length) % matchIds.length)
  }

  const value = useMemo(
    () => ({ query, setQuery, descriptionQuery, setDescriptionQuery, matchIds, activeIndex: index, goNext, goPrev }),
    // setQuery/setDescriptionQuery/goNext/goPrev close over the latest query and matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, descriptionQuery, matchIds, index],
  )

  return <ExpenseSearchContext.Provider value={value}>{children}</ExpenseSearchContext.Provider>
}

export function useExpenseSearch() {
  return useContext(ExpenseSearchContext)
}

export function DescriptionColumnSearch() {
  const search = useExpenseSearch()
  if (!search) return null
  return (
    <input
      value={search.descriptionQuery}
      onChange={(event) => search.setDescriptionQuery(event.target.value)}
      placeholder="Search"
      aria-label="Search description"
      autoComplete="off"
      autoCorrect="off"
      enterKeyHint="search"
      className="h-8 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm font-normal text-foreground"
    />
  )
}

export function ExpenseAmountSearchBar({
  className,
  descriptionOnMobile = false,
}: {
  className?: string
  /** Phone layout has no description column header, so the search sits with the amount search. */
  descriptionOnMobile?: boolean
}) {
  const search = useExpenseSearch()
  if (!search) return null
  const { query, setQuery, descriptionQuery, setDescriptionQuery, matchIds, goNext, goPrev } = search
  const amountTrimmed = query.trim()
  const descriptionTrimmed = descriptionQuery.trim()
  const searching = Boolean(amountTrimmed || descriptionTrimmed)
  const count = searching ? matchIds.length : 0
  const countLabel = count === 1 ? "1 match" : `${count} matches`
  const emptyLabel =
    amountTrimmed && descriptionTrimmed ? "No matches" : descriptionTrimmed ? "No description matches" : "No amount matches"

  return (
    <div className={className ?? "sticky top-[calc(env(safe-area-inset-top)+7.25rem)] z-20 mx-3 mt-3 rounded-xl bg-background/95 p-2 shadow-sm ring-1 ring-foreground/10 backdrop-blur sm:top-[calc(env(safe-area-inset-top)+6rem)] sm:mx-4"}>
      <label className="grid gap-1">
        <span className="sr-only">Search amount</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search amount"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px] tabular-nums"
        />
      </label>
      {descriptionOnMobile ? (
        <label className="mt-2 grid gap-1 md:hidden">
          <span className="sr-only">Search description</span>
          <input
            value={descriptionQuery}
            onChange={(event) => setDescriptionQuery(event.target.value)}
            placeholder="Search description"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="search"
            className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px]"
          />
        </label>
      ) : null}
      {searching && count > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium" role="status">
            {countLabel}
          </p>
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
              >
                Next
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {searching && count === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {emptyLabel}
        </p>
      ) : null}
    </div>
  )
}
