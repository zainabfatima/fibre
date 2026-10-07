/**
 * Re-crop receipts already stored in Supabase.
 *
 * New uploads already perspective-correct and save a grayscale scan.
 * This walks existing expense files, keeps the uncropped original, and
 * replaces the stored receipt with the same scan.
 *
 *   node scripts/reprocess-receipt-crops.mjs --dry-run
 *   node scripts/reprocess-receipt-crops.mjs
 *
 * Safe to rerun: a row with crop_method set is skipped. The original is
 * copied to receipt-originals before the stored file is replaced.
 */

import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const sharp = require("sharp")
const { createCanvas } = require("@napi-rs/canvas")
const { PDFDocument } = require("pdf-lib")
const { createClient } = require("@supabase/supabase-js")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DECODE_LONG_SIDE = 4096
const dryRun = process.argv.includes("--dry-run")
const selfTestOnly = process.argv.includes("--self-test")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity

loadEnv(resolve(root, ".env.local"))

const { cropReceipt } = await import("../src/lib/receiptCrop.ts")

if (selfTestOnly) {
  const result = await selfTest()
  console.log(result.ok ? "Self-test passed." : `Self-test failed: ${result.error}`)
  process.exit(result.ok ? 0 : 1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error("Supabase URL or service role key is missing from .env.local. Nothing was changed.")
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const probe = await selfTest()
if (!probe.ok) {
  console.error(`Local crop pipeline failed before any upload: ${probe.error}`)
  process.exit(1)
}

let migrationNote = "Crop columns were not checked."
try {
  migrationNote = await ensureCropSchema()
} catch (cause) {
  migrationNote = `Could not apply the crop migration (${cause instanceof Error ? cause.message : "database error"}). File updates will continue and column writes will be skipped if the columns are missing.`
}
console.log(migrationNote)

const loaded = await loadExpenses()
if (loaded.unreachable) {
  console.error(loaded.unreachable)
  console.error("Rerun after the database is reachable:")
  console.error("  node scripts/reprocess-receipt-crops.mjs --dry-run")
  console.error("  node scripts/reprocess-receipt-crops.mjs")
  process.exit(1)
}

const groups = groupReceipts(loaded.rows, loaded.cropColumns)
const highlighted = findHighlighted(loaded.rows)
console.log(
  `Dry run: ${groups.images.length} image file${groups.images.length === 1 ? "" : "s"}, ${groups.pdfs.length} PDF file${groups.pdfs.length === 1 ? "" : "s"}, ${groups.other.length} other, ${groups.skipped.length} already cropped.`,
)
console.log(`Receipt 5059: ${highlighted["5059"]}`)
console.log(`Receipt 4998: ${highlighted["4998"]}`)
if (!loaded.cropColumns) {
  console.log("crop_method is not on expenses yet, so nothing can be skipped as already cropped.")
}
if (dryRun) {
  console.log("Dry run only. No files were changed.")
  process.exit(0)
}

const stats = {
  images: groups.images.length,
  pdfs: groups.pdfs.length,
  transformedImages: 0,
  transformedPdfs: 0,
  skipped: groups.skipped.length,
  failed: 0,
  manual: [],
  failures: [],
  originals: "receipt-originals",
}

const queue = [...groups.images, ...groups.pdfs].slice(0, Number.isFinite(limit) ? limit : undefined)
for (const group of queue) {
  const label = group.rows.map((row) => row.receipt_number || row.id.slice(0, 8)).join(", ")
  try {
    const outcome = await processGroup(group, loaded.cropColumns)
    if (group.kind === "pdf") stats.transformedPdfs += 1
    else stats.transformedImages += 1
    if (outcome.needsManualCrop) {
      stats.manual.push(...group.rows.map(describe))
    }
    console.log(
      `${group.kind} ${label}: ${outcome.method}${outcome.needsManualCrop ? " (needs manual crop)" : ""}, original ${outcome.originalPath}`,
    )
  } catch (cause) {
    stats.failed += 1
    const message = cause instanceof Error ? cause.message : "Could not reprocess the receipt"
    stats.failures.push(...group.rows.map((row) => `${describe(row)}: ${message}`))
    console.error(`failed ${label}: ${message}`)
  }
}

console.log("")
console.log(
  `Images ${stats.images}, PDFs ${stats.pdfs}. Transformed ${stats.transformedImages} images and ${stats.transformedPdfs} PDFs. Skipped ${stats.skipped} already cropped. Failed ${stats.failed}.`,
)
console.log(`Originals were kept in the ${stats.originals} bucket (original_file_path) before the stored receipt was replaced.`)
if (stats.manual.length) {
  console.log(`Needs manual crop (${stats.manual.length}):`)
  for (const line of stats.manual) console.log(`  ${line}`)
} else {
  console.log("No receipt was flagged needs_manual_crop.")
}
if (stats.failures.length) {
  console.log("Failed:")
  for (const line of stats.failures) console.log(`  ${line}`)
}

function loadEnv(file) {
  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

async function selfTest() {
  try {
    const width = 640
    const height = 800
    const raw = Buffer.alloc(width * height * 3, 80)
    for (let y = 80; y < 720; y += 1) {
      for (let x = 70; x < 560; x += 1) {
        const index = (y * width + x) * 3
        const ink = y % 28 < 3 && x > 110 && x < 500
        raw[index] = ink ? 20 : 245
        raw[index + 1] = ink ? 20 : 242
        raw[index + 2] = ink ? 20 : 236
      }
    }
    const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
    const raster = await decodeImage(jpeg)
    const cropped = await cropReceipt(raster)
    const scanned = await rasterToJpeg(cropped.image)
    if (scanned.length < 500) throw new Error("Encoded scan was empty")
    if (Math.max(cropped.image.width, cropped.image.height) > 2000) throw new Error("Scan exceeded the long-side limit")
    const pdf = await PDFDocument.create()
    const embedded = await pdf.embedJpg(jpeg)
    const page = pdf.addPage([embedded.width, embedded.height])
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
    const pages = await rasterizePdf(Buffer.from(await pdf.save()))
    if (pages.length !== 1 || pages[0].width < 2) throw new Error("PDF page did not rasterize")
    const pdfCrop = await cropReceipt(pages[0])
    const rebuilt = await pagesToPdf([await rasterToJpeg(pdfCrop.image)])
    if (rebuilt.length < 500) throw new Error("Rebuilt PDF was empty")
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Self-test failed" }
  }
}

async function ensureCropSchema() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return "DATABASE_URL is not set, so the crop migration was not applied from here. Column writes are attempted and skipped if the columns are missing."
  }
  const pg = await loadPg()
  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const columns = await client.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'expenses'`,
    )
    const names = new Set(columns.rows.map((row) => row.column_name))
    const cropColumns = ["original_file_path", "original_file_paths", "crop_corners", "crop_method", "needs_manual_crop"]
    const missing = cropColumns.filter((name) => !names.has(name))
    if (missing.length) {
      await client.query(`alter table public.expenses add column if not exists original_file_path text`)
      await client.query(
        `alter table public.expenses add column if not exists original_file_paths jsonb not null default '[]'::jsonb`,
      )
      await client.query(`alter table public.expenses add column if not exists crop_corners jsonb`)
      await client.query(`alter table public.expenses add column if not exists crop_method text`)
      await client.query(
        `alter table public.expenses add column if not exists needs_manual_crop boolean not null default false`,
      )
      await client.query(`alter table public.expenses drop constraint if exists expenses_crop_method_check`)
      await client.query(
        `alter table public.expenses add constraint expenses_crop_method_check check (crop_method is null or crop_method in ('auto', 'fallback', 'manual', 'none'))`,
      )
    }
    await client.query(
      `update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'receipt-originals'`,
    )
    const view = await client.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'v_expense_rows'`,
    )
    const viewNames = new Set(view.rows.map((row) => row.column_name))
    const tableNow = await client.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'expenses'`,
    )
    const tableNames = new Set(tableNow.rows.map((row) => row.column_name))
    if (cropColumns.some((name) => !viewNames.has(name)) && tableNames.has("return_confirmed")) {
      const latest = readFileSync(resolve(root, "supabase/migrations/20261007194500_return_confirmed.sql"), "utf8")
      const statement = latest.slice(latest.indexOf("create or replace view"))
      await client.query(statement)
    } else if (cropColumns.some((name) => !viewNames.has(name))) {
      const cropMigration = readFileSync(resolve(root, "supabase/migrations/20261007190000_receipt_crop.sql"), "utf8")
      const statement = cropMigration.slice(cropMigration.indexOf("create or replace view"))
      await client.query(statement)
    }
    return missing.length
      ? `Applied missing crop columns (${missing.join(", ")}) and allowed PDF originals in receipt-originals.`
      : "Crop columns are already on expenses. PDF originals are allowed in receipt-originals."
  } finally {
    await client.end()
  }
}

async function loadPg() {
  try {
    return require("pg")
  } catch {
    const { pathToFileURL } = await import("node:url")
    const imported = await import("pg").catch(() => null)
    if (imported?.default) return imported.default
    if (imported?.Client) return imported
    void pathToFileURL
    throw new Error("The pg package is not installed. Install it or set up the Supabase CLI, then rerun this script.")
  }
}

async function loadExpenses() {
  const withCrop =
    "id, project_id, receipt_number, receipt_file_path, receipt_thumbnail_path, file_type, page_count, original_file_path, original_file_paths, crop_method, crop_corners, needs_manual_crop"
  const withoutCrop = "id, project_id, receipt_number, receipt_file_path, receipt_thumbnail_path, file_type, page_count"
  let cropColumns = true
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("expenses")
      .select(cropColumns ? withCrop : withoutCrop)
      .order("created_at", { ascending: true })
      .range(from, from + 999)
    if (error) {
      const missingColumn = /original_file_path|crop_method|crop_corners|needs_manual_crop|schema cache/i.test(error.message)
      if (cropColumns && missingColumn) {
        cropColumns = false
        from = -1000
        rows.length = 0
        continue
      }
      const network = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i.test(error.message)
      return {
        rows: [],
        cropColumns,
        unreachable: network
          ? `Supabase is unreachable (${error.message}). No receipts were changed.`
          : `Could not read expenses (${error.message}). No receipts were changed.`,
      }
    }
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { rows, cropColumns, unreachable: null }
}

function groupReceipts(rows, cropColumns) {
  const byPath = new Map()
  for (const row of rows) {
    if (!row.receipt_file_path) continue
    const list = byPath.get(row.receipt_file_path) ?? []
    list.push(row)
    byPath.set(row.receipt_file_path, list)
  }
  const images = []
  const pdfs = []
  const other = []
  const skipped = []
  for (const [path, groupRows] of byPath) {
    const kind = fileKind(path, groupRows[0]?.file_type)
    const cropped = cropColumns && groupRows.every((row) => row.crop_method)
    const entry = { path, rows: groupRows, kind }
    if (cropped) {
      skipped.push(entry)
      continue
    }
    if (kind === "pdf") pdfs.push(entry)
    else if (kind === "image") images.push(entry)
    else other.push(entry)
  }
  return { images, pdfs, other, skipped }
}

function fileKind(path, fileType) {
  const lower = String(path || "").toLowerCase()
  if (lower.endsWith(".pdf") || fileType === "pdf") return "pdf"
  if (/\.(jpe?g|png|webp)$/.test(lower) || fileType === "image") return "image"
  return "other"
}

function findHighlighted(rows) {
  const wanted = ["5059", "4998"]
  const notes = {}
  for (const number of wanted) {
    const matches = rows.filter(
      (row) => String(row.receipt_number ?? "") === number || String(row.id) === number,
    )
    notes[number] = matches.length
      ? matches.map((row) => `${row.id} path ${row.receipt_file_path || "(none)"} crop ${row.crop_method || "unset"}`).join("; ")
      : "not in expenses"
  }
  return notes
}

function describe(row) {
  return row.receipt_number ? `#${row.receipt_number} (${row.id})` : row.id
}

