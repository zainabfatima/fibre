"use server"

import { revalidatePath } from "next/cache"

import { syncDuplicateFlag } from "@/lib/extract-receipt"
import { simpleDescription } from "@/lib/simple-description"
import { deriveInvoiceBillingStatus } from "@/lib/labels"
import { requireAdmin } from "@/lib/db"
import { centsToMoney, moneyToCents, parseMoneyInput } from "@/lib/money"
import type { Database } from "@/types/database"

function refresh(projectId: string) {
  revalidatePath("/")
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/review`)
  revalidatePath(`/projects/${projectId}/invoices`)
}

export async function lookupReceiptHash(projectId: string, hash: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("expenses")
    .select("id, created_at")
    .eq("project_id", projectId)
    .eq("receipt_file_hash", hash.toLowerCase())
    .limit(1)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { duplicate: null }
  return {
    duplicate: {
      id: data.id,
      date: data.created_at.slice(0, 10),
    },
  }
}

export async function lookupPageHashes(projectId: string, hashes: string[]) {
  const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()).filter((hash) => /^[0-9a-f]{64}$/.test(hash)))]
  if (unique.length === 0) return { duplicate: null }
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("receipt_page_hashes")
    .select("hash, page_number, expense_id")
    .eq("project_id", projectId)
    .in("hash", unique)
    .limit(1)
  if (error) return { error: error.message }
  const match = data?.[0]
  if (!match) {
    for (const [index, hash] of unique.entries()) {
      const existing = await lookupReceiptHash(projectId, hash)
      if ("error" in existing && existing.error) return { error: existing.error }
      if (existing.duplicate) return { duplicate: { ...existing.duplicate, page: index + 1 } }
    }
    return { duplicate: null }
  }
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, expense_date, created_at")
    .eq("id", match.expense_id)
    .maybeSingle()
  return {
    duplicate: {
      id: expense?.id ?? match.expense_id,
      date: (expense?.expense_date || expense?.created_at || "").slice(0, 10),
      page: match.page_number,
    },
  }
}

export async function saveScannedReceipt(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const hashes = String(formData.get("hashes") ?? "")
    .split(",")
    .map((hash) => hash.toLowerCase())
    .filter((hash) => /^[0-9a-f]{64}$/.test(hash))
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  const captureRaw = String(formData.get("captureType") ?? "single")
  const captureType = captureRaw === "long" || captureRaw === "multi_page" ? captureRaw : "single"
  const pageCount = Math.max(1, Math.min(20, Number(formData.get("pageCount") ?? (hashes.length || 1))))
  const isPdf = file instanceof File && file.type === "application/pdf"
  const isJpeg = file instanceof File && file.type === "image/jpeg"
  if (!(file instanceof File) || (!isPdf && !isJpeg) || !projectId || hashes.length === 0) {
    return { error: "The scanned receipt is missing" }
  }
  const cropMethodRaw = String(formData.get("cropMethod") ?? "")
  const cropMethod = cropMethodRaw === "auto" || cropMethodRaw === "fallback" || cropMethodRaw === "manual" || cropMethodRaw === "none"
    ? cropMethodRaw
    : null
  let cropCorners: Database["public"]["Tables"]["expenses"]["Insert"]["crop_corners"] = null
  const cornersRaw = String(formData.get("cropCorners") ?? "")
  if (cornersRaw) {
    try {
      const parsed = JSON.parse(cornersRaw) as unknown
      if (Array.isArray(parsed)) cropCorners = parsed as Database["public"]["Tables"]["expenses"]["Insert"]["crop_corners"]
    } catch {
      cropCorners = null
    }
  }
  const existing = await lookupPageHashes(projectId, hashes)
  if ("error" in existing && existing.error) return { error: existing.error }
  if (existing.duplicate) {
    return {
      error: `Duplicate — page ${existing.duplicate.page} matches a receipt from ${existing.duplicate.date || "an earlier upload"}`,
      existingId: existing.duplicate.id,
    }
  }

  const supabase = await requireAdmin()
  const categoryRaw = String(formData.get("categoryId") ?? "").trim()
  let categoryId: number | null = null
  if (categoryRaw) {
    const parsed = Number(categoryRaw)
    if (!Number.isInteger(parsed) || parsed <= 0) return { error: "Pick a valid category" }
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("id", parsed)
      .maybeSingle()
    if (categoryError) return { error: categoryError.message }
    if (!category) return { error: "Pick a valid category" }
    categoryId = category.id
  }
  const id = crypto.randomUUID()
  const path = `${projectId}/0/${id}.${isPdf ? "pdf" : "jpg"}`
  const uploaded = await supabase.storage.from("receipts").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  const originalFiles = formData.getAll("original").filter((entry): entry is File => entry instanceof File && entry.size > 0)
  const originalPaths: string[] = []
  for (let index = 0; index < originalFiles.length; index += 1) {
    const original = originalFiles[index]
    const originalPath = `${projectId}/0/${id}${originalFiles.length > 1 ? `-p${index + 1}` : ""}.jpg`
    const originalUpload = await supabase.storage.from("receipt-originals").upload(originalPath, Buffer.from(await original.arrayBuffer()), {
      contentType: "image/jpeg",
      upsert: false,
    })
    if (!originalUpload.error) originalPaths.push(originalPath)
  }

  let thumbPath: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    thumbPath = `${projectId}/thumbs/${id}.webp`
    const thumbUpload = await supabase.storage.from("receipts").upload(thumbPath, Buffer.from(await thumb.arrayBuffer()), {
      contentType: thumb.type || "image/webp",
      upsert: false,
    })
    if (thumbUpload.error) thumbPath = null
  }

  const { error } = await supabase.from("expenses").insert({
    id,
    project_id: projectId,
    amount: "0.00",
    receipt_file_path: path,
    receipt_file_hash: hashes[0],
    receipt_thumbnail_path: thumbPath,
    original_file_path: originalPaths[0] ?? null,
    original_file_paths: originalPaths,
    crop_corners: cropCorners,
    crop_method: cropMethod,
    needs_manual_crop: formData.get("needsManualCrop") === "true" || cropMethod === "none",
    verification_status: "needs_review",
    page_count: pageCount,
    file_type: isPdf ? "pdf" : "image",
    capture_type: captureType,
    ...(categoryId != null ? { category_id: categoryId } : {}),
  })
  if (error) {
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    if (originalPaths.length) await supabase.storage.from("receipt-originals").remove(originalPaths)
    return { error: error.message }
  }
  const { error: hashError } = await supabase.from("receipt_page_hashes").insert(
    hashes.map((hash, index) => ({
      project_id: projectId,
      expense_id: id,
      page_number: index + 1,
      hash,
    })),
  )
  if (hashError) {
    await supabase.from("expenses").delete().eq("id", id)
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    if (originalPaths.length) await supabase.storage.from("receipt-originals").remove(originalPaths)
    return { error: hashError.message }
  }

  refresh(projectId)
  return { id }
}

export async function retakeExpenseReceipt(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const expenseId = String(formData.get("expenseId") ?? "")
  const hashes = String(formData.get("hashes") ?? "")
    .split(",")
    .map((hash) => hash.toLowerCase())
    .filter((hash) => /^[0-9a-f]{64}$/.test(hash))
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  const captureRaw = String(formData.get("captureType") ?? "single")
  const captureType = captureRaw === "long" || captureRaw === "multi_page" ? captureRaw : "single"
  const pageCount = Math.max(1, Math.min(20, Number(formData.get("pageCount") ?? (hashes.length || 1))))
  const isPdf = file instanceof File && file.type === "application/pdf"
  const isJpeg = file instanceof File && file.type === "image/jpeg"
  if (!(file instanceof File) || (!isPdf && !isJpeg) || !projectId || !expenseId || hashes.length === 0) {
    return { error: "The new photo is missing" }
  }
  const cropMethodRaw = String(formData.get("cropMethod") ?? "")
  const cropMethod =
    cropMethodRaw === "auto" || cropMethodRaw === "fallback" || cropMethodRaw === "manual" || cropMethodRaw === "none"
      ? cropMethodRaw
      : null
  let cropCorners: Database["public"]["Tables"]["expenses"]["Update"]["crop_corners"] = null
  const cornersRaw = String(formData.get("cropCorners") ?? "")
  if (cornersRaw) {
    try {
      const parsed = JSON.parse(cornersRaw) as unknown
      if (Array.isArray(parsed)) cropCorners = parsed as Database["public"]["Tables"]["expenses"]["Update"]["crop_corners"]
    } catch {
      cropCorners = null
    }
  }

  const supabase = await requireAdmin()
  const { data: expense, error: loadError } = await supabase
    .from("expenses")
    .select("id, category_id, receipt_file_path, receipt_thumbnail_path, original_file_path, original_file_paths")
    .eq("id", expenseId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (loadError || !expense?.receipt_file_path) return { error: loadError?.message ?? "Receipt not found" }

  const { data: shares } = await supabase
    .from("expenses")
    .select("id")
    .eq("project_id", projectId)
    .eq("receipt_file_path", expense.receipt_file_path)
  const familyIds = [...new Set([expenseId, ...(shares ?? []).map((row) => row.id)])]

  const pageHit = await supabase
    .from("receipt_page_hashes")
    .select("expense_id, page_number")
    .eq("project_id", projectId)
    .in("hash", hashes)
    .limit(20)
  if (pageHit.error) return { error: pageHit.error.message }
  const otherPage = (pageHit.data ?? []).find((row) => !familyIds.includes(row.expense_id))
  if (otherPage) {
    const { data: other } = await supabase
      .from("expenses")
      .select("id, expense_date, created_at")
      .eq("id", otherPage.expense_id)
      .maybeSingle()
    return {
      error: `Duplicate — page ${otherPage.page_number} matches a receipt from ${(other?.expense_date || other?.created_at || "an earlier upload").slice(0, 10)}`,
      existingId: other?.id ?? otherPage.expense_id,
    }
  }
  const fileHit = await supabase
    .from("expenses")
    .select("id, expense_date, created_at")
    .eq("project_id", projectId)
    .in("receipt_file_hash", hashes)
    .limit(20)
  if (fileHit.error) return { error: fileHit.error.message }
  const otherFile = (fileHit.data ?? []).find((row) => !familyIds.includes(row.id))
  if (otherFile) {
    return {
      error: `Duplicate receipt — already uploaded on ${(otherFile.expense_date || otherFile.created_at).slice(0, 10)}`,
      existingId: otherFile.id,
    }
  }

  const path = `${projectId}/0/${crypto.randomUUID()}.${isPdf ? "pdf" : "jpg"}`
  const uploaded = await supabase.storage.from("receipts").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  const originalFiles = formData.getAll("original").filter((entry): entry is File => entry instanceof File && entry.size > 0)
  const originalPaths: string[] = []
  for (const original of originalFiles) {
    const originalPath = `${projectId}/0/${crypto.randomUUID()}.jpg`
    const originalUpload = await supabase.storage.from("receipt-originals").upload(originalPath, Buffer.from(await original.arrayBuffer()), {
      contentType: "image/jpeg",
      upsert: false,
    })
    if (!originalUpload.error) originalPaths.push(originalPath)
  }

  let thumbPath: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    thumbPath = `${projectId}/thumbs/${crypto.randomUUID()}.webp`
    const thumbUpload = await supabase.storage.from("receipts").upload(thumbPath, Buffer.from(await thumb.arrayBuffer()), {
      contentType: thumb.type || "image/webp",
      upsert: false,
    })
    if (thumbUpload.error) thumbPath = null
  }

  async function rollbackUploads() {
    await supabase.storage.from("receipts").remove([path, thumbPath].filter((item): item is string => Boolean(item)))
    if (originalPaths.length) await supabase.storage.from("receipt-originals").remove(originalPaths)
  }

  const patch: Database["public"]["Tables"]["expenses"]["Update"] = {
    receipt_file_path: path,
    receipt_file_hash: hashes[0],
    receipt_thumbnail_path: thumbPath,
    original_file_path: originalPaths[0] ?? null,
    original_file_paths: originalPaths,
    crop_corners: cropCorners,
    crop_method: cropMethod,
    needs_manual_crop: formData.get("needsManualCrop") === "true" || cropMethod === "none",
    page_count: pageCount,
    file_type: isPdf ? "pdf" : "image",
    capture_type: captureType,
    verification_status: "needs_review",
    duplicate_of: null,
  }
  const saved = await supabase.from("expenses").update(patch).eq("project_id", projectId).eq("receipt_file_path", expense.receipt_file_path).select("id")
  if (saved.error || (saved.data?.length ?? 0) === 0) {
    await rollbackUploads()
    return { error: saved.error?.message ?? "Receipt not found" }
  }

  const cleared = await supabase.from("receipt_page_hashes").delete().in("expense_id", familyIds)
  if (!cleared.error) {
    const inserted = await supabase.from("receipt_page_hashes").insert(
      hashes.map((hash, index) => ({
        project_id: projectId,
        expense_id: expenseId,
        page_number: index + 1,
        hash,
      })),
    )
    if (inserted.error) {
      refresh(projectId)
      return { id: expenseId, categoryId: expense.category_id, warning: "Photo saved. Duplicate checking could not be updated." }
    }
  }

  const previousOriginals = [expense.original_file_path, ...asPathList(expense.original_file_paths)].filter(
    (item): item is string => typeof item === "string" && item.length > 0 && !originalPaths.includes(item),
  )
  await supabase.storage.from("receipts").remove(
    [expense.receipt_file_path, expense.receipt_thumbnail_path].filter(
      (item): item is string => Boolean(item) && item !== path && item !== thumbPath,
    ),
  )
  if (previousOriginals.length) await supabase.storage.from("receipt-originals").remove(previousOriginals)

  refresh(projectId)
  return { id: expenseId, categoryId: expense.category_id }
}

function storageType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".pdf")) return "application/pdf"
  return "image/jpeg"
}

function extensionOf(path: string) {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] || "jpg"
}

function asPathList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export async function replaceScannedFile(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const expenseId = String(formData.get("expenseId") ?? "")
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  if (!(file instanceof File) || file.size === 0 || !projectId || !expenseId) {
    return { error: "The replacement scan is missing" }
  }
  const supabase = await requireAdmin()
  const wide = await supabase
    .from("expenses")
    .select("receipt_file_path, receipt_thumbnail_path, original_file_path, original_file_paths")
    .eq("id", expenseId)
    .eq("project_id", projectId)
    .maybeSingle()

  let receiptPath = ""
  let previousThumb: string | null = null
  let hasCropColumns = false
  let hasOriginal = false
  if (!wide.error && wide.data?.receipt_file_path) {
    receiptPath = wide.data.receipt_file_path
    previousThumb = wide.data.receipt_thumbnail_path
    hasCropColumns = true
    hasOriginal = Boolean(wide.data.original_file_path) || asPathList(wide.data.original_file_paths).length > 0
  } else {
    const narrow = await supabase
      .from("expenses")
      .select("receipt_file_path, receipt_thumbnail_path")
      .eq("id", expenseId)
      .eq("project_id", projectId)
      .maybeSingle()
    if (narrow.error || !narrow.data?.receipt_file_path) return { error: narrow.error?.message ?? "Receipt not found" }
    receiptPath = narrow.data.receipt_file_path
    previousThumb = narrow.data.receipt_thumbnail_path
  }

  const extension = file.type === "image/png" ? "png" : file.type === "application/pdf" ? "pdf" : file.type === "image/webp" ? "webp" : "jpg"
  const slash = receiptPath.lastIndexOf("/")
  const folder = slash >= 0 ? receiptPath.slice(0, slash) : projectId
  const nextPath = `${folder}/${crypto.randomUUID()}.${extension}`
  const fileBytes = Buffer.from(await file.arrayBuffer())

  let previousBytes: Buffer | null = null
  if (hasCropColumns && !hasOriginal) {
    const downloaded = await supabase.storage.from("receipts").download(receiptPath)
    if (!downloaded.error && downloaded.data && downloaded.data.size > 0) {
      previousBytes = Buffer.from(await downloaded.data.arrayBuffer())
    }
  }

  const uploaded = await supabase.storage.from("receipts").upload(nextPath, fileBytes, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  let originalPath: string | null = null
  if (previousBytes) {
    const originalExt = extensionOf(receiptPath)
    const candidate = `${projectId}/0/${expenseId}.${originalExt}`
    const first = await supabase.storage.from("receipt-originals").upload(candidate, previousBytes, {
      contentType: storageType(receiptPath),
      upsert: false,
    })
    if (!first.error) {
      originalPath = candidate
    } else {
      const retryPath = `${projectId}/0/${expenseId}-${crypto.randomUUID()}.${originalExt}`
      const retry = await supabase.storage.from("receipt-originals").upload(retryPath, previousBytes, {
        contentType: storageType(receiptPath),
        upsert: false,
      })
      if (!retry.error) originalPath = retryPath
    }
  }

  let nextThumb: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    nextThumb = `${projectId}/thumbs/${crypto.randomUUID()}.webp`
    const thumbUpload = await supabase.storage.from("receipts").upload(nextThumb, Buffer.from(await thumb.arrayBuffer()), {
      contentType: thumb.type || "image/webp",
      upsert: false,
    })
    if (thumbUpload.error) nextThumb = null
  }

  const cropMethodRaw = String(formData.get("cropMethod") ?? "")
  const cropMethod =
    cropMethodRaw === "auto" || cropMethodRaw === "fallback" || cropMethodRaw === "manual" || cropMethodRaw === "none"
      ? cropMethodRaw
      : null
  let cropCorners: Database["public"]["Tables"]["expenses"]["Update"]["crop_corners"] = null
  const cornersRaw = String(formData.get("cropCorners") ?? "")
  if (cornersRaw) {
    try {
      const parsed = JSON.parse(cornersRaw) as unknown
      if (Array.isArray(parsed)) cropCorners = parsed as Database["public"]["Tables"]["expenses"]["Update"]["crop_corners"]
    } catch {
      cropCorners = null
    }
  }
  const pageCountRaw = Number(formData.get("pageCount") ?? "")
  const pageCount = Number.isInteger(pageCountRaw) && pageCountRaw >= 1 && pageCountRaw <= 20 ? pageCountRaw : null

  const filePatch: Database["public"]["Tables"]["expenses"]["Update"] = {
    receipt_file_path: nextPath,
    file_type: extension === "pdf" ? "pdf" : "image",
  }
  if (nextThumb) filePatch.receipt_thumbnail_path = nextThumb
  if (pageCount) filePatch.page_count = pageCount

  const fullPatch: Database["public"]["Tables"]["expenses"]["Update"] = { ...filePatch }
  if (cropMethod) {
    fullPatch.crop_method = cropMethod
    fullPatch.needs_manual_crop = cropMethod === "none"
  }
  if (cropCorners) fullPatch.crop_corners = cropCorners
  if (originalPath) {
    fullPatch.original_file_path = originalPath
    fullPatch.original_file_paths = [originalPath]
  }

  const created = [nextPath, nextThumb].filter((path): path is string => Boolean(path))
  async function rollback() {
    await supabase.storage.from("receipts").remove(created)
    if (originalPath) await supabase.storage.from("receipt-originals").remove([originalPath])
  }

  let recordedOriginal = false
  let savedThumb = false
  const sameFile = () => supabase.from("expenses").update({ receipt_file_path: nextPath }).eq("project_id", projectId).eq("receipt_file_path", receiptPath).select("id")
  const primary = await supabase
    .from("expenses")
    .update(hasCropColumns ? fullPatch : filePatch)
    .eq("project_id", projectId)
    .eq("receipt_file_path", receiptPath)
    .select("id")
  const primaryWrote = !primary.error && (primary.data?.length ?? 0) > 0
  if (primaryWrote) {
    recordedOriginal = Boolean(originalPath)
    savedThumb = Boolean(nextThumb)
  } else if (hasCropColumns && primary.error) {
    const basic = await supabase
      .from("expenses")
      .update(filePatch)
      .eq("project_id", projectId)
      .eq("receipt_file_path", receiptPath)
      .select("id")
    if (!basic.error && (basic.data?.length ?? 0) > 0) {
      savedThumb = Boolean(nextThumb)
    } else if (basic.error) {
      const pathOnly = await sameFile()
      if (pathOnly.error || (pathOnly.data?.length ?? 0) === 0) {
        await rollback()
        return { error: pathOnly.error?.message ?? "Receipt not found" }
      }
      if (nextThumb) await supabase.storage.from("receipts").remove([nextThumb])
      nextThumb = null
    } else {
      await rollback()
      return { error: "Receipt not found" }
    }
    if (originalPath) {
      await supabase.storage.from("receipt-originals").remove([originalPath])
      originalPath = null
    }
  } else if (primary.error) {
    const pathOnly = await sameFile()
    if (pathOnly.error || (pathOnly.data?.length ?? 0) === 0) {
      await rollback()
      return { error: pathOnly.error?.message ?? "Receipt not found" }
    }
    if (nextThumb) await supabase.storage.from("receipts").remove([nextThumb])
    nextThumb = null
  } else {
    await rollback()
    return { error: "Receipt not found" }
  }

  if ((hasOriginal || recordedOriginal) && receiptPath !== nextPath) {
    await supabase.storage.from("receipts").remove([receiptPath])
  }
  if (savedThumb && previousThumb && nextThumb && previousThumb !== nextThumb) {
    await supabase.storage.from("receipts").remove([previousThumb])
  }

  refresh(projectId)
  return { id: expenseId }
}

export async function uploadReceipt(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const hash = String(formData.get("hash") ?? "").toLowerCase()
  const file = formData.get("file")
  const thumb = formData.get("thumb")
  if (!(file instanceof File) || !projectId || !/^[0-9a-f]{64}$/.test(hash)) {
    return { error: "The receipt file is missing or could not be hashed" }
  }

  const existing = await lookupReceiptHash(projectId, hash)
  if ("error" in existing && existing.error) return { error: existing.error }
  if (existing.duplicate) {
    return {
      error: `Duplicate receipt — already uploaded on ${existing.duplicate.date}`,
      existingId: existing.duplicate.id,
    }
  }

  const supabase = await requireAdmin()
  const id = crypto.randomUUID()
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  const path = `${projectId}/${id}.${isPdf ? "pdf" : "jpg"}`
  const fileBytes = Buffer.from(await file.arrayBuffer())
  const uploaded = await supabase.storage.from("receipts").upload(path, fileBytes, {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
    upsert: false,
  })
  if (uploaded.error) return { error: uploaded.error.message }

  let thumbPath: string | null = null
  if (thumb instanceof File && thumb.size > 0) {
    thumbPath = `${projectId}/thumbs/${id}.jpg`
    const thumbBytes = Buffer.from(await thumb.arrayBuffer())
    const thumbUpload = await supabase.storage
      .from("receipts")
      .upload(thumbPath, thumbBytes, { contentType: "image/jpeg", upsert: false })
    if (thumbUpload.error) thumbPath = null
  }

  const { error } = await supabase.from("expenses").insert({
    id,
    project_id: projectId,
    amount: "0.00",
    receipt_file_path: path,
    receipt_file_hash: hash,
    receipt_thumbnail_path: thumbPath,
    verification_status: "needs_review",
  })
  if (error) {
    await supabase.storage.from("receipts").remove([path, thumbPath].filter(Boolean) as string[])
    return { error: error.message }
  }
  refresh(projectId)
  return { id }
}

export async function updateExpenseFields(input: {
  projectId: string
  expenseId: string
  categoryId?: number | null
  amount?: string
  vendor?: string
  expenseDate?: string
  description?: string
  receiptNumber?: string
  paymentMethod?: string
  verify?: boolean
}) {
  const supabase = await requireAdmin()
  const patch: Database["public"]["Tables"]["expenses"]["Update"] = {}
  if ("categoryId" in input) patch.category_id = input.categoryId ?? null
  if (input.amount != null) {
    const cents = parseMoneyInput(input.amount)
    if (cents == null) return { error: "Amount is not valid" }
    patch.amount = centsToMoney(cents)
    if (cents >= 0) patch.return_confirmed = false
  }
  if ("vendor" in input) patch.vendor = input.vendor?.trim() || null
  if ("expenseDate" in input) patch.expense_date = input.expenseDate || null
  if ("description" in input) patch.description = simpleDescription(input.description) || null
  if ("receiptNumber" in input) patch.receipt_number = input.receiptNumber?.trim() || null
  if ("paymentMethod" in input) patch.payment_method = input.paymentMethod?.trim() || null
  if (input.verify) {
    const { data: existing, error: existingError } = await supabase
      .from("expenses")
      .select("amount, return_confirmed")
      .eq("id", input.expenseId)
      .maybeSingle()
    if (existingError || !existing) return { error: existingError?.message ?? "Expense not found" }
    const cents = input.amount != null ? parseMoneyInput(input.amount) : moneyToCents(existing.amount)
    if (cents != null && cents < 0 && !existing.return_confirmed) {
      return { error: "Confirm this return before verifying" }
    }
    patch.verification_status = "verified"
  }

  const { error } = await supabase.from("expenses").update(patch).eq("id", input.expenseId)
  if (error) return { error: error.message }
  if (input.amount != null) await syncDuplicateFlag(input.projectId, input.expenseId)
  refresh(input.projectId)
  return { error: null }
}

export async function confirmReturn(projectId: string, expenseId: string, amount?: string) {
  const supabase = await requireAdmin()
  const patch: Database["public"]["Tables"]["expenses"]["Update"] = { return_confirmed: true }
  if (amount != null) {
    const cents = parseMoneyInput(amount)
    if (cents == null || cents >= 0) return { error: "A return amount must stay negative" }
    patch.amount = centsToMoney(cents)
  } else {
    const { data, error: loadError } = await supabase
      .from("expenses")
      .select("amount")
      .eq("id", expenseId)
      .maybeSingle()
    if (loadError || !data) return { error: loadError?.message ?? "Expense not found" }
    if (moneyToCents(data.amount) >= 0) return { error: "This amount is not negative" }
  }
  const { error } = await supabase.from("expenses").update(patch).eq("id", expenseId)
  if (error) return { error: error.message }
  if (amount != null) await syncDuplicateFlag(projectId, expenseId)
  refresh(projectId)
  return { error: null }
}

export async function clearDuplicate(projectId: string, expenseId: string) {
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("expenses")
    .update({ duplicate_of: null, duplicate_confirmed: true })
    .eq("id", expenseId)
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}

export async function deleteExpense(projectId: string, expenseId: string) {
  const supabase = await requireAdmin()
  const { data: expense } = await supabase
    .from("expenses")
    .select("receipt_file_path, receipt_thumbnail_path, original_file_path, original_file_paths, split_group_id, receipt_file_hash")
    .eq("id", expenseId)
    .maybeSingle()
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId)
  if (error) return { error: error.message }
  if (expense && !expense.split_group_id) {
    await supabase.storage
      .from("receipts")
      .remove(
        [expense.receipt_file_path, expense.receipt_thumbnail_path].filter(
          Boolean,
        ) as string[],
      )
    const originals = [
      expense.original_file_path,
      ...(Array.isArray(expense.original_file_paths) ? expense.original_file_paths : []),
    ].filter((path): path is string => typeof path === "string" && path.length > 0)
    if (originals.length) await supabase.storage.from("receipt-originals").remove(originals)
  }
  refresh(projectId)
  return { error: null }
}

export async function saveSplit(input: {
  projectId: string
  expenseId: string
  total: string
  rows: Array<{ categoryId: number | null; amount: string; description: string }>
}) {
  const totalCents = parseMoneyInput(input.total)
  if (totalCents == null) return { error: "Receipt total is not valid" }
  const parts = input.rows.map((row) => {
    const cents = parseMoneyInput(row.amount)
    return { ...row, cents }
  })
  if (parts.some((row) => row.cents == null)) return { error: "Each split amount must be valid" }
  const sum = parts.reduce((total, row) => total + (row.cents ?? 0), 0)
  if (sum !== totalCents) {
    return {
      error: `Splits add up to ${centsToMoney(sum)}, but the receipt total is ${centsToMoney(totalCents)}`,
    }
  }
  if (parts.length < 2) return { error: "A split needs at least two lines" }

  const supabase = await requireAdmin()
  const { data: original, error: loadError } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (loadError || !original) return { error: loadError?.message ?? "Receipt not found" }

  const groupId = original.split_group_id ?? crypto.randomUUID()
  const first = parts[0]
  const { error: updateError } = await supabase
    .from("expenses")
    .update({
      split_group_id: groupId,
      category_id: first.categoryId,
      amount: centsToMoney(first.cents!),
      description: simpleDescription(first.description) || null,
      verification_status: "needs_review",
    })
    .eq("id", original.id)
  if (updateError) return { error: updateError.message }

  if (original.split_group_id) {
    await supabase
      .from("expenses")
      .delete()
      .eq("split_group_id", original.split_group_id)
      .neq("id", original.id)
  }

  const inserts = parts.slice(1).map((row) => ({
    project_id: original.project_id,
    category_id: row.categoryId,
    vendor: original.vendor,
    expense_date: original.expense_date,
    amount: centsToMoney(row.cents!),
    receipt_number: original.receipt_number,
    description: simpleDescription(row.description) || null,
    payment_method: original.payment_method,
    receipt_file_path: original.receipt_file_path,
    receipt_file_hash: original.receipt_file_hash,
    receipt_thumbnail_path: original.receipt_thumbnail_path,
    original_file_path: original.original_file_path,
    original_file_paths: original.original_file_paths,
    crop_corners: original.crop_corners,
    crop_method: original.crop_method,
    needs_manual_crop: original.needs_manual_crop,
    split_group_id: groupId,
    ai_extracted: original.ai_extracted,
    ai_suggested_category_ids: original.ai_suggested_category_ids,
    ai_confidence: original.ai_confidence,
    verification_status: "needs_review" as const,
  }))
  const { error: insertError } = await supabase.from("expenses").insert(inserts)
  if (insertError) return { error: insertError.message }
  refresh(input.projectId)
  return { error: null }
}

export async function assignInvoiceNumber(input: {
  projectId: string
  expenseId: string
  invoiceNumber: string
}) {
  const number = input.invoiceNumber.trim()
  const supabase = await requireAdmin()
  const { data: expense } = await supabase
    .from("expenses")
    .select("id")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (!expense) return { error: "Expense not found" }

  if (!number) {
    const { error } = await supabase
      .from("expenses")
      .update({ invoice_id: null })
      .eq("id", input.expenseId)
    if (error) return { error: error.message }
    refresh(input.projectId)
    return { error: null }
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("invoice_number", number)
    .maybeSingle()

  let invoiceId = invoice?.id
  if (!invoiceId) {
    const { data: created, error } = await supabase
      .from("invoices")
      .insert({
        project_id: input.projectId,
        invoice_number: number,
        invoice_date: new Date().toISOString().slice(0, 10),
        total_amount: "0.00",
      })
      .select("id")
      .single()
    if (error || !created) return { error: error?.message ?? "Could not save the invoice number" }
    invoiceId = created.id
  }

  const { error } = await supabase
    .from("expenses")
    .update({ invoice_id: invoiceId })
    .eq("id", input.expenseId)
  if (error) return { error: error.message }
  await syncInvoiceTotal(invoiceId)
  refresh(input.projectId)
  return { error: null, invoiceId }
}

export async function setExpenseBillingStatus(input: {
  projectId: string
  expenseId: string
  status: "unpaid" | "paid" | "partial"
}) {
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("expenses")
    .update({ billing_status: input.status })
    .eq("id", input.expenseId)
    .eq("project_id", input.projectId)
  if (error) return { error: error.message }
  const { data: expense } = await supabase
    .from("expenses")
    .select("invoice_id")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (expense?.invoice_id) {
    const { data: linked } = await supabase
      .from("expenses")
      .select("billing_status")
      .eq("invoice_id", expense.invoice_id)
    const rollup = deriveInvoiceBillingStatus((linked ?? []).map((row) => row.billing_status))
    const status = rollup === "paid" ? "paid" : rollup === "partial" ? "partially_paid" : "pending"
    const { data: invoice } = await supabase.from("invoices").select("status").eq("id", expense.invoice_id).maybeSingle()
    if (invoice && invoice.status !== "void") {
      await supabase.from("invoices").update({ status }).eq("id", expense.invoice_id)
    }
  }
  refresh(input.projectId)
  return { error: null }
}

export async function linkExpensesToInvoice(input: {
  projectId: string
  expenseIds: string[]
  invoiceNumber: string
}) {
  const blocked: string[] = []
  for (const expenseId of input.expenseIds) {
    const result = await assignInvoiceNumber({
      projectId: input.projectId,
      expenseId,
      invoiceNumber: input.invoiceNumber,
    })
    if (result.error) blocked.push(result.error)
  }
  if (blocked.length) return { error: blocked[0] }
  return { error: null }
}

export async function syncInvoiceTotal(invoiceId: string) {
  const supabase = await requireAdmin()
  const { data: invoice } = await supabase
    .from("invoices")
    .select("subtotal")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!invoice) return
  await supabase
    .from("invoices")
    .update({
      total_amount: centsToMoney(moneyToCents(invoice.subtotal)),
      builder_fee: "0.00",
      retainage: "0.00",
    })
    .eq("id", invoiceId)
}
