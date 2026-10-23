"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMembership } from "@/lib/context";
import { formatDate } from "@/lib/format";
import type { ActionState } from "@/components/action-form";

/** Activates a license key for the signed-in administrator's organisation. */
export async function activateLicense(_: ActionState, d: FormData): Promise<ActionState> {
  const key = String(d.get("license_key") ?? "").trim();
  if (!key) return { error: "Enter your license key." };
  const { supabase, member } = await getMembership();
  if (!member) redirect("/onboarding");

  const { data: until, error } = await supabase.rpc("activate_license", { p_org: member.org_id, p_key: key });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  if (d.get("from") === "settings") return { ok: `License activated. Your organisation is licensed until ${formatDate(until)}.` };
  redirect("/");
}
