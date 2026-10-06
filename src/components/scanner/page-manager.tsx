"use client"

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import type { PageChecks } from "@/lib/scanner/types"

export type ManagedPage = {
  id: string
  previewUrl: string
  checks: PageChecks
}

export function PageManager({
  pages,
  onReorder,
  onDelete,
  onEdit,
}: {
  pages: ManagedPage[]
  onReorder: (pages: ManagedPage[]) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = pages.findIndex((page) => page.id === active.id)
        const newIndex = pages.findIndex((page) => page.id === over.id)
        onReorder(arrayMove(pages, oldIndex, newIndex))
      }}
    >
      <SortableContext items={pages.map((page) => page.id)} strategy={horizontalListSortingStrategy}>
        <ul className="flex gap-2 overflow-x-auto pb-2">
          {pages.map((page, index) => (
            <SortableThumb key={page.id} page={page} number={index + 1} onDelete={onDelete} onEdit={onEdit} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableThumb({
  page,
  number,
  onDelete,
  onEdit,
}: {
  page: ManagedPage
  number: number
  onDelete: (id: string) => void
  onEdit: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: page.id })
  const warnings = [
    page.checks.blurry ? "Blurry" : "",
    page.checks.tooSmall ? "Too small" : "",
    page.checks.glare ? "Glare" : "",
    page.checks.dark ? "Dark" : "",
    page.checks.joins ? "Check joins" : "",
  ].filter(Boolean)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="w-24 shrink-0"
    >
      <button type="button" className="w-full" {...attributes} {...listeners} onClick={() => onEdit(page.id)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={page.previewUrl} alt="" className="h-28 w-full rounded-lg object-cover" />
      </button>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span>{number}</span>
        <button type="button" onClick={() => onDelete(page.id)} className="text-destructive">
          Delete
        </button>
      </div>
      {warnings.length ? <p className="text-[10px] text-red-700">{warnings.join(" · ")}</p> : null}
    </li>
  )
}
