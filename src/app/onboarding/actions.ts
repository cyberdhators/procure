"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/action-form";

export async function setUpOrg(_: ActionState, data: FormData): Promise<ActionState> {
  const displayName = String(data.get("display_name") ?? "").trim();
  const mode = String(data.get("mode"));
  if (!displayName) return { error: "Enter your name." };

  const supabase = await createClient();
  const { error } =
    mode === "demo"
      ? await supabase.rpc("create_demo_org", { p_display_name: displayName })
      : await supabase.rpc("create_org", {
          p_name: String(data.get("org_name") ?? "").trim() || "My organisation",
          p_display_name: displayName,
          p_title: String(data.get("title") ?? "").trim(),
        });
  if (error) return { error: error.message };
  redirect("/");
}
