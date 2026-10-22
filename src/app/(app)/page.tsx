import Link from "next/link";
import { FileText, Plus, ShoppingCart, TriangleAlert, Truck } from "lucide-react";
import { getContext } from "@/lib/context";
import { Bars, Card, Kpi, PageHead, Stat, Topbar } from "@/components/ui";
import { formatMoney, formatWhole } from "@/lib/money";
import { plural } from "@/lib/format";

export const metadata = { title: "Dashboard" };

type Stats = {
  open_reqs: number; awaiting_approval: number; open_pos: number; open_po_value: number; pending_grns: number;
  late_deliveries: number; exceptions: number; exception_value: number; overdue_approvals: number;
  expiring_docs: number; rfqs_open: number; rfqs_evaluation: number; rfqs_awarded: number; pos_issued: number;
  invoices_open: number; by_department: { name: string; committed: number }[];
  cycle_req_to_approval: number | null; cycle_po_to_delivery: number | null; cycle_receipt_to_invoice: number | null;
  approved_count: number; accepted_grns: number;
};
const days = (n: number | null) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));

export default async function Dashboard() {
  const { supabase, orgId } = await getContext();
  // All totals are computed in Postgres: the REST API caps row sets at 1,000.
  const { data, error } = await supabase.rpc("dashboard_stats", { p_org: orgId });
  if (error) throw new Error(error.message);
  const s = data as Stats;

  const deptRows = s.by_department.map((d) => ({ label: d.name, value: Number(d.committed), display: formatWhole(d.committed) }));
  const pipeline = [
    { label: "Requisitions awaiting approval", value: s.awaiting_approval, href: "/approvals" },
    { label: "RFQs open for bids", value: s.rfqs_open, href: "/rfqs" },
    { label: "Bids under evaluation", value: s.rfqs_evaluation, href: "/rfqs" },
    { label: "Awards awaiting a purchase order", value: s.rfqs_awarded, href: "/rfqs" },
    { label: "POs issued, not yet received", value: s.pos_issued, href: "/purchase-orders" },
    { label: "Invoices awaiting approval", value: s.invoices_open, href: "/invoices" },
  ];
  const attention = [
    { label: "Approvals overdue more than 3 days", count: s.overdue_approvals, href: "/approvals" },
    { label: "Vendor documents expiring within 30 days", count: s.expiring_docs, href: "/vendors" },
    { label: "Deliveries past expected date", count: s.late_deliveries, href: "/purchase-orders" },
    { label: "Invoice variances above tolerance", count: s.exceptions, href: "/invoices" },
  ];

  return (
    <>
      <Topbar crumbs={[{ label: "Overview" }, { label: "Dashboard" }]} />
      <div className="content">
        <PageHead
          title="Management dashboard"
          sub="Procurement activity across all departments, projects and donors."
          actions={
            <>
              <Link className="btn" href="/reports">Export</Link>
              <Link className="btn btn-primary" href="/requisitions/new"><Plus size={16} aria-hidden />New requisition</Link>
            </>
          }
        />
        <div className="grid g-4">
          <Kpi label="Open requisitions" value={s.open_reqs} sub={`${s.awaiting_approval} awaiting approval`}
            icon={<FileText size={17} aria-hidden />} />
          <Kpi label="Open purchase orders" value={s.open_pos} sub={`USD ${formatMoney(s.open_po_value)} on order`}
            icon={<ShoppingCart size={17} aria-hidden />} tone="blue" />
          <Kpi label="Pending inspections" value={s.pending_grns} sub={`${s.late_deliveries} deliveries late`}
            icon={<Truck size={17} aria-hidden />} tone="amber" />
          <Kpi label="Invoice exceptions" value={s.exceptions} sub={`USD ${formatMoney(s.exception_value)} on hold`}
            icon={<TriangleAlert size={17} aria-hidden />} tone="red" />
        </div>
        <div className="grid g-main">
          <Card title="Spend by department" note="USD, committed">
            {deptRows.length ? <Bars rows={deptRows} /> : <div className="empty">No budget lines yet.</div>}
          </Card>
          <Card title="Pipeline">
            <div className="rows">
              {pipeline.map((p) => (
                <Link key={p.label} href={p.href}><span>{p.label}</span><span className="num">{p.value}</span></Link>
              ))}
            </div>
          </Card>
        </div>
        <div className="grid g-2">
          <Card title="Attention required">
            <table className="table">
              <thead><tr><th>Item</th><th>Count</th><th /></tr></thead>
              <tbody>
                {attention.map((a) => (
                  <tr key={a.label}>
                    <td>{a.label}</td>
                    <td>{a.count}</td>
                    <td className="num">{a.count > 0 && <Link className="link" href={a.href}>Review</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Average cycle time, days">
            <div className="grid g-3" style={{ gap: 16 }}>
              <Stat value={days(s.cycle_req_to_approval)} label="Requisition to approval" />
              <Stat value={days(s.cycle_po_to_delivery)} label="PO to delivery" />
              <Stat value={days(s.cycle_receipt_to_invoice)} label="Receipt to invoice" />
            </div>
            <p className="help">
              Based on {plural(s.approved_count, "approved requisition")} and {plural(s.accepted_grns, "accepted receipt")}.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
