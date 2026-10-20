# CORWADO e-Procurement

Multi-tenant procurement SaaS for NGOs and donor-funded organisations: requisitions with
rule-based approval routing, vendor register, RFQs and weighted bid evaluation, purchase
orders, goods receipt with inspection, three-way invoice matching, reports and an
append-only audit log.

**Stack:** Next.js 16 (App Router, server actions) · Supabase (Postgres, Auth, row-level security) · Vercel.

## How it is built

- **Tenancy.** Every table carries `org_id`; row-level security limits each user to their organisation.
- **Workflow in the database.** State changes (submit, approve, receive, resolve…) are `SECURITY DEFINER`
  Postgres functions in `supabase/migrations/0002_workflow.sql`. Each one checks the role, enforces
  segregation of duties, mutates state and writes the audit entry in one transaction.
- **Segregation of duties.** Requesters cannot approve their own requisitions, one person cannot approve two
  levels, a PO's buyer cannot receive against it, and a receiver cannot approve the matching invoice.
- **Money** is stored as integer minor units (cents).
- **Audit log** is append-only: a trigger rejects updates and deletes, and users cannot call the logging function directly.
- **Pure business logic** (bid scoring, three-way match, money) lives in `src/lib` with unit tests.

## Setup

1. Create a Supabase project. Put these in `.env.local` (and in the Vercel project's environment variables):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   POSTGRES_URL_NON_POOLING=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
   ```

2. Apply the migrations: `npm run db:migrate`
   (or paste the files in `supabase/migrations/` into the Supabase SQL editor, in order).
3. In Supabase → Authentication → URL configuration, set the site URL to your deployment URL.
4. `npm install && npm run dev`, create an account, then choose **Load demo organisation**.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests for scoring, matching and money |
| `npm run typecheck` | TypeScript |
| `npm run db:migrate` | Apply pending SQL migrations |

## Next steps

- Generate database types (`supabase gen types typescript`) and re-enable `noImplicitAny`.
- File uploads to Supabase Storage for attachments and GRN photos.
- Member invitations and role management UI; approval-rule editor.
- Scheduled jobs: approval escalation reminders and vendor document expiry alerts.
- Purchase order creation from an awarded RFQ, and PDF output.
