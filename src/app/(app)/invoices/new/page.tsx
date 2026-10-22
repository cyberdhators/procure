import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, PageHead, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { registerInvoice } from "../../actions";
import { formatQty } from "@/lib/money";

export const metadata = { title: "Register invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { po: poId } = await searchParams;
  const { supabase, orgId, can } = await getContext();

  if (!poId) {
    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("id, number, title, vendors(trading_name)")
      .eq("org_id", orgId)
      .in("status", ["issued", "partially_received", "received", "invoiced"])
      .order("number", { ascending: false })
      .limit(200);
    return (
      <>
        <Topbar crumbs={[{ label: "Purchasing" }, { label: "Invoices", href: "/invoices" }, { label: "Register" }]} />
        <div className="content">
          <PageHead title="Register invoice" sub="Choose the purchase order the supplier is invoicing." />
          <Card className="flush">
            <div className="rows">
              {(pos ?? []).map((p) => (
                <Link key={p.id} href={`/invoices/new?po=${p.id}`}><span><strong>{p.number}</strong> {p.vendors?.trading_name}, {p.title}</span><span className="link">Select</span></Link>
              ))}
              {!pos?.length && <div className="empty">No issued purchase orders.</div>}
            </div>
          </Card>
        </div>
      </>
    );
  }

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, number, title, status, currency, vendors(trading_name), po_lines(*)")
    .eq("id", poId)
    .maybeSingle();
  if (!po) notFound();
  const lines = [...po.po_lines].sort((a, b) => a.line_no - b.line_no);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing" }, { label: "Invoices", href: "/invoices" }, { label: `Register against ${po.number}` }]} />
      <div className="content">
        <PageHead title="Register invoice" sub={`Supplier invoice from ${po.vendors?.trading_name} against ${po.number}, ${po.title}.`} />
        {!can("finance") ? (
          <Card><p style={{ margin: 0 }}>You need the finance role to register invoices.</p></Card>
        ) : (
          <ActionForm action={registerInvoice} className="stack">
            <input type="hidden" name="po_id" value={po.id} />
            <Card title="Invoice">
              <div className="form-grid">
                <div><label className="lbl" htmlFor="vendor_ref">Supplier invoice number</label><input className="input" id="vendor_ref" name="vendor_ref" required /></div>
                <div><label className="lbl" htmlFor="invoice_date">Invoice date</label><input className="input" id="invoice_date" name="invoice_date" type="date" max={today} defaultValue={today} required /></div>
              </div>
            </Card>
            <Card title="Invoiced lines" note="Enter what the supplier billed, not what was ordered. Leave a line at 0 if it is not on this invoice.">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Line</th><th className="num">Ordered</th><th className="num" style={{ width: 130 }}>Invoiced qty</th><th className="num" style={{ width: 150 }}>Invoiced unit price</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}<input type="hidden" name="po_line_id" value={l.id} /></td>
                        <td className="num">{formatQty(l.qty)}</td>
                        <td><input className="input num-in" name={`qty_${l.id}`} type="number" min={0} step="any" defaultValue={Number(l.qty)} aria-label={`Invoiced quantity, ${l.description}`} /></td>
                        <td><input className="input num-in" name={`price_${l.id}`} inputMode="decimal" defaultValue={(Number(l.unit_price_minor) / 100).toFixed(2)} aria-label={`Invoiced unit price, ${l.description}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">The invoice is matched against the order and accepted goods receipts as soon as it is registered.</p>
              <div style={{ marginTop: 10 }}><Submit primary>Register and match</Submit></div>
            </Card>
          </ActionForm>
        )}
      </div>
    </>
  );
}
