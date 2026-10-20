"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/action-form";

export async function authenticate(_: ActionState, data: FormData): Promise<ActionState> {
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");
  const mode = String(data.get("mode") ?? "signin");
  if (!email || password.length < 8) return { error: "Enter your email and a password of at least 8 characters." };

  const supabase = await createClient();
  if (mode === "signup") {
    const origin = (await headers()).get("origin") ?? "";
    const { data: res, error } = await supabase.auth.signUp({
      email, password, options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return { error: error.message };
    if (!res.session) return { ok: "Check your inbox to confirm your email, then sign in." };
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
