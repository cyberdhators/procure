import Link from "next/link";
import { getContext } from "@/lib/context";
import { Badge, Card, PageHead, Topbar } from "@/components/ui";
import { formatStamp } from "@/lib/format";

export const metadata = { title: "Audit log" };

const PAGE = 25;
const HREF: Record<string, string> = {
  requisition: "/requisitions", purchase_order: "/purchase-orders", goods_receipt: "/goods-receipts",
  invoice: "/invoices", vendor: "/vendors", rfq: "/rfqs",
};

export default async function AuditLog({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const { supabase, orgId } = await getContext();

  let query = supabase
    .from("audit_events")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("at", { ascending: false })
    .range((p - 1) * PAGE, p * PAGE - 1);
  const term = q.replace(/[%,()]/g, " ").trim();
  if (term) {
    query = query.or(`record_label.ilike.%${term}%,actor_label.ilike.%${term}%,action.ilike.%${term}%,detail.ilike.%${term}%`);
  }
  const { data: events, count } = await query;
  const total = count ?? 0;
  const link = (n: number) => `/audit?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <>
      <Topbar crumbs={[{ label: "Governance" }, { label: "Audit log" }]} />
      <div className="content">
        <PageHead
          title="Audit log"
          sub="Append-only record of every significant action. Entries cannot be edited or deleted."
          actions={
            <form className="actions">
              <input className="input" name="q" defaultValue={q} placeholder="Filter by record, user or action" aria-label="Filter" style={{ width: 260 }} />
              <button className="btn" type="submit">Filter</button>
            </form>
          }
        />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Timestamp (UTC)</th><th>User</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead>
              <tbody>
                {(events ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatStamp(e.at)}</td>
                    <td>{e.actor_label}</td>
                    <td><Badge>{e.action}</Badge></td>
                    <td>
                      {e.record_id && HREF[e.record_type]
                        ? <Link className="link" href={`${HREF[e.record_type]}/${e.record_id}`}>{e.record_label}</Link>
                        : e.record_label}
                    </td>
                    <td>{e.detail}</td>
                  </tr>
                ))}
                {!events?.length && <tr><td colSpan={5} className="empty">No entries match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="actions" style={{ justifyContent: "space-between", padding: "12px 0 4px" }}>
            <span className="card-note">Showing {events?.length ?? 0} of {total.toLocaleString("en-US")} entries</span>
            <span className="actions">
              {p > 1 && <Link className="btn btn-sm" href={link(p - 1)}>Previous</Link>}
              {p * PAGE < total && <Link className="btn btn-sm" href={link(p + 1)}>Next</Link>}
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
