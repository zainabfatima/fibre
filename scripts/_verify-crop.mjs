import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const require = createRequire(import.meta.url)
const sharp = require("sharp")
const { createClient } = require("@supabase/supabase-js")

const text = readFileSync(".env.local", "utf8")
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!match || process.env[match[1]]) continue
  let value = match[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  process.env[match[1]] = value
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const ids = ["45673cd5-359d-4ef7-b30b-12c3aa51e7f6"]

for (const id of ids) {
  const { data, error } = await supabase
    .from("expenses")
    .select("id, receipt_number, receipt_file_path, original_file_path, crop_method, needs_manual_crop, file_type")
    .eq("id", id)
    .single()
  if (error) throw new Error(error.message)
  const current = await supabase.storage.from("receipts").download(data.receipt_file_path)
  const original = await supabase.storage.from("receipt-originals").download(data.original_file_path)
  if (current.error || !current.data) throw new Error(current.error?.message || "missing scan")
  if (original.error || !original.data) throw new Error(original.error?.message || "missing original")
  const scan = Buffer.from(await current.data.arrayBuffer())
  const source = Buffer.from(await original.data.arrayBuffer())
  const scanHash = createHash("sha256").update(scan).digest("hex").slice(0, 12)
  const sourceHash = createHash("sha256").update(source).digest("hex").slice(0, 12)
  let detail = `${data.file_type} ${scan.length} bytes`
  if (data.file_type !== "pdf") {
    const meta = await sharp(scan).metadata()
    const { data: raw, info } = await sharp(scan).raw().toBuffer({ resolveWithObject: true })
    let gray = 0
    let samples = 0
    const channels = info.channels
    for (let i = 0; i < raw.length; i += channels * 40) {
      const red = raw[i]
      const green = raw[i + 1]
      const blue = raw[i + 2]
      if (red === green && green === blue) gray += 1
      samples += 1
    }
    detail = `${meta.width}x${meta.height} gray ${gray}/${samples} jpeg`
  } else {
    detail = `pdf ${scan.length} bytes starts ${scan.subarray(0, 4).toString("ascii")}`
  }
  console.log(
    `${data.receipt_number} method=${data.crop_method} manual=${data.needs_manual_crop} scan=${scanHash} original=${sourceHash} same=${scanHash === sourceHash} ${detail}`,
  )
}
