import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Goods received notes" };

export default async function GoodsReceipts() {
  const { supabase, orgId } = await getContext();
  const { data: grns } = await supabase
    .from("goods_receipts")
    .select("id, number, status, delivered_on, location, purchase_orders(id, number, vendors(trading_name)), grn_lines(inspection)")
    .eq("org_id", orgId)
    .order("number", { ascending: false })
    .limit(500);

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing" }, { label: "Goods received notes" }]} />
      <div className="content">
        <PageHead title="Goods received notes" sub="Inspect deliveries against purchase orders and record discrepancies." />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>GRN</th><th>Purchase order</th><th>Vendor</th><th>Delivered</th><th>Location</th><th>Inspection</th><th>Status</th></tr></thead>
              <tbody>
                {(grns ?? []).map((g) => {
                  const issues = g.grn_lines.filter((l) => l.inspection !== "Passed").length;
                  return (
                    <tr key={g.id}>
                      <td><Link className="rowlink" href={`/goods-receipts/${g.id}`}>{g.number}</Link></td>
                      <td>{g.purchase_orders?.number}</td>
                      <td>{g.purchase_orders?.vendors?.trading_name}</td>
                      <td>{formatDate(g.delivered_on)}</td>
                      <td>{g.location}</td>
                      <td>{issues ? <StatusBadge status="short delivery" label={`${issues} discrepancies`} /> : <StatusBadge status="passed" label="Passed" />}</td>
                      <td><StatusBadge status={g.status === "draft" ? "pending" : g.status} label={g.status === "draft" ? "Draft" : "Accepted"} /></td>
                    </tr>
                  );
                })}
                {!grns?.length && <tr><td colSpan={7} className="empty">No goods receipts yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
