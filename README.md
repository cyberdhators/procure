# Cyber Procurement (C-Procurement)

Multi-tenant procurement platform for NGOs and donor-funded organisations. Developed by **cyberdhators**.

**Stack:** Next.js 16 (App Router, server actions) · Supabase (Postgres, Auth, Storage, row-level security) · Vercel.

## The procurement cycle

| Step | Who | Control |
|---|---|---|
| Requisition | requester | Must reference the org's own department/project/donor and an existing budget line |
| Approval | approver / finance | Routing rules by value, category and donor; each level needs its role; nobody approves their own request or two levels; final approval blocked if the budget line lacks funds |
| Sourcing | buyer | RFQ above the direct-purchase limit; only approved vendors with valid documents; minimum vendors; sealed bids until close; panel scoring; justified award |
| Purchase order | buyer drafts, approver approves | Approver ≠ drafter; PO ≤ awarded bid and ≤ requisition + tolerance; issuing trues up the budget commitment |
| Goods receipt | receiver | Receiver ≠ PO drafter; cumulative quantity ≤ ordered; discrepancies must be described |
| Invoice | finance | Duplicate supplier numbers rejected; three-way match re-run on every receipt; registrar and receivers cannot approve; payment updates spend and closes the PO |

Every transition is a `SECURITY DEFINER` Postgres function (`supabase/migrations/`) that checks the role, applies
the rule, changes state and writes the audit entry in one transaction. The audit log rejects updates and deletes.
Money is stored in integer cents. Dashboards and reports aggregate in SQL.

## Setup

1. Create a Supabase project and set, locally in `.env.local` and in Vercel:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
2. Apply `supabase/migrations/*.sql` in order: `POSTGRES_URL_NON_POOLING=<session pooler URI> npm run db:migrate`,
   or paste them into the Supabase SQL editor.
3. Supabase → Authentication:
   - URL configuration → Site URL = your production URL; add it to redirect URLs.
   - Configure custom SMTP (the built-in sender is rate-limited to a few emails per hour).
4. The first user creates the organisation (or loads the demo) and becomes administrator. Invite colleagues from
   **Settings → Members**; they join automatically when they sign up with the invited email.

## Scripts

| Command | |
|---|---|
| `npm run dev` / `npm run build` | Develop / build |
| `npm test` | Unit tests: bid scoring, three-way match, money |
| `npm run test:db` | Database tests on in-memory Postgres: full lifecycle with four users, RLS, SoD, audit |
| `npm run check` | Typecheck and both test suites (also run in CI) |
| `npm run db:migrate` | Apply pending migrations |

## Known limitations

- One organisation per user; multi-org switching is not built.
- Purchase order amendments after issue (versioning UI) and credit notes are not built yet.
- No scheduled jobs yet for approval escalation or document-expiry emails (the dashboard surfaces both).
- Database types are not generated; `noImplicitAny` is relaxed until `supabase gen types` is added.
