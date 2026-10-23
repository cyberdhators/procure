import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, ClipboardCheck, FileSearch, Route, ShieldCheck } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { PRICE_PER_YEAR_USD } from "@/lib/license";
import { requestLicense } from "./actions";

export const metadata: Metadata = {
  title: { absolute: "Cyber Procurement · Procurement for NGOs and donor-funded organisations" },
  description: `Cyber Procurement is USD ${PRICE_PER_YEAR_USD.toLocaleString("en-US")} per organisation per year.`,
};

const FEATURES = [
  { icon: Route, title: "Approvals that route themselves", text: "Requisitions go to the right approvers by value, category and donor, and are blocked when the budget line cannot cover them." },
  { icon: FileSearch, title: "Fair, documented sourcing", text: "RFQs to approved vendors, sealed bids until closing, panel scoring and a justified award recommendation." },
  { icon: ClipboardCheck, title: "Orders, deliveries and invoices that match", text: "Purchase orders, goods receipt inspection and three-way matching before anything is paid." },
  { icon: ShieldCheck, title: "Ready for donors and auditors", text: "Segregation of duties enforced at every step, an append-only audit log and donor-ready spend reports." },
];

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
        <nav className="actions">
          <a href="#features" className="landing-link">Features</a>
          <a href="#pricing" className="landing-link">Pricing</a>
          <Link href="/login" className="btn btn-sm">Sign in</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-eyebrow">C-PROCUREMENT</div>
        <h1>Procurement your donors and auditors can trust.</h1>
        <p className="page-sub">
          One place for every requisition, quotation, order, delivery and invoice, with segregation of duties
          built in. Built for NGOs and donor-funded organisations.
        </p>
        <div className="actions" style={{ justifyContent: "center", marginTop: 24 }}>
          <a href="#request" className="btn btn-primary">Request a license</a>
          <a href="#pricing" className="btn">See pricing</a>
        </div>
      </section>

      <section id="features" className="landing-features">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div className="card" key={title}>
            <div className="kpi-icon" style={{ marginBottom: 12 }}><Icon size={18} aria-hidden /></div>
            <h2 style={{ fontSize: 15.5, marginBottom: 6 }}>{title}</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>{text}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className="pricing-hero">
        <h2>One plan. Everything included.</h2>
        <p className="page-sub">A single annual fee per organisation.</p>
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

      <footer className="landing-foot">
        Cyber Procurement · <Link href="/login">Sign in</Link> · Developed by <strong>cyberdhators</strong>
      </footer>
    </main>
  );
}
