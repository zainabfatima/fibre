"use client"

import type { ScanFilter } from "@/lib/scanner/types"

const filters: Array<{ id: ScanFilter; label: string }> = [
  { id: "original", label: "Original" },
  { id: "clean", label: "Clean" },
  { id: "bw", label: "B&W" },
  { id: "gray", label: "Grayscale" },
]

export function FilterPicker({
  value,
  previews,
  onChange,
  onApplyAll,
}: {
  value: ScanFilter
  previews: Partial<Record<ScanFilter, string>>
  onChange: (filter: ScanFilter) => void
  onApplyAll?: () => void
}) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onChange(filter.id)}
            className={`overflow-hidden rounded-lg border text-xs ${value === filter.id ? "border-primary" : "border-border"}`}
          >
            {previews[filter.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[filter.id]} alt="" className="h-14 w-full object-cover" />
            ) : (
              <span className="block h-14 bg-muted" />
            )}
            <span className="block px-1 py-1">{filter.label}</span>
          </button>
        ))}
      </div>
      {onApplyAll ? (
        <button type="button" onClick={onApplyAll} className="text-left text-sm underline">
          Apply this filter to all pages
        </button>
      ) : null}
    </div>
  )
}
