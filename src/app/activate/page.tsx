import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getMembership } from "@/lib/context";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { formatDate } from "@/lib/format";
import { signOut } from "../login/actions";
import { activateLicense } from "./actions";

export const metadata = { title: "Activate license" };

export default async function Activate() {
  const { member, licensedUntil } = await getMembership();
  if (!member) redirect("/onboarding");
  if (licensedUntil) redirect("/");

  const isAdmin = member.roles.includes("admin");
  const lapsed = (member.orgs?.licenses ?? []).filter((l) => l.expires_at && !l.revoked_at).map((l) => l.expires_at!).sort().at(-1);

  return (
    <main className="auth">
      <div className="auth-card card" style={{ maxWidth: 480 }}>
        <div className="brand">
          <div className="brand-mark">CP</div>
          <div>
            <div className="brand-name">Cyber Procurement</div>
            <div className="brand-sub">{(member.orgs?.name ?? "C-PROCUREMENT").toUpperCase()}</div>
          </div>
        </div>
        <h1 style={{ fontSize: 26, display: "flex", gap: 10, alignItems: "center" }}>
          <KeyRound size={22} aria-hidden /> {lapsed ? "Renew your license" : "Activate your license"}
        </h1>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          {lapsed
            ? `Your organisation's license ended on ${formatDate(lapsed)}. Your records are safe; enter a new key to keep working.`
            : "C-Procurement needs an active license for your organisation."}
        </p>

        {isAdmin ? (
          <ActionForm action={activateLicense}>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="lbl" htmlFor="license_key">License key</label>
                <input className="input" id="license_key" name="license_key" placeholder="CPRO-XXXXX-XXXXX-XXXXX-XXXXX"
                  autoComplete="off" spellCheck={false} required style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }} />
              </div>
              <Submit primary>Activate</Submit>
            </div>
          </ActionForm>
        ) : (
          <div className="notice" role="status">Ask an administrator of {member.orgs?.name ?? "your organisation"} to activate a license key.</div>
        )}

        <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "22px 0 0" }}>
          No key yet? <Link href="/pricing">See pricing and request a license</Link>.
        </p>
        <form action={signOut} style={{ marginTop: 14 }}>
          <button type="submit" className="btn btn-sm">Sign out</button>
        </form>
      </div>
    </main>
  );
}
