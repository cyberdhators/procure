import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatMoney, lineTotal } from "@/lib/money";
import { formatDate, humanize } from "@/lib/format";

export const metadata = { title: "Purchase orders" };

export default async function PurchaseOrders() {
  const { supabase, orgId } = await getContext();
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, number, title, status, po_date, expected_delivery, vendors(trading_name), po_lines(qty, unit_price_minor)")
    .eq("org_id", orgId)
    .order("number", { ascending: false })
    .limit(500);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing" }, { label: "Purchase orders" }]} />
      <div className="content">
        <PageHead title="Purchase orders" sub="Issued orders and their delivery status." />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>PO</th><th>Vendor</th><th>Description</th><th>PO date</th><th>Expected delivery</th><th className="num">Value, USD</th><th>Status</th></tr></thead>
              <tbody>
                {(pos ?? []).map((p) => {
                  const late = ["issued", "partially_received"].includes(p.status) && p.expected_delivery && p.expected_delivery < today;
                  return (
                    <tr key={p.id}>
                      <td><Link className="rowlink" href={`/purchase-orders/${p.id}`}>{p.number}</Link></td>
                      <td>{p.vendors?.trading_name}</td>
                      <td>{p.title}</td>
                      <td>{formatDate(p.po_date)}</td>
                      <td>{formatDate(p.expected_delivery)} {late && <StatusBadge status="expired" label="Late" />}</td>
                      <td className="num">{formatMoney(p.po_lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_price_minor), 0))}</td>
                      <td><StatusBadge status={p.status} label={humanize(p.status)} /></td>
                    </tr>
                  );
                })}
                {!pos?.length && <tr><td colSpan={7} className="empty">No purchase orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
