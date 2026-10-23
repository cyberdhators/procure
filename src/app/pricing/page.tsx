import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { PRICE_PER_YEAR_USD } from "@/lib/license";
import { requestLicense } from "./actions";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Cyber Procurement is USD ${PRICE_PER_YEAR_USD.toLocaleString("en-US")} per organisation per year.`,
};

const INCLUDED = [
  "Unlimited users and records for one organisation",
  "Requisitions with approval routing by value, category and donor",
  "RFQs, sealed bids, panel scoring and award recommendations",
  "Purchase orders, goods receipts and three-way invoice matching",
  "Budget control, segregation of duties and an append-only audit log",
  "Donor-ready reports with CSV export, and document attachments",
  "Hosting, backups, security updates and email support",
];

const STEPS = [
  ["Request a license", "Send the form below. We reply with an invoice for the annual fee."],
  ["Receive your key", "Once payment is received we email a license key for your organisation."],
  ["Activate", "An administrator signs in and enters the key. Renewals extend from your current expiry date."],
];

const FAQ = [
  ["What happens when a license ends?", "Your records stay safe and readable, but new requisitions, approvals, orders and payments are paused until a renewal key is activated."],
  ["Can I try it first?", "Ask us for a demo. Your account and organisation are ready as soon as you sign up; a key unlocks them."],
  ["Is the price per user?", "No. One license covers one organisation, with as many members as you need."],
];

export default function Pricing() {
  const price = PRICE_PER_YEAR_USD.toLocaleString("en-US");
  return (
    <main className="pricing">
      <header className="pricing-top">
        <Link href="/" className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">CP</div>
          <div>
            <div className="brand-name">Cyber Procurement</div>
            <div className="brand-sub">C-PROCUREMENT</div>
          </div>
        </Link>
        <Link href="/login" className="btn btn-sm">Sign in</Link>
      </header>

      <section className="pricing-hero">
        <h1>One plan. Everything included.</h1>
        <p className="page-sub">Procurement your donors and auditors can trust, for a single annual fee per organisation.</p>
      </section>

      <section className="pricing-grid">
        <div className="card price-card">
          <div className="price-name">C-Procurement Annual</div>
          <div className="price-amount"><span>USD {price}</span> / year</div>
          <div className="price-sub">per organisation, billed annually</div>
          <ul className="price-list">
            {INCLUDED.map((i) => <li key={i}><CircleCheck size={17} aria-hidden />{i}</li>)}
          </ul>
          <a href="#request" className="btn btn-primary" style={{ justifyContent: "center" }}>Request a license</a>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 14 }}>How it works</h2>
            <div className="route">
              {STEPS.map(([title, text], i) => (
                <div className="route-item" key={title}>
                  <div className="route-n">{i + 1}</div>
                  <div><strong>{title}</strong><div style={{ fontSize: 13.5, color: "var(--muted)" }}>{text}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 10 }}>Questions</h2>
            {FAQ.map(([q, a]) => (
              <div key={q} style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>{q}</strong>
                <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card pricing-form" id="request">
        <h2 style={{ fontSize: 18 }}>Request a license</h2>
        <p className="page-sub" style={{ marginBottom: 18 }}>USD {price} per year per organisation.</p>
        <ActionForm action={requestLicense}>
          <div className="form-grid">
            <div><label className="lbl" htmlFor="organisation">Organisation</label>
              <input className="input" id="organisation" name="organisation" maxLength={200} required /></div>
            <div><label className="lbl" htmlFor="contact_name">Your name</label>
              <input className="input" id="contact_name" name="contact_name" maxLength={200} autoComplete="name" required /></div>
            <div><label className="lbl" htmlFor="req_email">Work email</label>
              <input className="input" id="req_email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>
            <div><label className="lbl" htmlFor="country">Country</label>
              <input className="input" id="country" name="country" maxLength={100} autoComplete="country-name" /></div>
            <div className="full"><label className="lbl" htmlFor="message">Anything we should know? (optional)</label>
              <textarea className="input" id="message" name="message" rows={3} maxLength={2000} /></div>
            <div className="hp" aria-hidden><label htmlFor="website">Website</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
            <div className="full"><Submit primary>Send request</Submit></div>
          </div>
        </ActionForm>
      </section>
    </main>
  );
}
