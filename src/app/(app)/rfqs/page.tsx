import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatStamp, humanize } from "@/lib/format";

export const metadata = { title: "Requests for quotation" };

export default async function Rfqs() {
  const { supabase, orgId } = await getContext();
  const { data: rfqs } = await supabase
    .from("rfqs")
    .select("id, number, title, status, closes_at, requisitions(number), rfq_invites(status)")
    .eq("org_id", orgId)
    .order("number", { ascending: false });

  return (
    <>
      <Topbar crumbs={[{ label: "Sourcing" }, { label: "Requests for quotation" }]} />
      <div className="content">
        <PageHead title="Requests for quotation" sub="Sourcing events created from approved requisitions." />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>RFQ</th><th>Title</th><th>Requisition</th><th>Closes</th><th>Bids</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(rfqs ?? []).map((q) => (
                  <tr key={q.id}>
                    <td><Link className="rowlink" href={`/rfqs/${q.id}`}>{q.number}</Link></td>
                    <td>{q.title}</td>
                    <td>{q.requisitions?.number ?? "—"}</td>
                    <td>{q.closes_at ? formatStamp(q.closes_at) : "—"}</td>
                    <td>{q.rfq_invites.filter((i) => i.status === "Bid received").length} of {q.rfq_invites.length}</td>
                    <td><StatusBadge status={q.status === "evaluation" ? "pending" : q.status} label={humanize(q.status)} /></td>
                    <td className="num"><Link className="link" href={`/rfqs/${q.id}/bids`}>Bid comparison</Link></td>
                  </tr>
                ))}
                {!rfqs?.length && <tr><td colSpan={7} className="empty">No sourcing events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