async function processGroup(group, cropColumns) {
  const downloaded = await supabase.storage.from("receipts").download(group.path)
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Could not download the receipt")
  }
  const current = Buffer.from(await downloaded.data.arrayBuffer())
  const kind = sniffKind(current, group.kind)
  const original = await ensureOriginal(group, current, cropColumns)
  const source = original.bytes
  const scanned = kind === "pdf" ? await scanPdf(source) : await scanImage(source)
  const contentType = kind === "pdf" ? "application/pdf" : "image/jpeg"
  const nextPath = kind === "pdf" ? withExtension(group.path, "pdf") : withExtension(group.path, "jpg")
  const uploaded = await supabase.storage.from("receipts").upload(nextPath, scanned.bytes, {
    contentType,
    upsert: true,
  })
  if (uploaded.error) throw new Error(uploaded.error.message)
  if (nextPath !== group.path) {
    await supabase.storage.from("receipts").remove([group.path])
  }
  const thumb = await thumbnailFromJpeg(scanned.previewJpeg)
  await updateRows(group, {
    cropColumns,
    nextPath,
    fileType: kind === "pdf" ? "pdf" : "image",
    pageCount: scanned.pageCount,
    method: scanned.method,
    needsManualCrop: scanned.needsManualCrop,
    corners: scanned.corners,
    originalPath: original.path,
    originalPaths: original.paths,
    thumb,
  })
  return { method: scanned.method, needsManualCrop: scanned.needsManualCrop, originalPath: original.path }
}

