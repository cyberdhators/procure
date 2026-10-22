import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, Field, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { Attachments } from "@/components/attachments";
import { answerClarification, closeRfq, inviteVendor, openRfq, recordBid } from "../../actions";
import { ago, daysUntil, formatDate, formatStamp, humanize } from "@/lib/format";
import { weightsTotal } from "@/lib/scoring";

const STEPS = ["Draft", "Invite", "Receive bids", "Evaluate", "Award"];
const STEP_INDEX: Record<string, number> = { draft: 1, open: 2, evaluation: 3, awarded: 4, cancelled: 0 };

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const { data: q } = await supabase
    .from("rfqs")
    .select(`*, requisitions(id, number), rfq_criteria(*), rfq_invites(*, vendors(trading_name)),
             clarifications(*, vendors(trading_name)), bids(vendor_id), orgs(min_rfq_vendors)`)
    .eq("id", id)
    .maybeSingle();
  if (!q) notFound();

  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, trading_name, vendor_documents(expires_on)")
    .eq("org_id", q.org_id)
    .eq("status", "approved")
    .order("trading_name");

  const criteria = [...q.rfq_criteria].sort((a, b) => a.position - b.position);
  const scored = criteria.filter((c) => !c.is_price);
  const clarifications = [...q.clarifications].sort((a, b) => a.asked_at.localeCompare(b.asked_at));
  const current = STEP_INDEX[q.status] ?? 0;
  const closed = q.closes_at && new Date(q.closes_at) < new Date();
  const invited = new Set(q.rfq_invites.map((i) => i.vendor_id));
  const eligible = (vendors ?? []).filter(
    (v) => !invited.has(v.id) && !v.vendor_documents.some((d) => d.expires_on && daysUntil(d.expires_on) < 0),
  );
  const buyer = can("buyer");
  const minVendors = q.orgs?.min_rfq_vendors ?? 3;

  return (
    <>
      <Topbar crumbs={[{ label: "Sourcing", href: "/rfqs" }, { label: q.number }]} />
      <div className="content">
        <PageHead
          title={q.number}
          badge={<StatusBadge status={q.status === "evaluation" ? "pending" : q.status} label={q.status === "open" ? "Open for bids" : humanize(q.status)} />}
          sub={<>{q.title}. {q.requisitions && <>Created from <Link className="link" href={`/requisitions/${q.requisitions.id}`}>{q.requisitions.number}</Link>. </>}
            {q.closes_at && `${closed ? "Closed" : "Closes"} ${formatStamp(q.closes_at)} UTC.`}</>}
          actions={
            <>
              {buyer && q.status === "draft" && (
                <ActionForm action={openRfq}>
                  <input type="hidden" name="rfq_id" value={q.id} />
                  <Submit primary disabled={q.rfq_invites.length < minVendors}>Open for bids</Submit>
                </ActionForm>
              )}
              {buyer && q.status === "open" && (
                <ActionForm action={closeRfq}>
                  <input type="hidden" name="rfq_id" value={q.id} />
                  <Submit>Close bidding</Submit>
                </ActionForm>
              )}
              {["evaluation", "awarded"].includes(q.status) && (
                <Link className="btn btn-primary" href={`/rfqs/${q.id}/bids`}>Bid comparison</Link>
              )}
            </>
          }
        />
        <div className="stepper">
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i <= current ? "done" : "todo"}`}>
              <div className="step-k">Step {i + 1}</div>
              <div className="step-v">{s}</div>
            </div>
          ))}
        </div>
        <div className="grid g-2">
          <Card title="Sourcing event">
            <div className="fields">
              <Field label="Sourcing method">{q.method}</Field>
              <Field label="Closing date and time">{q.closes_at ? `${formatStamp(q.closes_at)} UTC` : "—"}</Field>
              <Field label="Currency">{q.currency}</Field>
              <Field label="Delivery location">{q.delivery_location || "—"}</Field>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="field-label">Specifications and terms</div>
              <p style={{ marginBottom: 0 }}>{q.terms || "—"}</p>
            </div>
          </Card>
          <Card title="Evaluation criteria" note={`Weights total ${weightsTotal(criteria.map((c) => ({ ...c, isPrice: c.is_price })))}`}>
            <table className="table">
              <thead><tr><th>Criterion</th><th>Type</th><th className="num">Weight</th></tr></thead>
              <tbody>
                {criteria.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td className="muted">{c.type}</td><td className="num">{c.weight}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Invited vendors" note={`Approved vendors with valid documents only. Minimum ${minVendors}.`}>
            <table className="table">
              <thead><tr><th>Vendor</th><th>Invited</th><th>Status</th></tr></thead>
              <tbody>
                {q.rfq_invites.map((i) => (
                  <tr key={i.vendor_id}>
                    <td><Link className="rowlink" href={`/vendors/${i.vendor_id}`}>{i.vendors?.trading_name}</Link></td>
                    <td>{formatDate(i.invited_at)}</td>
                    <td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
                {!q.rfq_invites.length && <tr><td colSpan={3} className="empty">No vendors invited yet.</td></tr>}
              </tbody>
            </table>
            {buyer && ["draft", "open"].includes(q.status) && (
              <ActionForm action={inviteVendor} className="actions" style={{ marginTop: 12 }}>
                <input type="hidden" name="rfq_id" value={q.id} />
                <select className="input" name="vendor_id" aria-label="Vendor to invite" defaultValue="" style={{ flex: 1, minWidth: 0 }}>
                  <option value="" disabled>{eligible.length ? "Choose a vendor…" : "No other eligible vendors"}</option>
                  {eligible.map((v) => <option key={v.id} value={v.id}>{v.trading_name}</option>)}
                </select>
                <Submit small>Invite</Submit>
              </ActionForm>
            )}
          </Card>
          <Card title="Clarifications">
            <div className="stack" style={{ gap: 16 }}>
              {clarifications.map((c) => (
                <div key={c.id}>
                  <div className="trail-head" style={{ fontWeight: 400, fontSize: 12.5, color: "var(--muted)" }}>
                    {c.vendors?.trading_name}, question<span className="trail-when">{ago(c.asked_at)}</span>
                  </div>
                  <div>{c.question}</div>
                  {c.answer ? (
                    <div style={{ borderLeft: "2px solid var(--green)", paddingLeft: 10, marginTop: 6 }}>{c.answer}</div>
                  ) : buyer ? (
                    <ActionForm action={answerClarification} style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={c.id} />
                      <textarea className="input" name="answer" aria-label="Answer" placeholder="Answer, shared with all invited vendors" style={{ minHeight: 56 }} />
                      <div style={{ marginTop: 8 }}><Submit small primary>Send answer</Submit></div>
                    </ActionForm>
                  ) : (
                    <div className="help">Awaiting response from procurement.</div>
                  )}
                </div>
              ))}
              {!clarifications.length && <div className="empty">No clarification requests.</div>}
            </div>
          </Card>
        </div>

        {buyer && ["open", "evaluation"].includes(q.status) && (
          <Card title="Record a bid" note="Enter each quotation as received. Bids stay sealed until bidding closes.">
            <ActionForm action={recordBid}>
              <input type="hidden" name="rfq_id" value={q.id} />
              <div className="form-grid">
                <div>
                  <label className="lbl" htmlFor="bid_vendor">Vendor</label>
                  <select className="input" id="bid_vendor" name="vendor_id" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {q.rfq_invites.map((i) => (
                      <option key={i.vendor_id} value={i.vendor_id}>
                        {i.vendors?.trading_name}{q.bids.some((b) => b.vendor_id === i.vendor_id) ? " (update bid)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-grid" style={{ gap: 12 }}>
                  <div>
                    <label className="lbl" htmlFor="total">Quoted total, {q.currency}</label>
                    <input className="input num-in" id="total" name="total" inputMode="decimal" placeholder="0.00" required />
                  </div>
                  <div>
                    <label className="lbl" htmlFor="validity">Validity, days</label>
                    <input className="input num-in" id="validity" name="validity" type="number" min={1} defaultValue={60} required />
                  </div>
                </div>
              </div>
              <table className="table" style={{ marginTop: 14 }}>
                <thead><tr><th>Criterion</th><th className="num">Max</th><th style={{ width: 120 }}>Score</th><th>Evidence note</th></tr></thead>
                <tbody>
                  {scored.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}<input type="hidden" name="criterion_id" value={c.id} /></td>
                      <td className="num muted">{c.weight}</td>
                      <td><input className="input num-in" name={`score_${c.id}`} type="number" min={0} max={c.weight} step="0.1" required aria-label={`Score for ${c.name}`} /></td>
                      <td><input className="input" name={`note_${c.id}`} placeholder="e.g. Full, 10 days, 4.3 / 5" aria-label={`Note for ${c.name}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="help">The price score is calculated automatically: the lowest bid earns the full {criteria.find((c) => c.is_price)?.weight ?? 0} points.</p>
              <div style={{ marginTop: 12 }}><Submit primary>Record bid</Submit></div>
            </ActionForm>
          </Card>
        )}

        <Attachments recordType="rfq" recordId={q.id} title="RFQ documents and quotations" canUpload={q.status !== "cancelled"} />
        {q.status === "open" && (
          <p className="help">{q.bids.length} of {q.rfq_invites.length} bids received. Amounts stay hidden until bidding closes{q.closes_at ? ` on ${formatStamp(q.closes_at)} UTC` : ""}.</p>
        )}
      </div>
    </>
  );
}
