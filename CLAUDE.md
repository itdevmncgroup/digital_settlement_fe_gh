# CLAUDE.md — digital_settlement_fe

Guide for Claude Code working in this repo. Next.js Web Admin for **Digital Settlement**,
consuming the `digital_settlement_be` API (sibling repo).

## Stack

Next.js 14.2.35 App Router, React 18.3.1, TypeScript 5.5 strict. **No UI/CSS framework** —
plain global CSS with custom properties (`src/app/globals.css`), dark-first theme with
`[data-theme="light"]` override (`src/lib/theme.ts` + inline `THEME_INIT_SCRIPT` in
`layout.tsx` to avoid flash-of-wrong-theme). **No state library** — React Context only
(`src/lib/auth.tsx`), local component state otherwise. **No data-fetching library** — hand-
rolled fetch wrapper `src/lib/api.ts`. **No form library** — manual controlled inputs, most
CRUD screens driven by a generic config component instead of bespoke forms.

Don't reach for Redux/Zustand/SWR/react-query/react-hook-form/Tailwind — none are
installed, and the existing pattern (Context + hand-rolled fetch + config-driven CRUD) is
deliberate, not an oversight.

## Commands

```
npm run dev     # next dev -p 3001
npm run build   # next build
npm run start   # next start -p 3001
npm run lint    # next lint
```

Scripts invoke `node node_modules/next/dist/bin/next ...` directly rather than the `next`
shim, for the same Windows path-shim-breakage reason as the backend — follow this pattern
for any new script, don't switch to `npx`.

Runs on port **3001** (backend owns 3000). Requires the backend running first.

## Auth

JWT access+refresh tokens in `localStorage`. `AuthProvider`/`useAuth()`
(`src/lib/auth.tsx`) exposes `login`, `logout`, `hasRole(...)`, `hasPermission(...)`.
Role/permission gating here (hiding nav links, disabling actions) is **client-side UX
only** — the backend enforces the real authorization. Never treat a hidden UI element as a
security boundary when reasoning about access control changes.

`src/lib/api.ts` — `api.get/post/patch/del`, bearer token from `localStorage`, base URL
from `NEXT_PUBLIC_API_URL`, auto-redirects to `/login` on 401. Also `uploadFile`,
`downloadFile`, `fetchAuthedBlobUrl` for multipart/blob endpoints (invoices, statements,
exports).

## Routing (`src/app/`)

App Router. Public: `login/`, `email-action/[token]/` (one-click email approval landing
page). Everything else lives under the `(protected)/` route group, whose `layout.tsx`
wraps children in `<AppShell>` (sidebar/topbar chrome, role-gated nav):

```
(protected)/
  dashboard/
  expenses/            expense transactions
  events/              Pre-Event
  approvals/           approval inbox
  approval-levels/     ApprovalLevel config (admin)
  settlement/          settlement batches
  bank-matching/       statement upload + match review
  import/              Excel/CSV/PDF import
  users/
  audit-logs/
  master/
    units/ departments/ positions/ roles/ permissions/ credit-cards/
    agencies/ advertisers/ brands/ activity-types/
```

## Components (`src/components/`)

- `AppShell.tsx` — sidebar nav (`NAV` array with per-item `roles`/`permissions`),
  theme toggle. Add new top-level pages here to get them into the sidebar.
- `MasterCrudPage.tsx` — generic config-driven list+form CRUD (`apiPath`, `fields`,
  `columns`) that most `master/*` pages are thin wrappers around. **Prefer extending this
  over writing a bespoke CRUD page** for a new master-data entity.
- `Modal.tsx`, `Pagination.tsx` (paired with `src/lib/usePagination.ts`), `SearchBox.tsx`,
  `DatePicker.tsx`, `NumberInput.tsx` — shared primitives.
- `FileThumb.tsx`/`LocalFileThumb.tsx`/`ZoomableImage.tsx` — invoice/receipt image preview.
- `DepartmentExpenseChart.tsx` — dashboard chart.

Nearly every interactive file is `'use client'` — this is a client-heavy app; don't assume
Server Components patterns apply beyond the root layout.

## Conventions

- Path alias `@/*` → `./src/*` (`tsconfig.json`).
- `.env.local.example` → `NEXT_PUBLIC_API_URL` (default `http://localhost:3000/api/v1`),
  `SESSION_TIMEOUT` (idle timeout minutes).
- Mirrors the backend's endpoint shapes and error format 1:1 — check
  `digital_settlement_be`'s controller/DTO before inventing a new request/response shape.

## Related repos

`digital_settlement_be` (NestJS API this app consumes) and `digital_settlement_mobile`
(Flutter app, same backend, smaller feature set) are sibling repos — see their CLAUDE.md.
