"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/db"

export async function updateCategory(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"))
  const name = String(formData.get("name") ?? "").trim()
  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
  const isActive = formData.get("isActive") === "on"
  if (!name) throw new Error("Name is required")
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("categories")
    .update({ name, keywords, is_active: isActive })
    .eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/settings/categories")
}
