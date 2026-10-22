import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, CircleQuestionMark } from "lucide-react";
import { SearchBox } from "./search-box";
import { getCounts } from "@/lib/context";

export function Card({ title, note, children, className = "" }: {
  title?: ReactNode; note?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
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

export function Kpi({ label, value, sub, icon, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "amber" | "red" | "blue";
}) {
  return (
    <Card>
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        {icon && <div className={`kpi-icon ${tone ?? ""}`}>{icon}</div>}
      </div>
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
        <Bell size={18} strokeWidth={1.8} aria-hidden />
        {alerts > 0 && <span className="bell-count">{alerts}</span>}
      </Link>
      <Link className="icon-btn" href="/help" aria-label="Help">
        <CircleQuestionMark size={18} strokeWidth={1.8} aria-hidden />
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
