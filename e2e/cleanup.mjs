// Removes leftovers from interrupted end-to-end runs: every e2e-*@cprocurement.dev
// user, plus organisations whose members are all test users (and their files).
//
//   npm run test:e2e:cleanup
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(".env.local"); } catch { /* CI provides the variables */ }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const isTestEmail = (e) => /^e2e-[a-z0-9]+-[a-z]+@cprocurement\.dev$/.test(e ?? "");

const testUsers = [];
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  testUsers.push(...data.users.filter((u) => isTestEmail(u.email)));
  if (data.users.length < 1000) break;
}
const ids = new Set(testUsers.map((u) => u.id));
console.log(`test users found: ${ids.size}`);

async function removeFolder(prefix) {
  const { data } = await sb.storage.from("attachments").list(prefix, { limit: 1000 });
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) await sb.storage.from("attachments").remove([path]);
    else await removeFolder(path);
  }
}

const { data: memberships } = await sb.from("members").select("org_id").in("user_id", [...ids]);
for (const org of new Set((memberships ?? []).map((m) => m.org_id))) {
  const { data: everyone } = await sb.from("members").select("user_id").eq("org_id", org);
  if ((everyone ?? []).some((m) => !ids.has(m.user_id))) {
    console.warn(`kept org ${org}: it has real members`);
    continue;
  }
  await removeFolder(org);
  const { error } = await sb.from("orgs").delete().eq("id", org);
  console.log(error ? `org ${org}: ${error.message}` : `deleted test org ${org}`);
}
const { count } = await sb.from("licenses").delete({ count: "exact" }).like("customer", "e2e-%");
console.log(`deleted test licenses: ${count ?? 0}`);
for (const u of testUsers) {
  const { error } = await sb.auth.admin.deleteUser(u.id);
  console.log(error ? `${u.email}: ${error.message}` : `deleted ${u.email}`);
}
