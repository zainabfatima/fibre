# Fibre

Construction project expenses, receipts, and invoices. Upload receipts, extract them with Claude, review and categorize them, invoice the client once, and export an Excel workbook whose receipt links stay valid.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Supabase Postgres, Storage, and Realtime
- Anthropic Claude (server only) for receipt and invoice reading
- ExcelJS, pdf-lib, Recharts, TanStack Table

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/dashboard) project
- The Supabase CLI (`npx supabase`, already used by the scripts below)

## 1. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`. Do not commit that file.

| Variable | Where it is used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server. This is the publishable key or the legacy anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Bypasses row level security. |
| `ANTHROPIC_API_KEY` | Server only. Never prefix with `NEXT_PUBLIC_`. |
| `ANTHROPIC_MODEL` | Server only. Default `claude-sonnet-5-5`. |
| `NEXT_PUBLIC_APP_URL` | Public app URL. Local default `http://localhost:3000`. |

In the Supabase dashboard, open **Project Settings → API Keys** (there is no separate Settings → API page).

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Publishable key (`sb_publishable_…`) or the legacy anon JWT → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Secret key (`sb_secret_…`) or the legacy service_role JWT → `SUPABASE_SERVICE_ROLE_KEY`

The secret key and `ANTHROPIC_API_KEY` must never be exposed to the browser.

`NEXT_PUBLIC_*` values are inlined at build time. Set them before `npm run build` or a Vercel deploy.

## 2. Apply the schema

Migrations live in `supabase/migrations`. `20261004180000_init.sql` creates:

- Tables: `projects`, `categories`, `project_budgets`, `invoices`, `expenses`, `expense_audit`
- Views: `v_expense_rows`, `v_project_category_totals`, `v_project_summary`
- Row level security for authenticated users (`public.has_company_access()`)
- The 59 categories (Architectural through Miscellaneous), including Retaining wall immediately before Foundation. A later migration replaces the original 55-name list.
- Private Storage buckets `receipts` and `invoices` (20 MB; JPEG, PNG, WebP, PDF) and their policies

You do not create the buckets by hand. The migration inserts them.

From the project root, after [linking](#manual-setup) the CLI to your hosted project:

```bash
npx supabase db push
```

Confirm in the dashboard:

- **Table Editor** shows `categories` with 59 rows
- **Storage** shows private buckets `receipts` and `invoices`

## 3. Sign in

Open `/login` and enter the login id `fibre`. There is no email account. The app sets an httpOnly cookie and reads and writes data with the service-role key on the server. Row level security stays on so a browser client without that key cannot query the tables.

## 4. Run the app

```bash
npm install
npm run seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with `fibre`. The home page lists projects, including the demo job **3185 N Hembree Rd** after `npm run seed`. That script is safe to run again: it does nothing if the demo project already exists.

`npm run seed` uploads about 20 sample receipt PDFs and two invoices. It needs the service-role key in `.env.local`.

## Local Supabase (optional)

Docker is required.

```bash
npx supabase start
npx supabase db reset
npx supabase status
```

Copy the local API URL, anon (or publishable) key, and service_role (or secret) key into `.env.local`. `db reset` replays migrations and `supabase/seed.sql`. Categories are inserted by the migration; the seed file does not duplicate them.

## Manual setup

1. Create a Supabase project at https://supabase.com/dashboard
2. Copy URL + publishable/anon + secret/service_role into .env.local (copy from .env.example)
3. `npx supabase login`, then `npx supabase link --project-ref YOUR_REF`, then `npx supabase db push`
4. Anthropic key from https://console.anthropic.com/settings/keys into `ANTHROPIC_API_KEY`
5. Create a GitHub repo, push, import on Vercel, set all env vars (including production `NEXT_PUBLIC_APP_URL`), deploy

`YOUR_REF` is the project reference in the dashboard URL (`https://supabase.com/dashboard/project/YOUR_REF`) and in the project URL host (`https://YOUR_REF.supabase.co`). `supabase link` asks for the database password you set when the project was created.

### Vercel

1. Create a GitHub repository and push this project.
2. In Vercel, **Add New → Project** and import that repository. Framework preset: Next.js.
3. Add every variable from `.env.example` before the first deploy. Set `NEXT_PUBLIC_APP_URL` to the production URL, such as `https://your-app.vercel.app`.
4. Deploy. Sign in at `/login` with the id `fibre`.

## What the app does

- Projects, per-category budgets, and a company dashboard with live updates
- Bulk receipt upload (JPEG, PNG, HEIC, PDF) with hashing, compression, and duplicate blocking
- Claude extraction, a review screen with category chips and receipt splits, and a virtualized expense sheet
- Invoices linked to each expense exactly once, with a mismatch warning when the printed total does not match
- Excel export (`.xlsx`) with permanent `/r/{id}` and `/i/{id}` links, plus printable category PDFs
- A read-only client page at `/share/{token}`

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run seed` | Insert the demo project if it is not already there |
