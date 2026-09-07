# SCE Expense — Web Admin

Next.js 14 (App Router) frontend for the [Backend API Core](../README.md). Covers BRD section 26's
Web Admin menu for Admin/Finance/Supervisor/Management: Dashboard (with date-range filter and
Expense-by-POD/Unit/Advertiser), Transaction (Pre-Event + Expenses + Approval), Master data
(Unit/**Agency**/**Advertiser**/Brand/Activity Type/**POD**), Import (Excel/CSV/PDF, with a
downloadable empty template per entity), Approval Rule config, Users, Audit Log.

**Agency → Advertiser → Brand**: three separate Master pages now, reflecting a strict ownership
chain — an Agency (Master → Agency) has many Advertisers (Master → Advertiser, picks its Agency);
each Advertiser has many Brands (Master → Brand, picks its Advertiser); each Brand belongs to
exactly one Advertiser. There's no more Client↔Brand many-to-many linking screen — ownership is
set once, when the Brand is created.

**POD** (Master → POD, Admin-only): a named coverage group for one or more Sales — pick one or more
Sales (one `Pod` row is created per Sales, all sharing the name/coverage), then build coverage with
a cascading picker: pick an **Agency**, check off one or more of its **Advertisers**, then check
off one or more of their **Brands** (fetched narrowed to those Advertisers, since Brand can run
into the thousands) and "+ Add Brands to POD". Repeat with a different Agency to keep adding — one
Agency can cover many Brands in the same POD; only a duplicate Brand is rejected. The "Manage
Coverage Pairs" section below the list handles the same Agency→Advertiser→Brand narrowing for
adding/removing pairs on one already-created POD row.

Backend seed data (see backend README) includes a full demo dataset — log in as any of the seeded
demo users (`Demo@12345`) to see every screen populated instead of empty tables. Units follow the
MNC Group structure: `HOLDING`, `RCTI`, `MNCTV`, `GTV`. The bulk POD dataset seeds 1000+ Brands, so
Brand/Advertiser/Agency/POD/Expense/Pre-Event pages all have a **search box** (debounced, hits the
backend's `?search=` filter) — the Brand page also caps its table at 200 rows, same as the API.

**Pre-Event is mandatory**: Sales requests via **Pre-Event**, Supervisor ("Head POD") approves it,
only then does **+ New Expense** on the Expenses page let Sales pick that approved request and
spend against it — see the backend README's "Key flows" section. Admin/Finance additionally get a
**Sales (manual entry on behalf of)** picker on both the Pre-Event and Expense forms, for
historical/corrective entry directly on behalf of any Sales. The Expense form also has an optional
**Line Items** section (description + amount + category per line) beyond the single header amount,
and an **Import** button linking to the Import page pre-scoped to `Expense` (bulk entry via
Excel/CSV/PDF referencing an existing `APPROVED` Pre-Event's event number — see backend README).

**Action (Edit) column**: every list table — the six Master pages (Unit, Agency, Advertiser, Brand,
Activity Type, POD), Pre-Event, Expenses, System → User, System → Approval Rule — has an Action
column with an Edit button that prefills the form (or, for POD, an inline row) from that record and
switches Save to `PATCH` instead of `POST`. A few endpoints don't support editing every field, so
the edit form narrows accordingly: POD edits name/status only (coverage pairs are managed
separately below the list); Approval Rule locks `unitId` once created; User locks `employeeId`/
`email` and edits roles via a second `PATCH .../roles` call, plus only shows `status` when editing;
Event only lets non-advertiser/brand/activityType fields change. Pre-Event and Expenses restrict
Edit to `DRAFT`/`REJECTED`/`REVISION` status and to the owning Sales or an Admin/Finance user acting
on their behalf (same on-behalf rule as creation).

## Setup

```bash
cd web-admin
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:3000/api/v1
npm run dev                        # http://localhost:3001
```

Runs on port **3001** by default (the backend API already owns 3000). Log in with the seeded admin
(`admin@example.com` / `Admin@12345`, or whatever `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` you set)
— see the backend README for seeding.

Sidebar nav is role-gated client-side (`useAuth().hasRole(...)`); the API enforces the same roles
server-side, so a hidden link is a UX nicety, not the security boundary.

## Not built yet

- Invoice scanning/OCR review screens — depends on the OCR/LLM worker phase, out of scope here.
- Sales Assignment (Sales↔Unit history) management UI — backend CRUD exists (Admin-only), no page yet.

## Windows path note

Same caveat as the backend: this repo's folder name has an `&`, which breaks Windows `.cmd` shims.
`package.json` scripts here already call `node node_modules/next/dist/bin/next ...` directly to
avoid it — use `npm run dev` / `npm run build`, not `npx next ...`.
