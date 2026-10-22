// Test users and cleanup for end-to-end runs against a real deployment.
// Uses the Supabase secret key (server-side only, never shipped to the app)
// to create pre-confirmed users and to delete everything the run created.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Browser, Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
export const admin = () => createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

export type TestUser = { key: string; email: string; password: string; name: string; title: string; id?: string };

export function makeUsers(run: string): Record<"officer" | "head" | "manager" | "finance", TestUser> {
  const pw = () => `E2e-${randomBytes(9).toString("base64url")}!`;
  const u = (key: string, name: string, title: string) =>
    ({ key, email: `e2e-${run}-${key}@cprocurement.dev`, password: pw(), name, title });
  return {
    officer: u("officer", "E2E Procurement Officer", "Procurement Officer"),
    head: u("head", "E2E Head of Administration", "Head of Administration"),
    manager: u("manager", "E2E Project Manager", "Project 01 Manager"),
    finance: u("finance", "E2E Finance Officer", "Finance Officer"),
  };
}

export async function createUsers(users: TestUser[]) {
  const sb = admin();
  for (const u of users) {
    const { data, error } = await sb.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
    if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
    u.id = data.user.id;
  }
}

/** Deletes every organisation the test users belong to (cascading all records), its files, and the users. */
export async function cleanup(users: TestUser[]) {
  const sb = admin();
  const ids = users.map((u) => u.id).filter(Boolean) as string[];
  if (!ids.length) return;
  const { data: memberships } = await sb.from("members").select("org_id").in("user_id", ids);
  const orgs = [...new Set((memberships ?? []).map((m) => m.org_id))];
  for (const org of orgs) {
    // Only delete organisations made up entirely of test users.
    const { data: everyone } = await sb.from("members").select("user_id").eq("org_id", org);
    if ((everyone ?? []).some((m) => !ids.includes(m.user_id))) {
      console.warn(`Skipping org ${org}: it has non-test members`);
      continue;
    }
    await removeFolder(sb, org);
    const { error } = await sb.from("orgs").delete().eq("id", org);
    if (error) console.warn(`Could not delete org ${org}: ${error.message}`);
  }
  for (const id of ids) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error) console.warn(`Could not delete user ${id}: ${error.message}`);
  }
}

async function removeFolder(sb: ReturnType<typeof admin>, prefix: string) {
  const { data } = await sb.storage.from("attachments").list(prefix, { limit: 1000 });
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) await sb.storage.from("attachments").remove([path]);
    else await removeFolder(sb, path);
  }
}

/** A signed-in browser page for one user, failing the test on any page error or 5xx response. */
export async function signIn(browser: Browser, user: TestUser, problems: string[]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`[${user.key}] page error: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[${user.key}] HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { waitUntil: "domcontentloaded" });
  return page;
}
