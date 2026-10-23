import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { licensedUntil, type License } from "./license";

/**
 * Without generated database types, supabase-js infers embedded relations from
 * the select string as arrays even when they are to-one. Until types are
 * generated, table queries return untyped rows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = Omit<SupabaseClient, "from"> & { from: (table: string) => any };

export type Role = "requester" | "approver" | "buyer" | "receiver" | "finance" | "admin";

export type Member = {
  org_id: string;
  display_name: string;
  title: string;
  office: string;
  roles: Role[];
  orgs: { name: string; licenses: License[] } | null;
};

const MEMBER_FIELDS =
  "org_id, display_name, title, office, roles, orgs(name, licenses(key_hint, term_months, starts_at, expires_at, revoked_at))";

/** The signed-in user's membership, or null. Shared by the app and the activation page. */
export async function getMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: member } = await supabase
    .from("members")
    .select(MEMBER_FIELDS)
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle<Member>();
  return { supabase, user, member, licensedUntil: member ? licensedUntil(member.orgs?.licenses) : null };
}

/**
 * Signed-in user, their membership and an RLS-scoped Supabase client. Sends
 * users without an organisation to onboarding and organisations without an
 * active license to activation. Cached per request.
 */
export const getContext = cache(async () => {
  const { supabase, user, member, licensedUntil } = await getMembership();
  if (!member) redirect("/onboarding");
  if (!licensedUntil) redirect("/activate");

  const can = (role: Role) => member.roles.includes(role) || member.roles.includes("admin");
  return { supabase: supabase as unknown as Db, user, member, orgId: member.org_id, can, licensedUntil };
});

/** Work-queue counts shown in the sidebar and the notification bell. Cached per request. */
export const getCounts = cache(async () => {
  const { supabase, orgId } = await getContext();
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [approvals, grns, exceptions, expiring] = await Promise.all([
    supabase.from("requisitions").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "submitted"),
    supabase.from("goods_receipts").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "draft"),
    supabase.from("invoices").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "exception"),
    supabase.from("vendor_documents").select("*", { count: "exact", head: true }).eq("org_id", orgId).lte("expires_on", soon),
  ]);
  return {
    approvals: approvals.count ?? 0,
    grns: grns.count ?? 0,
    exceptions: exceptions.count ?? 0,
    expiringDocs: expiring.count ?? 0,
  };
});
