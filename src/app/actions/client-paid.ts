"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/db"
import { centsToMoney, parseMoneyInput } from "@/lib/money"

function refresh(projectId: string) {
  revalidatePath("/")
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/client-paid`)
  revalidatePath(`/projects/${projectId}/payments`)
}

export async function addClientPaidExpense(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const paidDate = String(formData.get("paidDate") ?? "")
  const amountText = String(formData.get("amount") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const cents = parseMoneyInput(amountText)
  if (!paidDate) return { error: "Enter the date" }
  if (cents == null || cents <= 0) return { error: "Enter an amount greater than zero" }

  const supabase = await requireAdmin()
  const { error } = await supabase.from("client_paid_expenses").insert({
    project_id: projectId,
    paid_date: paidDate,
    amount: centsToMoney(cents),
    note: note || null,
  })
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}

export async function deleteClientPaidExpense(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const entryId = String(formData.get("entryId") ?? "")
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("client_paid_expenses")
    .delete()
    .eq("id", entryId)
    .eq("project_id", projectId)
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}
