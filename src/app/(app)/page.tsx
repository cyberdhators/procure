import Link from "next/link";
import { getContext, getCounts } from "@/lib/context";
import { Bars, Card, Kpi, PageHead, Stat, Topbar } from "@/components/ui";
import { formatMoney, formatWhole, lineTotal } from "@/lib/money";
import { daysSince, plural } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const OPEN_PO = ["approved", "issued", "partially_received", "received"];
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "—");
const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export default async function Dashboard() {
  const { supabase, orgId } = await getContext();
  const counts = await getCounts();
  const today = new Date().toISOString().slice(0, 10);

  const [reqs, pos, rfqs, grns, invoices, budgets, steps] = await Promise.all([
    supabase.from("requisitions").select("id, status, submitted_at, approval_steps(status, acted_at)").eq("org_id", orgId),
    supabase.from("purchase_orders").select("id, status, po_date, expected_delivery, po_lines(qty, unit_price_minor)").eq("org_id", orgId),
    supabase.from("rfqs").select("status").eq("org_id", orgId),
    supabase.from("goods_receipts").select("status, delivered_on, po_id").eq("org_id", orgId),
    supabase.from("invoices").select("status, received_on, po_id, invoice_lines(qty, unit_price_minor)").eq("org_id", orgId),
    supabase.from("budget_lines").select("committed_minor, departments(name)").eq("org_id", orgId),
    supabase.from("approval_steps").select("activated_at").eq("org_id", orgId).eq("status", "pending"),
  ]);

  const reqRows = reqs.data ?? [];
  const poRows = pos.data ?? [];
  const invRows = invoices.data ?? [];
  const openReqs = reqRows.filter((r) => ["draft", "submitted", "returned"].includes(r.status)).length;
  const openPos = poRows.filter((p) => OPEN_PO.includes(p.status));
  const openPoValue = openPos.reduce((a, p) => a + p.po_lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_price_minor), 0), 0);
  const overdueDeliveries = poRows.filter(
    (p) => ["issued", "partially_received"].includes(p.status) && p.expected_delivery && p.expected_delivery < today,
  ).length;
  const exceptionValue = invRows
    .filter((i) => i.status === "exception")
    .reduce((a, i) => a + i.invoice_lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_price_minor), 0), 0);
  const overdueApprovals = (steps.data ?? []).filter((s) => daysSince(s.activated_at) > 3).length;

  const byDept = new Map<string, number>();
  for (const b of budgets.data ?? []) {
    const name = (b.departments as unknown as { name: string } | null)?.name ?? "Unassigned";
    byDept.set(name, (byDept.get(name) ?? 0) + Number(b.committed_minor));
  }
  const deptRows = [...byDept.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, display: formatWhole(value) }));

  // Cycle times from actual records.
  const reqToApproval = reqRows
    .filter((r) => r.status === "approved" && r.submitted_at)
    .map((r) => {
      const last = r.approval_steps.map((s) => s.acted_at).filter(Boolean).sort().at(-1);
      return last ? days(r.submitted_at!, last) : null;
    })
    .filter((x): x is number => x !== null);
  const grnRows = (grns.data ?? []).filter((g) => g.status === "accepted");
  const poToDelivery = grnRows
    .map((g) => {
      const po = poRows.find((p) => p.id === g.po_id);
      return po?.po_date ? days(po.po_date, g.delivered_on) : null;
    })
    .filter((x): x is number => x !== null);
  const receiptToInvoice = invRows
    .map((i) => {
      const g = grnRows.find((x) => x.po_id === i.po_id);
      return g ? days(g.delivered_on, i.received_on) : null;
    })
    .filter((x): x is number => x !== null);

  const rfqRows = rfqs.data ?? [];
  const pipeline = [
    { label: "Requisitions awaiting approval", value: counts.approvals, href: "/approvals" },
    { label: "RFQs open", value: rfqRows.filter((r) => r.status === "open").length, href: "/rfqs" },
    { label: "Bids under evaluation", value: rfqRows.filter((r) => r.status === "evaluation").length, href: "/rfqs" },
    { label: "Awards recommended", value: rfqRows.filter((r) => r.status === "awarded").length, href: "/rfqs" },
    { label: "POs issued, not yet received", value: poRows.filter((p) => p.status === "issued").length, href: "/purchase-orders" },
    { label: "Invoices awaiting match", value: invRows.filter((i) => ["registered", "exception"].includes(i.status)).length, href: "/invoices" },
  ];
  const attention = [
    { label: "Approvals overdue more than 3 days", count: overdueApprovals, href: "/approvals" },
    { label: "Vendor documents expiring within 30 days", count: counts.expiringDocs, href: "/vendors" },
    { label: "Deliveries past expected date", count: overdueDeliveries, href: "/purchase-orders" },
    { label: "Invoice variances above tolerance", count: counts.exceptions, href: "/invoices" },
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
              <Link className="btn btn-primary" href="/requisitions/new">New requisition</Link>
            </>
          }
        />
        <div className="grid g-4">
          <Kpi label="Open requisitions" value={openReqs} sub={`${counts.approvals} awaiting approval`} />
          <Kpi label="Open purchase orders" value={openPos.length} sub={`USD ${formatMoney(openPoValue)} committed`} />
          <Kpi label="Pending inspections" value={counts.grns} sub={`${overdueDeliveries} overdue`} />
          <Kpi label="Invoice exceptions" value={counts.exceptions} sub={`USD ${formatMoney(exceptionValue)} on hold`} />
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
              <Stat value={avg(reqToApproval)} label="Requisition to approval" />
              <Stat value={avg(poToDelivery)} label="PO to delivery" />
              <Stat value={avg(receiptToInvoice)} label="Receipt to invoice" />
            </div>
            <p className="help">
              Based on {plural(reqToApproval.length, "approved requisition")} and {plural(grnRows.length, "accepted receipt")}.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
