import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import ExcelJS from "exceljs"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getServerEnv } from "@/lib/env"
import { stripJsonFences } from "@/lib/extraction"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, parseMoneyInput } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_CENTS = 999_999_999_999

const matchSchema = z.object({
  matches: z
    .array(
      z.object({
        row: z.coerce.number(),
        category_id: z.coerce.number().optional(),
        code: z.coerce.number().optional(),
      }),
    )
    .optional()
    .default([]),
})

export type UnmatchedBudgetRow = {
  row: number
  name: string
  amount: string
  reason: string
}

export type BudgetImportResult = {
  error: string | null
  matched: number
  unmatched: UnmatchedBudgetRow[]
}

type SheetRow = {
  row: number
  name: string
  cents: number | null
  amountLabel: string
}

type CategoryRef = { id: number; code: number; name: string }

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ""
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ""
    return Number.isInteger(value) ? String(value) : String(value)
  }
  if (typeof value === "string") return value
  if (typeof value === "boolean") return ""
  if (value instanceof Date) return ""
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("")
    }
    if ("result" in value && value.result != null && typeof value.result !== "object") {
      return cellText(value.result as ExcelJS.CellValue)
    }
    if ("text" in value && typeof value.text === "string") return value.text
  }
  return ""
}

function moneyCents(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null
    const cents = parseMoneyInput(value.toFixed(2))
    if (cents == null || cents > MAX_CENTS) return null
    return cents
  }
  if (value && typeof value === "object" && "result" in value && typeof value.result === "number") {
    return moneyCents(value.result)
  }
  const text = cellText(value).trim()
  if (!text) return null
  const cents = parseMoneyInput(text)
  if (cents == null || cents < 0 || cents > MAX_CENTS) return null
  return cents
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[–—−-]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isHeader(name: string, amountText: string, amountValue: ExcelJS.CellValue) {
  const n = normalize(name)
  const a = normalize(amountText)
  const headerWord = /^(category|categories|name|description|code|item|budget|amount|total|value)$/
  const nameIsHeader = headerWord.test(n) || n.includes("category")
  const amountIsHeader = headerWord.test(a) || a.includes("budget") || a.includes("amount")
  return nameIsHeader && moneyCents(amountValue) == null && (amountIsHeader || a === "")
}

function readRow(excelRow: ExcelJS.Row): { name: string; amountValue: ExcelJS.CellValue; amountText: string } | null {
  const first = cellText(excelRow.getCell(1).value).trim()
  const second = cellText(excelRow.getCell(2).value).trim()
  const thirdValue = excelRow.getCell(3).value
  const thirdText = cellText(thirdValue).trim()
  const code = /^\d{1,2}$/.test(first) ? Number(first) : null
  if (code != null && code >= 1 && code <= 58 && second && moneyCents(thirdValue) != null) {
    const name = /^\d/.test(second) ? second : `${code} – ${second}`
    return { name, amountValue: thirdValue, amountText: thirdText }
  }
  if (!first && !second) return null
  return {
    name: first,
    amountValue: excelRow.getCell(2).value,
    amountText: second,
  }
}

async function readSheet(bytes: Buffer): Promise<SheetRow[]> {
  const workbook = new ExcelJS.Workbook()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  await workbook.xlsx.load(arrayBuffer as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("The workbook has no sheets")
  const rows: SheetRow[] = []
  let checkedHeader = false
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    const read = readRow(excelRow)
    if (!read || !read.name) return
    if (!checkedHeader) {
      checkedHeader = true
      if (isHeader(read.name, read.amountText, read.amountValue)) return
    }
    const cents = moneyCents(read.amountValue)
    rows.push({
      row: rowNumber,
      name: read.name,
      cents,
      amountLabel: cents == null ? read.amountText || "—" : formatMoney(centsToMoney(cents)),
    })
  })
  return rows
}

function exactCategoryId(name: string, categories: CategoryRef[]) {
  const key = normalize(name)
  if (!key) return null
  const hits = categories.filter((category) => {
    const labels = new Set([
      normalize(category.name),
      normalize(formatCategory(category.code, category.name)),
      normalize(`${category.code} ${category.name}`),
      normalize(String(category.code)),
    ])
    return labels.has(key)
  })
  return hits.length === 1 ? hits[0].id : null
}

function resolveCategoryId(
  match: { category_id?: number; code?: number },
  categories: CategoryRef[],
) {
  if (match.category_id != null && categories.some((category) => category.id === match.category_id)) {
    return match.category_id
  }
  if (match.code != null) {
    return categories.find((category) => category.code === match.code)?.id ?? null
  }
  return null
}

