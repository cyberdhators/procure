import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { authenticate } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  "Requisitions routed to the right approvers automatically",
  "RFQs, weighted bid scoring and award recommendations",
  "Goods receipt inspection and three-way invoice matching",
  "Donor-ready reports and an append-only audit trail",
];

export default function LoginPage() {
  return (
    <main className="auth-split">
      <section className="auth-hero">
        <div className="brand">
          <div className="brand-mark">CP</div>
          <div>
            <div className="brand-name">Cyber Procurement</div>
            <div className="brand-sub">C-PROCUREMENT</div>
          </div>
        </div>
        <h2>Procurement your donors and auditors can trust.</h2>
        <p>One place for every requisition, quotation, order, delivery and invoice, with segregation of duties built in.</p>
        <div className="auth-points">
          {POINTS.map((p) => (
            <div className="auth-point" key={p}><CircleCheck size={18} aria-hidden />{p}</div>
          ))}
        </div>
        <div className="auth-foot">Built for NGOs and donor-funded organisations.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <h1>Welcome back</h1>
          <p className="page-sub">Sign in to your workspace, or create an account to get started.</p>
          <ActionForm action={authenticate}>
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <label className="lbl" htmlFor="email">Work email</label>
                <input className="input" id="email" name="email" type="email" autoComplete="email"
                  placeholder="you@organisation.org" required />
              </div>
              <div>
                <label className="lbl" htmlFor="password">Password</label>
                <input className="input" id="password" name="password" type="password" autoComplete="current-password"
                  placeholder="At least 8 characters" minLength={8} required />
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
                <Submit primary name="mode" value="signin">Sign in</Submit>
                <Submit name="mode" value="signup">Create account</Submit>
              </div>
            </div>
          </ActionForm>
          <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 22 }}>
            Each organisation needs a license, USD 1,500 per year. <Link href="/pricing">See pricing</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
