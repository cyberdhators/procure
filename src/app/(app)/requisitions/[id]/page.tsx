import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, Field, PageHead, StatusBadge, Topbar, Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { decideRequisition, submitRequisition } from "../../actions";
import { formatMoney, formatQty, lineTotal } from "@/lib/money";
import { ago, formatDate, humanize } from "@/lib/format";

export default async function RequisitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, can } = await getContext();
  const { data: r } = await supabase
    .from("requisitions")
    .select(`*, departments(name), projects(name), donors(name),
             budget_lines(code, amount_minor, committed_minor),
             requisition_lines(*), approval_steps(*)`)
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const [{ data: files }, { data: rfqs }] = await Promise.all([
    supabase.from("attachments").select("id, name, size_bytes").eq("record_type", "requisition").eq("record_id", id),
    supabase.from("rfqs").select("id, number, status").eq("requisition_id", id),
  ]);

  const lines = [...r.requisition_lines].sort((a, b) => a.line_no - b.line_no);
  const steps = [...r.approval_steps].sort((a, b) => a.level - b.level);
  const pending = steps.find((s) => s.status === "pending");
  const isMine = r.requester_id === user.id;
  const canDecide = r.status === "submitted" && can("approver") && !isMine;
  const budget = r.budget_lines;
  const remaining = budget ? Number(budget.amount_minor) - Number(budget.committed_minor) : null;

  const statusLabel =
    r.status === "submitted" && pending ? `Awaiting level ${pending.level} of ${steps.length}` : humanize(r.status);

  return (
    <>
      <Topbar crumbs={[
        { label: "Requisitions", href: "/requisitions" },
        { label: "Approval queue", href: "/approvals" },
        { label: r.number },
      ]} />
      <div className="content">
        <PageHead
          title={r.number}
          badge={<StatusBadge status={r.status === "submitted" ? "pending" : r.status} label={statusLabel} />}
          sub={`${r.title}. ${r.submitted_at ? `Submitted by ${r.requester_label}, ${ago(r.submitted_at)}.` : `Draft by ${r.requester_label}.`}`}
          actions={
            isMine && ["draft", "returned"].includes(r.status) ? (
              <ActionForm action={submitRequisition}>
                <input type="hidden" name="id" value={r.id} />
                <Submit primary>{r.status === "returned" ? "Resubmit for approval" : "Submit for approval"}</Submit>
              </ActionForm>
            ) : null
          }
        />
        <div className="grid g-main">
          <div className="stack">
            <Card title="Summary">
              <div className="fields" style={{ "--cols": 4 } as React.CSSProperties}>
                <Field label="Department">{r.departments?.name ?? "—"}</Field>
                <Field label="Project">{r.projects?.name ?? "Core"}</Field>
                <Field label="Donor">{r.donors?.name ?? "—"}</Field>
                <Field label="Budget code">{budget?.code ?? "Unassigned"}</Field>
                <Field label="Category">{r.category}</Field>
                <Field label="Required by">{formatDate(r.required_by)}</Field>
                <Field label="Estimated value">USD {formatMoney(r.total_minor)}</Field>
                <Field label="Budget remaining">{remaining === null ? "—" : `USD ${formatMoney(remaining)}`}</Field>
              </div>
              {r.justification && (
                <p style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 14, marginBottom: 0 }}>
                  <span className="muted" style={{ color: "var(--muted)" }}>Justification. </span>{r.justification}
                </p>
              )}
            </Card>

            <Card title="Line items">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Description</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit cost</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num">{formatQty(l.qty)}</td>
                        <td>{l.unit}</td>
                        <td className="num">{formatMoney(l.unit_cost_minor)}</td>
                        <td className="num">{formatMoney(lineTotal(l.qty, l.unit_cost_minor))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="total-row">
                      <td colSpan={4} className="num total-label">Total, USD</td>
                      <td className="num total-value">{formatMoney(r.total_minor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {r.status === "submitted" && (
              <Card title="Your decision">
                {canDecide ? (
                  <ActionForm action={decideRequisition}>
                    <input type="hidden" name="id" value={r.id} />
                    <label className="lbl" htmlFor="comment">Comment (visible to requester and later approvers)</label>
                    <textarea className="input" id="comment" name="comment" placeholder="Optional for approval, required for rejection or return" />
                    <div className="actions" style={{ marginTop: 14 }}>
                      <Submit name="decision" value="reject">Reject</Submit>
                      <Submit name="decision" value="return">Return for correction</Submit>
                      <Submit primary name="decision" value="approve">Approve level {pending?.level}</Submit>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="help" style={{ marginTop: 0 }}>
                    {isMine
                      ? "You raised this requisition, so segregation of duties prevents you from approving it."
                      : "You do not have the approver role."}
                  </p>
                )}
              </Card>
            )}
          </div>

          <div className="stack">
            <Card title="Routing trail">
              <div className="trail">
                <div className="trail-item done">
                  <span className="trail-dot" />
                  <div className="trail-head">Submitted<span className="trail-when">{r.submitted_at ? ago(r.submitted_at) : "Not yet"}</span></div>
                  <div className="trail-sub">{r.requester_label}</div>
                  <div className="trail-note">Requisition with {lines.length} line items and {files?.length ?? 0} attachments.</div>
                </div>
                {steps.map((s) => (
                  <div key={s.id} className={`trail-item ${s.status === "approved" ? "done" : ""}`}>
                    <span className="trail-dot" />
                    <div className="trail-head">
                      {s.status === "approved" ? `Level ${s.level} approved`
                        : s.status === "pending" ? `Level ${s.level}, awaiting decision`
                        : s.status === "waiting" ? `Level ${s.level}` : `Level ${s.level} ${s.status}`}
                      <span className="trail-when">
                        {s.acted_at ? ago(s.acted_at) : s.status === "pending" ? `Waiting ${ago(s.activated_at)}` : "Pending"}
                      </span>
                    </div>
                    <div className="trail-sub">{s.label}, {s.approver_title}</div>
                    <div className="trail-note">{s.comment ?? s.note}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Attachments">
              <div className="rows">
                {(files ?? []).map((f) => (
                  <div key={f.id}><span>{f.name}</span><span className="card-note">{Math.round(f.size_bytes / 1024)} KB</span></div>
                ))}
                {!files?.length && <div className="empty">No attachments.</div>}
              </div>
            </Card>
            {!!rfqs?.length && (
              <Card title="Sourcing">
                <div className="rows">
                  {rfqs.map((q) => (
                    <Link key={q.id} href={`/rfqs/${q.id}`}><span>{q.number}</span><Badge>{humanize(q.status)}</Badge></Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
