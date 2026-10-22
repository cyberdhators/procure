import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { saveGoodsReceipt } from "../../actions";
import { Attachments } from "@/components/attachments";
import { formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";

const CHECKLIST = [
  "Correct items delivered", "Correct quantities delivered", "Items meet specifications",
  "Goods undamaged", "Batch or serial numbers recorded", "Delivery documents provided",
];
const INSPECTION = ["Passed", "Short delivery", "Not delivered", "Rejected"];
const DISCREPANCY_TYPES = ["Short delivery", "Over delivery", "Damaged goods", "Wrong item", "Not to specification"];

export default async function GoodsReceipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const { data: g } = await supabase
    .from("goods_receipts")
    .select("*, purchase_orders(id, number, vendors(trading_name), po_lines(*)), grn_lines(*)")
    .eq("id", id)
    .maybeSingle();
  if (!g) notFound();

  const po = g.purchase_orders!;
  const { data: others } = await supabase
    .from("goods_receipts")
    .select("id, grn_lines(po_line_id, received_qty)")
    .eq("po_id", po.id)
    .eq("status", "accepted")
    .neq("id", id);
  const prior = (lineId: string) =>
    (others ?? []).flatMap((o) => o.grn_lines).filter((l) => l.po_line_id === lineId).reduce((a, l) => a + Number(l.received_qty), 0);

  const poLines = [...po.po_lines].sort((a, b) => a.line_no - b.line_no);
  const lineFor = (poLineId: string) => g.grn_lines.find((l) => l.po_line_id === poLineId);
  const editable = g.status === "draft" && can("receiver");
  const checklist = g.checklist as Record<string, boolean>;

  return (
    <>
      <Topbar crumbs={[
        { label: "Purchasing", href: "/goods-receipts" },
        { label: po.number, href: `/purchase-orders/${po.id}` },
        { label: g.number },
      ]} />
      <div className="content">
        <ActionForm action={saveGoodsReceipt} className="stack">
          <input type="hidden" name="id" value={g.id} />
          <PageHead
            title={g.number}
            badge={<StatusBadge status={g.status === "draft" ? "pending" : "accepted"} label={g.status === "draft" ? "Draft" : "Accepted"} />}
            sub={<>Goods received against <Link className="link" href={`/purchase-orders/${po.id}`}>{po.number}</Link>, {po.vendors?.trading_name}. Delivered {formatDate(g.delivered_on)} to {g.location.toLowerCase()}.</>}
            actions={editable && (
              <>
                <Submit name="intent" value="draft">Save draft</Submit>
                <Submit primary name="intent" value="accept">Accept and sign</Submit>
              </>
            )}
          />
          <div className="grid g-main">
            <div className="stack">
              <Card title="Received quantities">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Outstanding</th><th className="num">Received now</th><th>Inspection</th></tr></thead>
                    <tbody>
                      {poLines.map((l) => {
                        const gl = lineFor(l.id);
                        if (!gl) return null;
                        const outstanding = Number(l.qty) - prior(l.id);
                        return (
                          <tr key={l.id}>
                            <td>{l.description}<input type="hidden" name="po_line_id" value={l.id} /></td>
                            <td className="num">{formatQty(l.qty)}</td>
                            <td className="num">{formatQty(outstanding)}</td>
                            <td className="num" style={{ width: 120 }}>
                              {editable ? (
                                <input className="input num-in" name={`qty_${l.id}`} type="number" min={0} max={outstanding} step="any"
                                  defaultValue={Number(gl.received_qty)} aria-label={`Received quantity, ${l.description}`} />
                              ) : formatQty(gl.received_qty)}
                            </td>
                            <td style={{ width: 170 }}>
                              {editable ? (
                                <select className="input" name={`insp_${l.id}`} defaultValue={gl.inspection} aria-label={`Inspection, ${l.description}`}>
                                  {INSPECTION.map((i) => <option key={i}>{i}</option>)}
                                </select>
                              ) : <StatusBadge status={gl.inspection} />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Discrepancy">
                <div className="form-grid">
                  <div>
                    <label className="lbl" htmlFor="disc_item">Item</label>
                    <select className="input" id="disc_item" name="disc_item" defaultValue={g.discrepancy_item ?? ""} disabled={!editable}>
                      <option value="">None</option>
                      {poLines.map((l) => <option key={l.id}>{l.description}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="lbl" htmlFor="disc_type">Type</label>
                    <select className="input" id="disc_type" name="disc_type" defaultValue={g.discrepancy_type ?? ""} disabled={!editable}>
                      <option value="">None</option>
                      {DISCREPANCY_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="full">
                    <label className="lbl" htmlFor="disc_note">Description</label>
                    <textarea className="input" id="disc_note" name="disc_note" defaultValue={g.discrepancy_note ?? ""} readOnly={!editable} />
                  </div>
                </div>
                <p className="help">Discrepancies are linked to the PO and the vendor record and count towards the vendor performance score.</p>
              </Card>
            </div>
            <div className="stack">
              <Card title="Inspection checklist">
                <div className="rows">
                  {CHECKLIST.map((c) => (
                    <label key={c} className="check">
                      <input type="hidden" name="check_item" value={c} />
                      <input type="checkbox" name={`check_${c}`} defaultChecked={!!checklist[c]} disabled={!editable} /> {c}
                    </label>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </ActionForm>
        <Attachments recordType="goods_receipt" recordId={g.id} title="Evidence: photos and delivery notes" />
      </div>
    </>
  );
}
