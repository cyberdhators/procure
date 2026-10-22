import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Requisitions" };

export default async function Requisitions() {
  const { supabase, orgId } = await getContext();
  const { data: rows } = await supabase
    .from("requisitions")
    .select("id, number, title, status, total_minor, requester_label, created_at, departments(name), donors(name)")
    .eq("org_id", orgId)
    .order("number", { ascending: false })
    .limit(500);

  return (
    <>
      <Topbar crumbs={[{ label: "Requisitions" }, { label: "All requisitions" }]} />
      <div className="content">
        <PageHead
          title="Requisitions"
          sub="Every requisition in your organisation, newest first."
          actions={<Link className="btn btn-primary" href="/requisitions/new">New requisition</Link>}
        />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Requisition</th><th>Title</th><th>Department</th><th>Donor</th><th>Requester</th><th>Created</th><th className="num">Value, USD</th><th>Status</th></tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <td><Link className="rowlink" href={`/requisitions/${r.id}`}>{r.number}</Link></td>
                    <td>{r.title}</td>
                    <td>{r.departments?.name ?? "—"}</td>
                    <td>{r.donors?.name ?? "—"}</td>
                    <td>{r.requester_label}</td>
                    <td>{formatDate(r.created_at)}</td>
                    <td className="num">{formatMoney(r.total_minor)}</td>
                    <td><StatusBadge status={r.status === "submitted" ? "pending" : r.status} label={r.status === "submitted" ? "In approval" : undefined} /></td>
                  </tr>
                ))}
                {!rows?.length && <tr><td colSpan={8} className="empty">No requisitions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