function sniffKind(bytes, fallback) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "%PDF") return "pdf"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image"
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image"
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image"
  }
  return fallback
}

async function ensureOriginal(group, current, cropColumns) {
  const primary = group.rows.find((row) => row.original_file_path) ?? group.rows[0]
  const existingPath = typeof primary.original_file_path === "string" ? primary.original_file_path : ""
  const existingList = Array.isArray(primary.original_file_paths)
    ? primary.original_file_paths.filter((path) => typeof path === "string" && path.length > 0)
    : []
  if (existingPath) {
    const saved = await supabase.storage.from("receipt-originals").download(existingPath)
    if (!saved.error && saved.data) {
      return {
        path: existingPath,
        paths: existingList.length ? existingList : [existingPath],
        bytes: Buffer.from(await saved.data.arrayBuffer()),
      }
    }
  }
  const extension = sniffKind(current, group.kind) === "pdf" ? "pdf" : extensionOf(group.path)
  const originalPath = existingPath || group.path.replace(/\.[^.]+$/, "") + `-original.${extension === "jpeg" ? "jpg" : extension}`
  const contentType = contentTypeFor(extension)
  const uploaded = await supabase.storage.from("receipt-originals").upload(originalPath, current, {
    contentType,
    upsert: false,
  })
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
    throw new Error(`Could not keep the original (${uploaded.error.message})`)
  }
  const paths = existingList.length ? existingList : [originalPath]
  if (cropColumns) {
    for (const row of group.rows) {
      if (row.original_file_path) continue
      const { error } = await supabase
        .from("expenses")
        .update({ original_file_path: originalPath, original_file_paths: paths })
        .eq("id", row.id)
      if (error && !missingColumn(error.message)) throw new Error(error.message)
    }
  }
  return { path: originalPath, paths, bytes: current }
}