function parseClaudeMatches(text: string) {
  const raw = stripJsonFences(text)
  try {
    return matchSchema.parse(JSON.parse(raw))
  } catch {
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return matchSchema.parse(JSON.parse(raw.slice(start, end + 1)))
    }
    throw new Error("Claude did not return a budget match list")
  }
}

async function matchWithClaude(rows: SheetRow[], categories: CategoryRef[]) {
  const env = getServerEnv()
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const catalog = categories
    .map((category) => `${category.id} | ${formatCategory(category.code, category.name)}`)
    .join("\n")
  const sheet = rows.map((row) => `${row.row} | ${row.name}`).join("\n")
  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: [
      "You match budget-sheet category names to an existing list.",
      "Reply with JSON only. No markdown.",
      "Do not invent categories. category_id must be one of the ids provided.",
      "Match a row when the name is the same, abbreviated, misspelled, missing its code, or uses a close trade name.",
      "Omit a row when it does not clearly belong to one category.",
      'Shape: {"matches":[{"row":1,"category_id":12}]}',
    ].join(" "),
    messages: [
      {
        role: "user",
        content: `Categories (category_id | code – name):\n${catalog}\n\nSheet rows (row | name):\n${sheet}`,
      },
    ],
  })
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
  const parsed = parseClaudeMatches(text)
  const byRow = new Map<number, number>()
  for (const match of parsed.matches) {
    const id = resolveCategoryId(match, categories)
    if (id != null) byRow.set(match.row, id)
  }
  return byRow
}

async function revalidateBudgets(supabase: ReturnType<typeof createAdminClient>) {
  const { data: projects } = await supabase.from("projects").select("id, share_token")
  for (const project of projects ?? []) {
    revalidatePath(`/projects/${project.id}`)
    revalidatePath(`/projects/${project.id}/settings`)
    if (project.share_token) revalidatePath(`/share/${project.share_token}`)
  }
  revalidatePath("/settings/categories")
}

export async function importBudgetSheet(bytes: Buffer): Promise<BudgetImportResult> {
  const rows = await readSheet(bytes)
  if (rows.length === 0) {
    return {
      error: "The sheet has no budget rows. Use two columns: category name and budget amount.",
      matched: 0,
      unmatched: [],
    }
  }

  const supabase = createAdminClient()
  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id, code, name")
    .order("sort_order")
  if (categoryError || !categories?.length) {
    throw new Error(categoryError?.message || "Categories are missing")
  }

  const valid = rows.filter((row) => row.cents != null)
  const unmatched: UnmatchedBudgetRow[] = rows
    .filter((row) => row.cents == null)
    .map((row) => ({
      row: row.row,
      name: row.name,
      amount: row.amountLabel,
      reason: "Budget amount is missing or not a dollar amount",
    }))

  if (valid.length === 0) {
    return {
      error: "None of the amounts could be read. Nothing was changed.",
      matched: 0,
      unmatched,
    }
  }

  let claudeMatches = new Map<number, number>()
  try {
    claudeMatches = await matchWithClaude(valid, categories)
  } catch (cause) {
    const everyExact = valid.every((row) => exactCategoryId(row.name, categories) != null)
    if (!everyExact) {
      throw new Error(
        cause instanceof Error ? cause.message : "Could not match the sheet",
      )
    }
  }

  const chosen = new Map<number, SheetRow>()
  for (const row of valid) {
    const exact = exactCategoryId(row.name, categories)
    const categoryId = exact ?? claudeMatches.get(row.row) ?? null
    if (categoryId == null) {
      unmatched.push({
        row: row.row,
        name: row.name,
        amount: row.amountLabel,
        reason: "No matching category",
      })
      continue
    }
    const existing = chosen.get(categoryId)
    if (existing) {
      unmatched.push({
        row: existing.row,
        name: existing.name,
        amount: existing.amountLabel,
        reason: "Another row matched this same category",
      })
    }
    chosen.set(categoryId, row)
  }

  if (chosen.size === 0) {
    return {
      error: "No rows matched a category. Nothing was changed.",
      matched: 0,
      unmatched,
    }
  }

  const entries = [...chosen.entries()].map(([categoryId, row]) => ({
    category_id: categoryId,
    amount: centsToMoney(row.cents ?? 0),
  }))
  const { error } = await supabase.rpc("replace_category_default_budgets", { entries })
  if (error) throw new Error(error.message)
  await revalidateBudgets(supabase)

  unmatched.sort((a, b) => a.row - b.row)
  return { error: null, matched: chosen.size, unmatched }
}
