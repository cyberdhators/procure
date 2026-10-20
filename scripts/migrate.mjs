// Applies supabase/migrations/*.sql in order, once each, tracking them in
// public._migrations. Uses the direct (non-pooled) Postgres connection that the
// Vercel Supabase integration provides.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("Set POSTGRES_URL_NON_POOLING (run `vercel env pull .env.local`).");
  process.exit(1);
}

const sql = postgres(url.replace(/[?&]sslmode=[^&]*/, ""), { ssl: "require", max: 1, onnotice: () => {} });
const dir = path.join(import.meta.dirname, "..", "supabase", "migrations");

try {
  await sql`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table public._migrations enable row level security`;
  const applied = new Set((await sql`select name from public._migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public._migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("database is up to date");
} finally {
  await sql.end();
}
