import Link from "next/link";
import type { ReactNode } from "react";
import { SearchBox } from "./search-box";
import { getCounts } from "@/lib/context";

export function Card({ title, note, children, className = "" }: {
  title?: ReactNode; note?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <i className="x bl" />
      <i className="x br" />
      {(title || note) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {note && <span className="card-note">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "green" | "amber" | "red" | "grey" | "solid";

export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === "grey" ? "" : tone}`}>{children}</span>;
}

const TONES: Record<string, Tone> = {
  approved: "green", issued: "green", open: "green", accepted: "green", matched: "green", passed: "green",
  valid: "green", closed: "green", "bid received": "green", scored: "green", recommended: "green",
  approved_for_payment: "green", received: "green",
  exception: "amber", "short delivery": "amber", "quantity variance": "amber", returned: "amber",
  "price variance": "amber", partially_received: "grey", expiring: "amber", pending: "grey",
  rejected: "red", expired: "red", "not delivered": "red", "missing receipt": "red", suspended: "red", cancelled: "red",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = status.toLowerCase();
  const text = label ?? (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, " ");
  return <Badge tone={TONES[key] ?? "grey"}>{text}</Badge>;
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </Card>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  );
}

export async function Topbar({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  const c = await getCounts();
  const alerts = c.approvals + c.exceptions + c.expiringDocs;
  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && " / "}
            {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
          </span>
        ))}
      </nav>
      <SearchBox />
      <Link href="/" className="icon-btn" aria-label={`${alerts} items need attention`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {alerts > 0 && <span className="bell-count">{alerts}</span>}
      </Link>
      <Link className="icon-btn" href="/help" aria-label="Help">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
        </svg>
      </Link>
    </header>
  );
}

export function PageHead({ title, badge, sub, actions }: {
  title: ReactNode; badge?: ReactNode; sub?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title"><h1>{title}</h1>{badge}</div>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Bars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <span>{r.label}</span>
          <div className="bar" role="img" aria-label={`${r.label}: ${r.display}`}>
            <span style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="num">{r.display}</span>
        </div>
      ))}
    </div>
  );
}
