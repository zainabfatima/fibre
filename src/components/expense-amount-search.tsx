"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

import type { SheetRow } from "@/components/expense-sheet"
import { amountMatchKind } from "@/lib/amount-search"

type CategoryRef = { id: number }

type ExpenseSearchValue = {
  query: string
  setQuery: (value: string) => void
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
  const [activeIndex, setActiveIndex] = useState(0)

  const matchIds = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return []
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
    for (const row of ordered) {
      const kind = amountMatchKind(trimmed, row.amount)
      if (kind === "exact") exact.push(row.id)
      else if (kind === "partial") partial.push(row.id)
    }
    return [...exact, ...partial]
  }, [categories, rows, query])

  const index = matchIds.length === 0 ? 0 : Math.min(activeIndex, matchIds.length - 1)

  function setQuery(value: string) {
    setQueryState(value)
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
    () => ({ query, setQuery, matchIds, activeIndex: index, goNext, goPrev }),
    // setQuery/goNext/goPrev close over the latest query and matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, matchIds, index],
  )

  return <ExpenseSearchContext.Provider value={value}>{children}</ExpenseSearchContext.Provider>
}

export function useExpenseSearch() {
  return useContext(ExpenseSearchContext)
}

export function ExpenseAmountSearchBar() {
  const search = useExpenseSearch()
  if (!search) return null
  const { query, setQuery, matchIds, goNext, goPrev } = search
  const trimmed = query.trim()
  const count = trimmed ? matchIds.length : 0
  const countLabel = count === 1 ? "1 match" : `${count} matches`

  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+7.25rem)] z-20 mx-3 mt-3 rounded-xl bg-background/95 p-2 shadow-sm ring-1 ring-foreground/10 backdrop-blur sm:top-[calc(env(safe-area-inset-top)+6rem)] sm:mx-4">
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
      {trimmed && count > 0 ? (
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
      {trimmed && count === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          No amount matches
        </p>
      ) : null}
    </div>
  )
}