async function scanImage(bytes) {
  const raster = await decodeImage(bytes)
  const cropped = await cropReceipt(raster)
  const jpeg = await rasterToJpeg(cropped.image)
  return {
    bytes: jpeg,
    previewJpeg: jpeg,
    pageCount: 1,
    method: cropped.method,
    needsManualCrop: cropped.needsManualCrop,
    corners: [cropped.corners],
  }
}

async function scanPdf(bytes) {
  const pages = await rasterizePdf(bytes)
  if (pages.length === 0) throw new Error("The PDF has no pages")
  const scanned = []
  for (const page of pages) {
    const cropped = await cropReceipt(page)
    scanned.push(cropped)
  }
  const jpegs = []
  for (const page of scanned) jpegs.push(await rasterToJpeg(page.image))
  const methods = scanned.map((page) => page.method)
  return {
    bytes: await pagesToPdf(jpegs),
    previewJpeg: jpegs[0],
    pageCount: scanned.length,
    method: combinedMethod(methods),
    needsManualCrop: methods.some((method) => method === "none"),
    corners: scanned.map((page) => page.corners),
  }
}

function combinedMethod(methods) {
  if (methods.includes("manual")) return "manual"
  if (methods.includes("none")) return "none"
  if (methods.includes("fallback")) return "fallback"
  return "auto"
}

