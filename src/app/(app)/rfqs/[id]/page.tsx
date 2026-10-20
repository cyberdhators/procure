import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Card, Field, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { answerClarification } from "../../actions";
import { ago, formatDate, formatStamp, humanize } from "@/lib/format";
import { weightsTotal } from "@/lib/scoring";

const STEPS = ["Draft", "Invite", "Receive bids", "Evaluate", "Award"];
const STEP_INDEX: Record<string, number> = { draft: 0, open: 2, evaluation: 3, awarded: 4, cancelled: 0 };

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const { data: q } = await supabase
    .from("rfqs")
    .select(`*, requisitions(id, number), rfq_criteria(*), rfq_invites(*, vendors(trading_name)),
             clarifications(*, vendors(trading_name))`)
    .eq("id", id)
    .maybeSingle();
  if (!q) notFound();

  const criteria = [...q.rfq_criteria].sort((a, b) => a.position - b.position);
  const clarifications = [...q.clarifications].sort((a, b) => a.asked_at.localeCompare(b.asked_at));
  const current = STEP_INDEX[q.status] ?? 0;
  const closed = q.closes_at && new Date(q.closes_at) < new Date();

  return (
    <>
      <Topbar crumbs={[{ label: "Sourcing", href: "/rfqs" }, { label: q.number }]} />
      <div className="content">
        <PageHead
          title={q.number}
          badge={<StatusBadge status={q.status === "evaluation" ? "pending" : q.status} label={q.status === "open" ? "Open for bids" : humanize(q.status)} />}
          sub={<>{q.title}. {q.requisitions && <>Created from <Link className="link" href={`/requisitions/${q.requisitions.id}`}>{q.requisitions.number}</Link>. </>}
            {q.closes_at && `${closed ? "Closed" : "Closes"} ${formatStamp(q.closes_at)}.`}</>}
          actions={<Link className="btn btn-primary" href={`/rfqs/${q.id}/bids`}>Bid comparison</Link>}
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
              <Field label="Closing date and time">{q.closes_at ? formatStamp(q.closes_at) : "—"}</Field>
              <Field label="Currency">{q.currency}</Field>
              <Field label="Delivery location">{q.delivery_location || "—"}</Field>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="field-label">Specifications and terms</div>
              <p style={{ marginBottom: 0 }}>{q.terms}</p>
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
          <Card title="Invited vendors" note="Approved vendors only. Minimum 3 required.">
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
              </tbody>
            </table>
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
                  ) : can("buyer") ? (
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
      </div>
    </>
  );
}
