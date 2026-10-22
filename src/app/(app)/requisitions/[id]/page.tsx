import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, Field, PageHead, StatusBadge, Topbar, Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { createDirectPo, createRfq, decideRequisition, submitRequisition } from "../../actions";
import { Attachments } from "@/components/attachments";
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

  const [{ data: files }, { data: rfqs }, { data: pos }, { data: org }, { data: vendors }] = await Promise.all([
    supabase.from("attachments").select("id").eq("record_type", "requisition").eq("record_id", id),
    supabase.from("rfqs").select("id, number, status").eq("requisition_id", id),
    supabase.from("purchase_orders").select("id, number, status").eq("requisition_id", id),
    supabase.from("orgs").select("direct_po_limit_minor").eq("id", r.org_id).single(),
    supabase.from("vendors").select("id, trading_name").eq("org_id", r.org_id).eq("status", "approved").order("trading_name"),
  ]);

  const lines = [...r.requisition_lines].sort((a, b) => a.line_no - b.line_no);
  // Levels >= 1000 are archived rounds from before a return and resubmission.
  const steps = r.approval_steps.filter((s) => s.level < 1000).sort((a, b) => a.level - b.level);
  const priorRounds = r.approval_steps.filter((s) => s.level >= 1000 && s.acted_at).sort((a, b) => a.acted_at.localeCompare(b.acted_at));
  const sourced = rfqs?.some((q) => q.status !== "cancelled") || pos?.some((p) => p.status !== "cancelled");
  const canSource = r.status === "approved" && !sourced && can("buyer");
  const directAllowed = Number(r.total_minor) <= Number(org?.direct_po_limit_minor ?? 0);
  const pending = steps.find((s) => s.status === "pending");
  const isMine = r.requester_id === user.id;
  const canDecide = r.status === "submitted" && !!pending && can(pending.required_role) && !isMine;
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

            {canSource && (
              <Card title="Source this requisition">
                <div className="grid g-2" style={{ gap: 18 }}>
                  <ActionForm action={createRfq}>
                    <input type="hidden" name="requisition_id" value={r.id} />
                    <h3 style={{ fontSize: 16, marginBottom: 8 }}>Request for quotation</h3>
                    <label className="lbl" htmlFor="closes_at">Bids close</label>
                    <input className="input" id="closes_at" name="closes_at" type="datetime-local" required />
                    <label className="lbl" htmlFor="location" style={{ marginTop: 10 }}>Delivery location</label>
                    <input className="input" id="location" name="location" placeholder="Central warehouse" />
                    <label className="lbl" htmlFor="terms" style={{ marginTop: 10 }}>Specifications and terms</label>
                    <textarea className="input" id="terms" name="terms" placeholder="Quote unit prices inclusive of delivery…" />
                    <div style={{ marginTop: 12 }}><Submit primary>Create RFQ</Submit></div>
                  </ActionForm>
                  <ActionForm action={createDirectPo}>
                    <input type="hidden" name="requisition_id" value={r.id} />
                    <h3 style={{ fontSize: 16, marginBottom: 8 }}>Direct purchase</h3>
                    {directAllowed ? (
                      <>
                        <label className="lbl" htmlFor="vendor_id">Vendor</label>
                        <select className="input" id="vendor_id" name="vendor_id" required defaultValue="">
                          <option value="" disabled>Select an approved vendor…</option>
                          {vendors?.map((v) => <option key={v.id} value={v.id}>{v.trading_name}</option>)}
                        </select>
                        <div style={{ marginTop: 12 }}><Submit>Draft purchase order</Submit></div>
                      </>
                    ) : (
                      <p className="help" style={{ marginTop: 0 }}>
                        Above the USD {formatMoney(org?.direct_po_limit_minor)} direct purchase limit, so competitive quotations are required.
                      </p>
                    )}
                  </ActionForm>
                </div>
              </Card>
            )}

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
                      : `This level needs the ${pending?.required_role} role.`}
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
            <Attachments recordType="requisition" recordId={r.id} canUpload={!["rejected", "cancelled"].includes(r.status)} />
            {(!!rfqs?.length || !!pos?.length) && (
              <Card title="Sourcing">
                <div className="rows">
                  {rfqs?.map((q) => (
                    <Link key={q.id} href={`/rfqs/${q.id}`}><span>{q.number}</span><Badge>{humanize(q.status)}</Badge></Link>
                  ))}
                  {pos?.map((p) => (
                    <Link key={p.id} href={`/purchase-orders/${p.id}`}><span>{p.number}</span><Badge>{humanize(p.status)}</Badge></Link>
                  ))}
                </div>
              </Card>
            )}
            {priorRounds.length > 0 && (
              <Card title="Earlier approval rounds">
                <div className="rows">
                  {priorRounds.map((s) => (
                    <div key={s.id}>
                      <span>{s.label}: {s.status}{s.comment ? `. ${s.comment}` : ""}</span>
                      <span className="card-note">{s.acted_by_label}, {ago(s.acted_at)}</span>
                    </div>
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
