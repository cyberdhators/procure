import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { loadInvoiceMatch } from "@/lib/invoice-match";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { resolveInvoice } from "../../actions";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, humanize, plural } from "@/lib/format";

export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const loaded = await loadInvoiceMatch(supabase, id);
  if (!loaded) notFound();
  const { inv, po, grns, match } = loaded;

  const open = ["registered", "exception", "matched"].includes(inv.status);
  const canResolve = open && can("finance");
  const lastGrn = grns.at(-1);
  const exceptionLines = match.lines.filter((l) => l.result !== "Matched").length;

  return (
    <>
      <Topbar crumbs={[{ label: "Purchasing", href: "/purchase-orders" }, { label: "Invoices", href: "/invoices" }, { label: inv.number }]} />
      <div className="content">
        <ActionForm action={resolveInvoice} className="stack">
          <input type="hidden" name="id" value={inv.id} />
          <PageHead
            title={inv.number}
            badge={<StatusBadge status={inv.status} label={humanize(inv.status)} />}
            sub={`${po.vendors?.trading_name} invoice ${inv.vendor_ref}, USD ${formatMoney(match.invoiceValueMinor)}, received ${formatDate(inv.received_on)}. Matched against ${po.number}${lastGrn ? ` and ${grns.map((g) => g.number).join(", ")}` : ""}.`}
            actions={canResolve && (
              <>
                <Submit name="resolution" value="return_to_vendor">Return to vendor</Submit>
                <Submit primary name="resolution" value="approve" disabled={match.status !== "matched"}>Send to finance approval</Submit>
              </>
            )}
          />
          <div className="grid g-3">
            <Card>
              <div className="kpi-label">Purchase order</div>
              <h2 style={{ fontSize: 22, marginTop: 6 }}><Link href={`/purchase-orders/${po.id}`}>{po.number}</Link></h2>
              <div className="card-note">Approved {formatDate(po.po_date)}, v{po.version}</div>
              <div className="kpi-value" style={{ fontSize: 30, marginTop: 16 }}>{formatMoney(match.poValueMinor)}</div>
            </Card>
            <Card>
              <div className="kpi-label">Goods received</div>
              <h2 style={{ fontSize: 22, marginTop: 6 }}>
                {lastGrn ? <Link href={`/goods-receipts/${lastGrn.id}`}>{grns.map((g) => g.number).join(", ")}</Link> : "None"}
              </h2>
              <div className="card-note">
                {lastGrn ? `Accepted ${formatDate(lastGrn.delivered_on)}${match.receivedValueMinor < match.poValueMinor ? ", partial" : ""}` : "No accepted receipt"}
              </div>
              <div className="kpi-value" style={{ fontSize: 30, marginTop: 16 }}>{formatMoney(match.receivedValueMinor)}</div>
            </Card>
            <Card>
              <div className="kpi-label">Supplier invoice</div>
              <h2 style={{ fontSize: 22, marginTop: 6 }}>{inv.vendor_ref}</h2>
              <div className="card-note">Received {formatDate(inv.received_on)}</div>
              <div className="kpi-value" style={{ fontSize: 30, marginTop: 16 }}>{formatMoney(match.invoiceValueMinor)}</div>
            </Card>
          </div>
          <Card className="flush">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Line</th><th className="num">PO qty</th><th className="num">Received</th><th className="num">Invoiced</th><th className="num">PO price</th><th className="num">Invoice price</th><th>Result</th></tr></thead>
                <tbody>
                  {match.lines.map((l) => (
                    <tr key={l.poLineId} className={l.result === "Missing receipt" ? "hl" : ""}>
                      <td>{l.name}</td>
                      <td className="num">{formatQty(l.poQty)}</td>
                      <td className="num">{formatQty(l.receivedQty)}</td>
                      <td className="num">{formatQty(l.invoicedQty)}</td>
                      <td className="num">{formatMoney(l.poPriceMinor)}</td>
                      <td className="num">{formatMoney(l.invoicePriceMinor)}</td>
                      <td><StatusBadge status={l.result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid g-2">
            <Card title="Matching rules">
              <div className="rows">
                {match.rules.map((r) => (
                  <div key={r.name}><span>{r.name}</span><StatusBadge status={r.passed ? "passed" : "rejected"} label={r.detail} /></div>
                ))}
              </div>
            </Card>
            <Card title={match.status === "matched" ? "Ready for approval" : "Resolve exception"}>
              {inv.resolution && (
                <div className="notice" style={{ marginBottom: 12 }}>
                  Last action: {humanize(inv.resolution)}. {inv.resolution_reason}
                </div>
              )}
              {match.status === "exception" ? (
                <p className="card-note" style={{ marginTop: 0 }}>
                  {plural(exceptionLines, "line")} {exceptionLines === 1 ? "is" : "are"} invoiced above the quantity received.
                  The invoice cannot proceed until the exception is resolved or a partial payment is authorised.
                </p>
              ) : (
                <p className="card-note" style={{ marginTop: 0 }}>All matching rules passed.</p>
              )}
              {canResolve ? (
                <>
                  {match.status === "exception" && (
                    <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
                      <label className="check"><input type="radio" name="resolution" value="credit_note" /> Request credit note for undelivered quantities</label>
                      <label className="check"><input type="radio" name="resolution" value="partial_payment" /> Approve partial payment of USD {formatMoney(match.payableNowMinor)} for received goods</label>
                      <label className="check"><input type="radio" name="resolution" value="hold" /> Hold until GRN for outstanding items is recorded</label>
                    </div>
                  )}
                  <label className="lbl" htmlFor="reason">Reason (recorded in audit trail)</label>
                  <textarea className="input" id="reason" name="reason" />
                  {match.status === "exception" && <div style={{ marginTop: 12 }}><Submit primary>Record resolution</Submit></div>}
                </>
              ) : !open ? (
                <p className="help">This invoice is {humanize(inv.status).toLowerCase()}.</p>
              ) : (
                <p className="help">You need the finance role to resolve invoice exceptions.</p>
              )}
            </Card>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
