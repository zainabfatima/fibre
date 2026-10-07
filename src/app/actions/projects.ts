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
