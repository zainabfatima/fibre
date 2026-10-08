"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requestIsZainab } from "@/lib/zainab-request"
import { z } from "zod"

import { requireAdmin } from "@/lib/db"
import { centsToMoney, moneyToCents, parseMoneyInput } from "@/lib/money"

export type ActionState = { error: string | null }

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  address: z.string().trim().optional(),
  clientName: z.string().trim().optional(),
  clientEmail: z.string().trim().optional(),
  contractAmount: z.string().trim().optional(),
  status: z.enum(["active", "completed", "on_hold"]),
  invoiceTracking: z.enum(["yes", "no"]),
})

function readProject(formData: FormData) {
  const parsed = projectSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") || undefined,
    clientName: formData.get("clientName") || undefined,
    clientEmail: formData.get("clientEmail") || undefined,
    contractAmount: formData.get("contractAmount") || undefined,
    status: formData.get("status") || "active",
    invoiceTracking: formData.get("invoiceTracking") === "yes" ? "yes" : "no",
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form" }
  }
  let contract: string | null = null
  if (parsed.data.contractAmount) {
    const cents = parseMoneyInput(parsed.data.contractAmount)
    if (cents == null) return { error: "Contract amount is not a valid dollar amount" }
    contract = centsToMoney(cents)
  }
  return {
    row: {
      name: parsed.data.name,
      address: parsed.data.address || null,
      client_name: parsed.data.clientName || null,
      client_email: parsed.data.clientEmail || null,
      contract_amount: contract,
      status: parsed.data.status,
      invoice_tracking: parsed.data.invoiceTracking === "yes",
    },
  }
}

export async function createProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const input = readProject(formData)
  if ("error" in input && input.error) return { error: input.error }
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("projects")
    .insert(input.row!)
    .select("id")
    .single()
  if (error || !data) return { error: error?.message ?? "Could not create the project" }
  revalidatePath("/")
  const prefix = (await requestIsZainab()) ? "/zainab" : ""
  redirect(`${prefix}/projects/${data.id}`)
}

export async function updateProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "")
  const input = readProject(formData)
  if ("error" in input && input.error) return { error: input.error }
  const supabase = await requireAdmin()
  const { error } = await supabase.from("projects").update(input.row!).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/")
  revalidatePath(`/projects/${id}`)
  revalidatePath(`/projects/${id}/settings`)
  return { error: null }
}

export async function saveBudgets(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "")
  const supabase = await requireAdmin()
  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id, default_budget")
  if (categoryError) throw new Error(categoryError.message)
  const defaults = new Map(
    (categories ?? []).map((category) => [
      category.id,
      category.default_budget == null ? 0 : moneyToCents(category.default_budget),
    ]),
  )
  const rows: {
    project_id: string
    category_id: number
    budget_amount: string
    budget_override: boolean
  }[] = []
  const clear: number[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("budget_")) continue
    const categoryId = Number(key.slice("budget_".length))
    if (!Number.isInteger(categoryId)) continue
    const text = String(value).trim()
    const cents = text ? parseMoneyInput(text) : 0
    if (cents == null || cents < 0) throw new Error("A budget amount is not valid")
    const systemDefault = defaults.get(categoryId) ?? 0
    if (cents === systemDefault) {
      clear.push(categoryId)
      continue
    }
    rows.push({
      project_id: projectId,
      category_id: categoryId,
      budget_amount: centsToMoney(cents),
      budget_override: true,
    })
  }
  if (clear.length) {
    const { error } = await supabase
      .from("project_budgets")
      .delete()
      .eq("project_id", projectId)
      .in("category_id", clear)
    if (error) throw new Error(error.message)
  }
  if (rows.length) {
    const { error } = await supabase
      .from("project_budgets")
      .upsert(rows, { onConflict: "project_id,category_id" })
    if (error) throw new Error(error.message)
  }
  const { data: project } = await supabase
    .from("projects")
    .select("share_token")
    .eq("id", projectId)
    .maybeSingle()
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/settings`)
  if (project?.share_token) revalidatePath(`/share/${project.share_token}`)
}

export async function rotateShareToken(projectId: string) {
  const supabase = await requireAdmin()
  const shareToken = crypto.randomUUID().replace(/-/g, "")
  const { error } = await supabase
    .from("projects")
    .update({ share_token: shareToken })
    .eq("id", projectId)
  if (error) throw new Error(error.message)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/settings`)
  return shareToken
}

