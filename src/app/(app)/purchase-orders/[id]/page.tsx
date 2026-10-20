import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Badge, Card, Field, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatMoney, formatQty, lineTotal } from "@/lib/money";
import { formatDate, formatShortDate, humanize } from "@/lib/format";

const FLOW = [
  ["draft", "Draft"], ["approved", "Approved"], ["issued", "Issued"], ["partially_received", "Partially received"],
  ["received", "Fully received"], ["invoiced", "Invoiced"], ["closed", "Closed"],
] as const;

export default async function PurchaseOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getContext();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select(`*, vendors(id, number, trading_name), requisitions(id, number), rfqs(id, number),
             budget_lines(code, donors(name)), po_lines(*), po_versions(*)`)
    .eq("id", id)
    .maybeSingle();
  if (!po) notFound();

  const [{ data: grns }, { data: invoices }] = await Promise.all([
    supabase.from("goods_receipts").select("id, number, status, grn_lines(po_line_id, received_qty)").eq("po_id", id),
    supabase.from("invoices").select("id, number, status").eq("po_id", id),
  ]);

  const lines = [...po.po_lines].sort((a, b) => a.line_no - b.line_no);
  const received = (lineId: string) =>
    (grns ?? []).filter((g) => g.status === "accepted")
      .flatMap((g) => g.grn_lines).filter((l) => l.po_line_id === lineId)
      .reduce((a, l) => a + Number(l.received_qty), 0);
  const subtotal = lines.reduce((a, l) => a + lineTotal(l.qty, l.unit_price_minor), 0);
  const dates = po.status_dates as Record<string, string>;
  const reached = FLOW.findIndex(([k]) => k === po.status);
  const versions = [...po.po_versions].sort((a, b) => b.version - a.version);
  const draftGrn = (grns ?? []).find((g) => g.status === "draft");

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing", href: "/purchase-orders" }, { label: po.number }]} />
      <div className="content">
        <PageHead
          title={po.number}
          badge={<><StatusBadge status={po.status} label={humanize(po.status)} /><Badge>Version {po.version}</Badge></>}
          sub={`${po.vendors?.trading_name}. ${po.title}.`}
          actions={draftGrn && <Link className="btn btn-primary" href={`/goods-receipts/${draftGrn.id}`}>Record goods receipt</Link>}
        />
        <div className="stepper">
          {FLOW.map(([k, label], i) => (
            <div key={k} className={`step ${i <= reached ? "done" : "todo"}`}>
              <div className="step-v" style={{ fontSize: 14 }}>{label}</div>
              <div className="step-d">{dates[k] ? formatShortDate(dates[k]) : i <= reached ? "" : "Pending"}</div>
            </div>
          ))}
        </div>
        <div className="grid g-main">
          <div className="stack">
            <Card title="Order lines">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Description</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num">{formatQty(l.qty)}</td>
                        <td className="num" style={{ color: "var(--green-text)" }}>{formatQty(received(l.id))}</td>
                        <td className="num">{formatMoney(l.unit_price_minor)}</td>
                        <td className="num">{formatMoney(lineTotal(l.qty, l.unit_price_minor))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4} className="num muted" style={{ color: "var(--muted)" }}>Subtotal</td><td className="num">{formatMoney(subtotal)}</td></tr>
                    <tr><td colSpan={4} className="num muted" style={{ color: "var(--muted)" }}>{po.tax_label}</td><td className="num">{formatMoney(po.tax_minor)}</td></tr>
                    <tr className="total-row"><td colSpan={4} className="num total-label">Total, {po.currency}</td><td className="num total-value">{formatMoney(subtotal + Number(po.tax_minor))}</td></tr>
                  </tfoot>
                </table>
              </div>
            </Card>
            <Card title="Version history">
              <table className="table">
                <thead><tr><th>Version</th><th>Change</th><th>By</th><th>Approved</th></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version}>
                      <td>v{v.version}{v.version === po.version ? ", current" : ""}</td>
                      <td>{v.change}</td>
                      <td>{v.by_label}</td>
                      <td>{v.approved_by}, {formatDate(v.approved_on)}</td>
                    </tr>
                  ))}
                  {!versions.length && <tr><td colSpan={4} className="empty">Original version only.</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="stack">
            <Card title="Order details">
              <div className="fields">
                <Field label="Vendor"><Link className="link" href={`/vendors/${po.vendors?.id}`}>{po.vendors?.trading_name}</Link>, {po.vendors?.number}</Field>
                <Field label="PO date">{formatDate(po.po_date)}</Field>
                <Field label="Delivery location">{po.delivery_location || "—"}</Field>
                <Field label="Expected delivery">{formatDate(po.expected_delivery)}</Field>
                <Field label="Payment terms">{po.payment_terms}</Field>
                <Field label="Currency">{po.currency}</Field>
                <Field label="Budget code">{po.budget_lines?.code ?? "—"}</Field>
                <Field label="Donor">{po.budget_lines?.donors?.name ?? "—"}</Field>
              </div>
            </Card>
            <Card title="Linked records">
              <div className="rows">
                {po.requisitions && <Link href={`/requisitions/${po.requisitions.id}`}><span>Requisition {po.requisitions.number}</span><span className="link">Open</span></Link>}
                {po.rfqs && <Link href={`/rfqs/${po.rfqs.id}/bids`}><span>{po.rfqs.number} and bid evaluation</span><span className="link">Open</span></Link>}
                {(grns ?? []).map((g) => (
                  <Link key={g.id} href={`/goods-receipts/${g.id}`}><span>Goods received note {g.number}</span><span className="link">Open</span></Link>
                ))}
                {(invoices ?? []).map((i) => (
                  <Link key={i.id} href={`/invoices/${i.id}`}><span>Invoice {i.number}</span><span className="link">Open</span></Link>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
