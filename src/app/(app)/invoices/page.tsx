import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatMoney, lineTotal } from "@/lib/money";
import { formatDate, humanize } from "@/lib/format";

export const metadata = { title: "Invoice matching" };

export default async function Invoices() {
  const { supabase, orgId } = await getContext();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, number, vendor_ref, status, received_on, purchase_orders(number, vendors(trading_name)), invoice_lines(qty, unit_price_minor)")
    .eq("org_id", orgId)
    .order("received_on", { ascending: false });

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing" }, { label: "Invoice matching" }]} />
      <div className="content">
        <PageHead title="Invoice matching" sub="Supplier invoices are matched against the purchase order and accepted goods receipts." />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Vendor ref.</th><th>Vendor</th><th>Purchase order</th><th>Received</th><th className="num">Value, USD</th><th>Status</th></tr></thead>
              <tbody>
                {(invoices ?? []).map((i) => (
                  <tr key={i.id}>
                    <td><Link className="rowlink" href={`/invoices/${i.id}`}>{i.number}</Link></td>
                    <td>{i.vendor_ref}</td>
                    <td>{i.purchase_orders?.vendors?.trading_name}</td>
                    <td>{i.purchase_orders?.number}</td>
                    <td>{formatDate(i.received_on)}</td>
                    <td className="num">{formatMoney(i.invoice_lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_price_minor), 0))}</td>
                    <td><StatusBadge status={i.status} label={humanize(i.status)} /></td>
                  </tr>
                ))}
                {!invoices?.length && <tr><td colSpan={7} className="empty">No invoices registered.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
