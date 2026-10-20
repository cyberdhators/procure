import type { Db } from "./context";
import { threeWayMatch, type MatchResult } from "./match";

/** Loads an invoice with its PO and accepted receipts and runs the three-way match. */
export async function loadInvoiceMatch(supabase: Db, invoiceId: string) {
  const { data: inv } = await supabase
    .from("invoices")
    .select(`*, purchase_orders(id, number, vendor_id, currency, version, status_dates, po_date,
             vendors(trading_name), po_lines(*)), invoice_lines(*)`)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return null;

  const po = inv.purchase_orders;
  const [{ data: grns }, { count: dupes }] = await Promise.all([
    supabase
      .from("goods_receipts")
      .select("id, number, delivered_on, accepted_at, grn_lines(po_line_id, received_qty)")
      .eq("po_id", po.id)
      .eq("status", "accepted")
      .order("delivered_on"),
    supabase
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("po_id", po.id)
      .eq("vendor_ref", inv.vendor_ref)
      .neq("id", inv.id),
  ]);

  const receivedFor = (lineId: string) =>
    (grns ?? []).flatMap((g) => g.grn_lines).filter((l) => l.po_line_id === lineId).reduce((a, l) => a + Number(l.received_qty), 0);
  const poLines = [...po.po_lines].sort((a, b) => a.line_no - b.line_no);

  const match: MatchResult = threeWayMatch({
    priceTolerancePct: 0,
    vendorMatches: true, // invoices are registered against the PO's vendor
    currencyMatches: true,
    duplicateInvoice: (dupes ?? 0) > 0,
    invoiceDate: inv.invoice_date,
    lastDeliveryDate: grns?.at(-1)?.delivered_on ?? null,
    lines: poLines
      .map((pl) => {
        const il = inv.invoice_lines.find((x: { po_line_id: string }) => x.po_line_id === pl.id);
        return il && {
          poLineId: pl.id,
          name: pl.short_name,
          poQty: Number(pl.qty),
          poPriceMinor: Number(pl.unit_price_minor),
          receivedQty: receivedFor(pl.id),
          invoicedQty: Number(il.qty),
          invoicePriceMinor: Number(il.unit_price_minor),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
  });

  return { inv, po, grns: grns ?? [], match };
}
