import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, Stat, Topbar, Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { decideRequisition } from "../actions";
import { formatMoney } from "@/lib/money";
import { daysSince, plural } from "@/lib/format";

export const metadata = { title: "Approval queue" };

export default async function ApprovalQueue() {
  const { supabase, orgId, user, can } = await getContext();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: rows }, { data: monthSteps }] = await Promise.all([
    supabase
      .from("requisitions")
      .select("id, number, title, total_minor, requester_id, departments(name), donors(name), approval_steps(level, status, activated_at)")
      .eq("org_id", orgId)
      .eq("status", "submitted"),
    supabase.from("approval_steps").select("status").eq("org_id", orgId).gte("acted_at", monthStart.toISOString()),
  ]);

  const queue = (rows ?? [])
    .map((r) => {
      const pending = r.approval_steps.find((s) => s.status === "pending");
      return { ...r, pending, levels: r.approval_steps.length, waiting: daysSince(pending?.activated_at) };
    })
    .sort((a, b) => b.waiting - a.waiting);
  const overdue = queue.filter((q) => q.waiting > 3).length;
  const returned = (monthSteps ?? []).filter((s) => s.status === "returned").length;
  const approved = (monthSteps ?? []).filter((s) => s.status === "approved").length;

  return (
    <>
      <Topbar crumbs={[{ label: "Requisitions", href: "/requisitions" }, { label: "Approval queue" }]} />
      <div className="content">
        <PageHead title="Approval queue" sub={`${plural(queue.length, "requisition")} awaiting a decision. Oldest first.`} />
        <div className="grid g-4">
          <Stat value={queue.length} label="Awaiting decision" />
          <Stat value={overdue} label="Overdue, more than 3 days" />
          <Stat value={returned} label="Returned this month" />
          <Stat value={approved} label="Approval steps signed this month" />
        </div>
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requisition</th><th>Title</th><th>Department</th><th>Donor</th>
                  <th className="num">Value, USD</th><th>Waiting</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id}>
                    <td><Link className="rowlink" href={`/requisitions/${q.id}`}>{q.number}</Link></td>
                    <td>{q.title}</td>
                    <td>{q.departments?.name}</td>
                    <td>{q.donors?.name}</td>
                    <td className="num">{formatMoney(q.total_minor)}</td>
                    <td>{plural(q.waiting, "day")}</td>
                    <td><Badge>Level {q.pending?.level} of {q.levels}</Badge></td>
                    <td className="num">
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <Link className="btn btn-sm" href={`/requisitions/${q.id}`}>Review</Link>
                        {can("approver") && q.requester_id !== user.id && (
                          <ActionForm action={decideRequisition}>
                            <input type="hidden" name="id" value={q.id} />
                            <Submit small primary name="decision" value="approve">Approve</Submit>
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr><td colSpan={8} className="empty">Nothing is waiting for approval.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
