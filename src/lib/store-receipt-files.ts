import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { discardReceiptUpload, prepareReceiptUpload } from "@/app/actions/expenses"
import { getPublicEnv } from "@/lib/env"

let browser: SupabaseClient | null = null

function receiptStorage() {
  if (!browser) {
    const env = getPublicEnv()
    browser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return browser.storage.from("receipts")
}

async function uploadSignedReceipt(path: string, token: string, file: Blob, contentType: string) {
  const named = new File([file], path.split("/").pop() || "receipt", { type: contentType })
  const { error } = await receiptStorage().uploadToSignedUrl(path, token, named, { contentType })
  if (error) throw new Error(error.message || "The photo could not be stored")
}

export async function storeReceiptBeforeSave(input: {
  projectId: string
  fileType: "image" | "pdf"
  file: Blob
  originals: Blob[]
  thumb: Blob | null
}) {
  const originals = input.originals.filter((file) => file.size > 0)
  const thumb = input.thumb && input.thumb.size > 0 ? input.thumb : null
  const prepared = await prepareReceiptUpload({
    projectId: input.projectId,
    fileType: input.fileType,
    originalCount: originals.length,
    includeThumb: thumb != null,
  })
  if ("error" in prepared) throw new Error(prepared.error || "The photo could not be stored")

  const tokens = new Map(prepared.uploads.map((item) => [item.path, item.token]))
  const scanToken = tokens.get(prepared.filePath)
  if (!scanToken) throw new Error("The photo could not be stored")
  try {
    await uploadSignedReceipt(
      prepared.filePath,
      scanToken,
      input.file,
      input.fileType === "pdf" ? "application/pdf" : "image/jpeg",
    )
    for (const [index, path] of prepared.originals.entries()) {
      const token = tokens.get(path)
      const blob = originals[index]
      if (!token || !blob) throw new Error("The original photo could not be stored")
      await uploadSignedReceipt(path, token, blob, "image/jpeg")
    }
    if (prepared.thumbPath && thumb) {
      const token = tokens.get(prepared.thumbPath)
      if (!token) throw new Error("The photo could not be stored")
      await uploadSignedReceipt(prepared.thumbPath, token, thumb, thumb.type || "image/webp")
    }
  } catch (cause) {
    await discardReceiptUpload(
      input.projectId,
      prepared.uploads.map((item) => item.path),
    ).catch(() => undefined)
    throw cause instanceof Error ? cause : new Error("The photo could not be stored")
  }
  return prepared
}