export async function revokeShareToken(projectId: string) {
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("projects")
    .update({ share_token: null })
    .eq("id", projectId)
  if (error) throw new Error(error.message)
  revalidatePath(`/projects/${projectId}/settings`)
}

const projectIdSchema = z.string().uuid()

type AdminClient = Awaited<ReturnType<typeof requireAdmin>>
type StorageBucket = "receipts" | "receipt-originals" | "invoices"

function stringPaths(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

async function listStoragePaths(supabase: AdminClient, bucket: StorageBucket, folder: string, depth = 0) {
  if (depth > 6) return []
  const paths: string[] = []
  const limit = 1000
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit, offset })
    if (error || !data?.length) break
    for (const item of data) {
      if (!item.name || item.name.startsWith(".")) continue
      const path = folder ? `${folder}/${item.name}` : item.name
      if (item.id == null) paths.push(...(await listStoragePaths(supabase, bucket, path, depth + 1)))
      else paths.push(path)
    }
    if (data.length < limit) break
    offset += data.length
  }
  return paths
}

async function removeStoragePaths(supabase: AdminClient, bucket: StorageBucket, paths: Iterable<string>) {
  const unique = [...new Set(paths)].filter(Boolean)
  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100)
    const { error } = await supabase.storage.from(bucket).remove(batch)
    if (error) throw new Error(error.message)
  }
}

export async function deleteProject(projectId: string): Promise<ActionState> {
  const parsed = projectIdSchema.safeParse(projectId)
  if (!parsed.success) return { error: "Project not found" }
  const supabase = await requireAdmin()
  const { data: project, error: loadError } = await supabase
    .from("projects")
    .select("id, share_token")
    .eq("id", parsed.data)
    .maybeSingle()
  if (loadError) return { error: loadError.message }
  if (!project) return { error: "Project not found" }

  const expenses: {
    receipt_file_path: string
    receipt_thumbnail_path: string | null
    original_file_path: string | null
    original_file_paths: unknown
  }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("expenses")
      .select("receipt_file_path, receipt_thumbnail_path, original_file_path, original_file_paths")
      .eq("project_id", project.id)
      .range(from, from + 999)
    if (error) return { error: error.message }
    expenses.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  const invoicePaths: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("invoices")
      .select("file_path")
      .eq("project_id", project.id)
      .range(from, from + 999)
    if (error) return { error: error.message }
    for (const row of data ?? []) {
      if (row.file_path) invoicePaths.push(row.file_path)
    }
    if (!data || data.length < 1000) break
  }

  const receiptPaths = new Set<string>()
  const originalPaths = new Set<string>()
  for (const expense of expenses) {
    if (expense.receipt_file_path) receiptPaths.add(expense.receipt_file_path)
    if (expense.receipt_thumbnail_path) receiptPaths.add(expense.receipt_thumbnail_path)
    if (expense.original_file_path) originalPaths.add(expense.original_file_path)
    for (const path of stringPaths(expense.original_file_paths)) originalPaths.add(path)
  }

  const [listedReceipts, listedOriginals, listedInvoices] = await Promise.all([
    listStoragePaths(supabase, "receipts", project.id),
    listStoragePaths(supabase, "receipt-originals", project.id),
    listStoragePaths(supabase, "invoices", project.id),
  ])
  for (const path of listedReceipts) receiptPaths.add(path)
  for (const path of listedOriginals) originalPaths.add(path)
  for (const path of listedInvoices) invoicePaths.push(path)

  const { error } = await supabase.from("projects").delete().eq("id", project.id)
  if (error) return { error: error.message }

  try {
    await removeStoragePaths(supabase, "receipts", receiptPaths)
    await removeStoragePaths(supabase, "receipt-originals", originalPaths)
    await removeStoragePaths(supabase, "invoices", invoicePaths)
  } catch (cause) {
    console.error("Project deleted but file cleanup failed", cause)
  }

  revalidatePath("/")
  if (project.share_token) revalidatePath(`/share/${project.share_token}`)
  const prefix = (await requestIsZainab()) ? "/zainab" : ""
  redirect(prefix || "/")
}
