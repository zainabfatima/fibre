import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const pg = require("pg")
const text = readFileSync(".env.local", "utf8")
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!match || process.env[match[1]]) continue
  let value = match[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  process.env[match[1]] = value
}
const connectionString = process.env.DATABASE_URL
  .replace(/([?&])sslmode=[^&]*/gi, "$1")
  .replace(/([?&])ssl=[^&]*/gi, "$1")
  .replace(/\?&/g, "?")
  .replace(/&&/g, "&")
  .replace(/[?&]$/g, "")
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
const counts = await client.query(`
  select file_type, crop_method, needs_manual_crop, count(*)::int as rows, count(distinct receipt_file_path)::int as files
  from public.expenses
  where receipt_file_path is not null and receipt_file_path <> ''
  group by 1, 2, 3
  order by 1, 2, 3
`)
const missing = await client.query(`
  select count(*)::int as rows
  from public.expenses
  where receipt_file_path is not null and receipt_file_path <> ''
    and (crop_method is null or original_file_path is null)
`)
const highlighted = await client.query(`
  select id, receipt_number, vendor, receipt_file_path
  from public.expenses
  where coalesce(receipt_number, '') ~ '5059|4998'
     or coalesce(vendor, '') ~ '5059|4998'
     or coalesce(description, '') ~ '5059|4998'
     or id::text ~ '5059|4998'
`)
const manual = await client.query(`
  select coalesce(nullif(receipt_number, ''), id::text) as label, file_type
  from public.expenses
  where needs_manual_crop = true
  order by file_type, receipt_number nulls last, id
`)
const totals = await client.query(`
  select count(*)::int as expenses,
    count(*) filter (where receipt_file_path is not null and receipt_file_path <> '')::int as with_path,
    count(distinct receipt_file_path) filter (where receipt_file_path is not null and receipt_file_path <> '')::int as distinct_paths
  from public.expenses
`)
const empty = await client.query(`
  select id, receipt_number, file_type, crop_method, original_file_path
  from public.expenses
  where receipt_file_path is null or receipt_file_path = ''
`)
const exact = await client.query(`
  select id, receipt_number, receipt_file_path, crop_method, needs_manual_crop
  from public.expenses
  where receipt_number in ('5059', '4998')
`)
const smoke = await client.query(`
  select id, receipt_number, file_type, crop_method, needs_manual_crop, receipt_file_path, original_file_path
  from public.expenses
  where id in (
    '6f7ef24d-3718-4790-a1b2-b867d39eec18',
    'fdc51380-425f-4a19-91d2-5a8ac1c35a8b'
  )
`)
const images = manual.rows.filter((row) => row.file_type === "image").map((row) => row.label)
const pdfs = manual.rows.filter((row) => row.file_type === "pdf").map((row) => row.label)
console.log(`IMAGES ${images.length}`)
console.log(images.join("\n"))
console.log(`PDFS ${pdfs.length}`)
console.log(pdfs.join("\n"))
await client.end()
