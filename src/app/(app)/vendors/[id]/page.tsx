import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Bars, Card, Field, PageHead, Stat, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { setVendorStatus } from "../../actions";
import { formatMoney, formatWhole, lineTotal } from "@/lib/money";
import { daysUntil, formatDate, humanize, plural } from "@/lib/format";

export default async function VendorProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const { data: v } = await supabase
    .from("vendors")
    .select("*, vendor_documents(*), purchase_orders(id, number, title, status, po_date, po_lines(qty, unit_price_minor))")
    .eq("id", id)
    .maybeSingle();
  if (!v) notFound();

  const orders = [...v.purchase_orders].sort((a, b) => (b.po_date ?? "").localeCompare(a.po_date ?? ""));
  const value = (o: (typeof orders)[number]) => o.po_lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_price_minor), 0);
  const completed = orders.filter((o) => ["closed", "invoiced", "received"].includes(o.status)).length;
  const spend = orders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + value(o), 0);
  const scores = [
    ["Price", v.score_price], ["Quality", v.score_quality], ["Delivery reliability", v.score_delivery],
    ["Responsiveness", v.score_responsiveness], ["Compliance", v.score_compliance],
  ].filter(([, s]) => s !== null) as [string, number][];
  const rating = scores.length ? (scores.reduce((a, [, s]) => a + Number(s), 0) / scores.length).toFixed(1) : null;

  const docStatus = (exp: string | null) => {
    if (!exp) return <StatusBadge status="valid" label="Valid" />;
    const n = daysUntil(exp);
    if (n < 0) return <StatusBadge status="expired" label="Expired" />;
    if (n <= 30) return <StatusBadge status="expiring" label={`Expires in ${plural(n, "day")}`} />;
    return <StatusBadge status="valid" label="Valid" />;
  };

  return (
    <>
      <Topbar crumbs={[{ label: "Vendors", href: "/vendors" }, { label: v.trading_name }]} />
      <div className="content">
        <PageHead
          title={v.trading_name}
          badge={<StatusBadge status={v.status} />}
          sub={`${v.number}. ${v.categories || "No categories"}. Registered ${formatDate(v.registered_on)}.`}
          actions={can("admin") && (
            <ActionForm action={setVendorStatus} className="actions">
              <input type="hidden" name="id" value={v.id} />
              {v.status !== "suspended" && <Submit name="status" value="suspended">Suspend</Submit>}
              {v.status !== "approved" && <Submit primary name="status" value="approved">Approve vendor</Submit>}
            </ActionForm>
          )}
        />
        <div className="grid g-4">
          <Stat value={rating ? `${rating} / 5` : "—"} label="Overall rating" />
          <Stat value={completed} label="Orders completed" />
          <Stat value={v.on_time_pct !== null ? `${v.on_time_pct}%` : "—"} label="On-time delivery" />
          <Stat value={formatWhole(spend)} label="Total spend, USD" />
        </div>
        <div className="grid g-2">
          <Card title="Registration">
            <div className="fields">
              <Field label="Legal name">{v.legal_name}</Field>
              <Field label="Trading name">{v.trading_name}</Field>
              <Field label="Registration no.">{v.registration_no || "—"}</Field>
              <Field label="Tax ID">{v.tax_id || "—"}</Field>
              <Field label="Contact">{v.contact || "—"}</Field>
              <Field label="Email">{v.email || "—"}</Field>
              <Field label="Bank">{v.bank || "—"}</Field>
              <Field label="Conflict of interest">{v.conflict_of_interest}</Field>
            </div>
          </Card>
          <Card title="Documents">
            <table className="table">
              <thead><tr><th>Document</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>
                {v.vendor_documents.map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td>{d.expires_on ? formatDate(d.expires_on) : "No expiry"}</td><td>{docStatus(d.expires_on)}</td></tr>
                ))}
                {!v.vendor_documents.length && <tr><td colSpan={3} className="empty">No documents on file.</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="Performance, last 12 months">
            {scores.length ? (
              <Bars rows={scores.map(([label, s]) => ({ label, value: Number(s), display: Number(s).toFixed(1) }))} />
            ) : (
              <div className="empty">No performance history yet.</div>
            )}
          </Card>
          <Card title="Recent orders">
            <table className="table">
              <thead><tr><th>PO</th><th>Description</th><th className="num">Value</th><th>Status</th></tr></thead>
              <tbody>
                {orders.slice(0, 6).map((o) => (
                  <tr key={o.id}>
                    <td><Link className="rowlink" href={`/purchase-orders/${o.id}`}>{o.number}</Link></td>
                    <td>{o.title}</td>
                    <td className="num">{formatMoney(value(o))}</td>
                    <td><StatusBadge status={o.status} label={humanize(o.status)} /></td>
                  </tr>
                ))}
                {!orders.length && <tr><td colSpan={4} className="empty">No orders yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
