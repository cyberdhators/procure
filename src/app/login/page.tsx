import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { authenticate } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth">
      <div className="auth-card card">
        <i className="x bl" /><i className="x br" />
        <div className="brand">
          <div className="brand-mark">CW</div>
          <div>
            <div className="brand-name">CORWADO</div>
            <div className="brand-sub">E-PROCUREMENT</div>
          </div>
        </div>
        <ActionForm action={authenticate}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label className="lbl" htmlFor="email">Work email</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <label className="lbl" htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />
            </div>
            <div className="actions" style={{ marginTop: 6 }}>
              <Submit primary name="mode" value="signin">Sign in</Submit>
              <Submit name="mode" value="signup">Create account</Submit>
            </div>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