async function updateRows(group, patch) {
  const thumbPaths = [
    ...new Set(group.rows.map((row) => row.receipt_thumbnail_path).filter((path) => typeof path === "string" && path.length > 0)),
  ]
  for (const path of thumbPaths) {
    const thumbUpload = await supabase.storage.from("receipts").upload(path, patch.thumb, {
      contentType: "image/webp",
      upsert: true,
    })
    if (thumbUpload.error) {
      console.error(`thumbnail ${path}: ${thumbUpload.error.message}`)
    }
  }
  if (!patch.cropColumns) return
  for (const row of group.rows) {
    const update = {
      receipt_file_path: patch.nextPath,
      file_type: patch.fileType,
      page_count: patch.pageCount,
      crop_method: patch.method,
      needs_manual_crop: patch.needsManualCrop,
      crop_corners: patch.corners,
      original_file_path: row.original_file_path || patch.originalPath,
      original_file_paths: Array.isArray(row.original_file_paths) && row.original_file_paths.length
        ? row.original_file_paths
        : patch.originalPaths,
    }
    const { error } = await supabase.from("expenses").update(update).eq("id", row.id)
    if (error && missingColumn(error.message)) {
      const { error: fallbackError } = await supabase
        .from("expenses")
        .update({
          receipt_file_path: patch.nextPath,
          file_type: patch.fileType,
          page_count: patch.pageCount,
        })
        .eq("id", row.id)
      if (fallbackError) throw new Error(fallbackError.message)
      continue
    }
    if (error) throw new Error(error.message)
  }
}

async function decodeImage(bytes) {
  const oriented = sharp(bytes, { failOn: "none", unlimited: true }).rotate()
  const meta = await oriented.metadata()
  if (!meta.width || !meta.height) throw new Error("This photo could not be opened")
  const scale = Math.min(1, DECODE_LONG_SIDE / Math.max(meta.width, meta.height))
  const width = Math.max(1, Math.round(meta.width * scale))
  const height = Math.max(1, Math.round(meta.height * scale))
  const pipeline = scale < 1 ? oriented.resize(width, height, { fit: "fill" }) : oriented
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
}

async function rasterToJpeg(raster) {
  return sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .jpeg({ quality: 85 })
    .toBuffer()
}

async function thumbnailFromJpeg(jpeg) {
  return sharp(jpeg).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer()
}

async function rasterizePdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pdf = await pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: factoryUrl(resolve(root, "node_modules/pdfjs-dist/standard_fonts")),
    cMapUrl: factoryUrl(resolve(root, "node_modules/pdfjs-dist/cmaps")),
    cMapPacked: true,
  }).promise
  const pages = []
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, DECODE_LONG_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const context = canvas.getContext("2d")
      await page.render({ canvas, canvasContext: context, viewport, intent: "print" }).promise
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      pages.push({
        width: canvas.width,
        height: canvas.height,
        data: new Uint8ClampedArray(image.data),
      })
      page.cleanup()
    }
  } finally {
    await pdf.destroy()
  }
  return pages
}

async function pagesToPdf(jpegs) {
  const pdf = await PDFDocument.create()
  for (const jpeg of jpegs) {
    const image = await pdf.embedJpg(jpeg)
    const page = pdf.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  return Buffer.from(await pdf.save())
}

function withExtension(path, extension) {
  return path.replace(/\.[^.]+$/, `.${extension}`)
}

function extensionOf(path) {
  const match = String(path).toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : "jpg"
}

function contentTypeFor(extension) {
  if (extension === "pdf") return "application/pdf"
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  return "image/jpeg"
}

function factoryUrl(directory) {
  const href = pathToFileURL(directory).href
  return href.endsWith("/") ? href : `${href}/`
}

function missingColumn(message) {
  return /original_file_path|original_file_paths|crop_method|crop_corners|needs_manual_crop|schema cache/i.test(message)
}
