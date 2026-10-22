import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { setUpOrg } from "./actions";

export const metadata = { title: "Set up" };

export default async function Onboarding() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { count } = await supabase.from("members").select("*", { count: "exact", head: true }).eq("user_id", user.id);
  if (count) redirect("/");
  // Invited users join their organisation automatically.
  const { data: joined } = await supabase.rpc("accept_invite");
  if (joined) redirect("/");

  return (
    <main className="auth">
      <div className="auth-card card" style={{ maxWidth: 520 }}>
        <i className="x bl" /><i className="x br" />
        <h1 style={{ fontSize: 28 }}>Set up your workspace</h1>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          No invitation was found for your email. Create your organisation, or load a demo organisation to explore. If a colleague invited you, ask them to check the email address they used.
        </p>
        <ActionForm action={setUpOrg}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label className="lbl" htmlFor="display_name">Your name</label>
              <input className="input" id="display_name" name="display_name" placeholder="Your full name" required />
            </div>
            <div className="form-grid">
              <div>
                <label className="lbl" htmlFor="org_name">Organisation (empty workspace only)</label>
                <input className="input" id="org_name" name="org_name" placeholder="Organisation name" />
              </div>
              <div>
                <label className="lbl" htmlFor="title">Job title</label>
                <input className="input" id="title" name="title" placeholder="Procurement Officer" />
              </div>
            </div>
            <div className="actions">
              <Submit primary name="mode" value="demo">Load demo organisation</Submit>
              <Submit name="mode" value="empty">Create empty organisation</Submit>
            </div>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
