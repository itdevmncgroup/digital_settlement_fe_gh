# Digital Settlement — Web Admin

Next.js 14 (App Router) frontend for the [`digital_settlement_be`](../digital_settlement_be)
API. Covers the Web Admin surface for Admin/Finance/Supervisor/Management: Dashboard
(date-range filter, expense-by-department charts), Transactions (Pre-Event, Expenses,
Approvals), Settlement (batching + approval), Bank-Matching (statement upload + review),
Master Data (Unit, Department, Position, Role, Permission, Credit Card, Agency, Advertiser,
Brand, Activity Type), Import (Excel/CSV/PDF with downloadable templates), Approval Level
config, Users, Audit Log.

## Setup

```bash
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:3000/api/v1
npm run dev                        # http://localhost:3001
```

Runs on port **3001** by default (the backend API owns 3000). Start the backend first, log
in with its seeded admin (`admin@example.com` / `Admin@12345`, or your
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`) — see the backend README for seeding and the full
demo dataset (`Demo@12345` users covering every role and approval position).

Sidebar nav is role-gated client-side (`useAuth().hasRole(...)`/`hasPermission(...)`); the
API enforces the same roles/permissions server-side, so a hidden link is a UX nicety, not
the security boundary.

## Architecture at a glance

- **No UI framework, no Tailwind** — plain global CSS with CSS custom properties, dark
  theme by default, toggle via `src/lib/theme.ts`.
- **No Redux/SWR/react-query** — auth/session lives in a React Context
  (`src/lib/auth.tsx`); everything else is local component state plus a hand-rolled fetch
  client (`src/lib/api.ts`).
- **Most master-data CRUD screens** are thin config wrappers around one generic
  `MasterCrudPage` component (`fields`/`columns` config) rather than bespoke forms per
  entity — see `src/app/(protected)/master/units/page.tsx` for the pattern.
- **Agency → Advertiser → Brand**: three separate Master pages reflecting a strict
  ownership chain — an Agency has many Advertisers, each Advertiser has many Brands, each
  Brand belongs to exactly one Advertiser (set once, at creation).
- **Pre-Event is mandatory**: Sales requests via Pre-Event, gets it approved, only then can
  create an Expense against it. Admin/Finance get a "Sales (manual entry on behalf of)"
  picker on both forms for historical/corrective entry.
- **Approval**: multi-tier, driven by Approval Level config (amount range + department +
  position chain) — see the backend README's "Key flows" for the two-chain (Expense then
  Settlement) approval model this UI drives.
- **Bank-Matching**: upload a bank/credit-card statement PDF, review auto-matched vs
  `REVIEW_REQUIRED` transactions against unmatched Expenses before they're grouped into a
  Settlement.

## Windows path note

Same caveat as the backend: script names in `package.json` invoke
`node node_modules/next/dist/bin/next ...` directly to avoid a Windows `.cmd`-shim path
issue — use `npm run dev` / `npm run build`, not `npx next ...`.

## Related repos

- [`digital_settlement_be`](../digital_settlement_be) — the API this app consumes.
- [`digital_settlement_mobile`](../digital_settlement_mobile) — Flutter app, same backend,
  narrower feature set (Login, New Expense, Approvals, Settlement).
