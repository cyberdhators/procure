// License administration for the platform owner. Uses the Supabase secret key
// from .env.local; keys are shown once and stored only as a SHA-256 hash.
//
//   npm run license -- issue --customer "Org name" [--months 12] [--count 1]
//   npm run license -- list
//   npm run license -- revoke <key ending>
//   npm run license -- requests
import { createClient } from "@supabase/supabase-js";
import { createHash, randomInt } from "node:crypto";
import { parseArgs } from "node:util";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

/** Same normalisation as license_key_hash() in the database. */
export function keyHash(key) {
  const body = key.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^CPRO/, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function newKey() {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""));
  return `CPRO-${groups.join("-")}`; // 100 random bits
}

const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* use the environment */ }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret } = process.env;
  if (!url || !secret) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { positionals: [command, arg], values } = parseArgs({
    allowPositionals: true,
    options: { customer: { type: "string" }, months: { type: "string", default: "12" }, count: { type: "string", default: "1" } },
  });

  if (command === "issue") {
    const customer = values.customer?.trim();
    const months = Number(values.months);
    const count = Number(values.count);
    if (!customer) throw new Error('Add --customer "Organisation name"');
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("--months must be 1 to 120");
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("--count must be 1 to 50");
    const keys = Array.from({ length: count }, newKey);
    const { error } = await sb.from("licenses").insert(keys.map((k) => ({
      key_hash: keyHash(k), key_hint: k.slice(-5), customer, term_months: months,
    })));
    if (error) throw error;
    console.log(`Issued ${count} ${months}-month license key(s) for ${customer}. Send each key to the customer; it is not stored and cannot be shown again.\n`);
    for (const k of keys) console.log(`  ${k}`);
  } else if (command === "list") {
    const { data, error } = await sb.from("licenses")
      .select("key_hint, customer, term_months, starts_at, expires_at, revoked_at, created_at, orgs(name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const now = Date.now();
    console.table(data.map((l) => ({
      key: `…${l.key_hint}`, customer: l.customer, months: l.term_months, organisation: l.orgs?.name ?? "",
      status: l.revoked_at ? "revoked" : !l.starts_at ? "unused" : Date.parse(l.expires_at) <= now ? "expired"
        : Date.parse(l.starts_at) > now ? "starts later" : "active",
      from: date(l.starts_at), until: date(l.expires_at), issued: date(l.created_at),
    })));
  } else if (command === "revoke") {
    const hint = String(arg ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-5);
    if (hint.length !== 5) throw new Error("Give the last 5 characters of the key: npm run license -- revoke ABCDE");
    const { data, error } = await sb.from("licenses").select("id, customer, orgs(name)").eq("key_hint", hint).is("revoked_at", null);
    if (error) throw error;
    if (data.length !== 1) throw new Error(data.length ? `${data.length} keys end in ${hint}; revoke in the Supabase table editor` : `No active key ends in ${hint}`);
    const { error: e2 } = await sb.from("licenses").update({ revoked_at: new Date().toISOString() }).eq("id", data[0].id);
    if (e2) throw e2;
    console.log(`Revoked key …${hint} (${data[0].customer}${data[0].orgs ? `, ${data[0].orgs.name}` : ""}).`);
  } else if (command === "requests") {
    const { data, error } = await sb.from("license_requests").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    console.table(data.map((r) => ({
      received: date(r.created_at), organisation: r.organisation, name: r.contact_name, email: r.email,
      country: r.country, status: r.status, message: r.message.slice(0, 60),
    })));
  } else {
    console.log("Usage: npm run license -- issue --customer \"Org\" [--months 12] [--count 1] | list | revoke <key ending> | requests");
    process.exitCode = command ? 1 : 0;
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith("license.mjs")) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
