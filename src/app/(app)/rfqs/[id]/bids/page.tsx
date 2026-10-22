import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { Badge, Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import Link from "next/link";
import { createPoFromAward, recommendAward, submitEvaluation } from "../../../actions";
import { formatMoney } from "@/lib/money";
import { scoreBids } from "@/lib/scoring";
import { humanize } from "@/lib/format";

export default async function BidComparison({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, can } = await getContext();
  const { data: q } = await supabase
    .from("rfqs")
    .select(`id, number, title, status, award_decision, award_vendor_id, award_justification,
             rfq_criteria(*), rfq_invites(vendor_id), evaluators(*),
             bids(*, vendors!bids_vendor_id_fkey(trading_name), bid_scores(*))`)
    .eq("id", id)
    .maybeSingle();
  if (!q) notFound();
  const { data: orders } = await supabase.from("purchase_orders").select("id, number").eq("rfq_id", id);
  const sealed = ["draft", "open"].includes(q.status);
  if (sealed) {
    return (
      <>
        <Topbar crumbs={[{ label: "Sourcing", href: "/rfqs" }, { label: q.number, href: `/rfqs/${q.id}` }, { label: "Bid comparison" }]} />
        <div className="content">
          <PageHead title="Bid comparison" sub={`${q.number}, ${q.title}.`} />
          <Card><p style={{ margin: 0 }}>Bids are sealed until bidding closes. {q.bids.length} of {q.rfq_invites.length} received so far.</p></Card>
        </div>
      </>
    );
  }

  const criteria = [...q.rfq_criteria].sort((a, b) => a.position - b.position);
  const bids = [...q.bids].sort((a, b) => a.vendors.trading_name.localeCompare(b.vendors.trading_name));
  const results = scoreBids(
    criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, isPrice: c.is_price })),
    bids.map((b) => ({
      id: b.id,
      totalMinor: Number(b.total_minor),
      scores: Object.fromEntries(b.bid_scores.map((s) => [s.criterion_id, Number(s.score)])),
    })),
  );
  const resultFor = (bidId: string) => results.find((r) => r.id === bidId)!;
  const noteFor = (b: (typeof bids)[number], critId: string) => b.bid_scores.find((s) => s.criterion_id === critId)?.note;
  const best = results.find((r) => r.recommended);
  const bestBid = bids.find((b) => b.id === best?.id);
  const lowest = bids.reduce<(typeof bids)[number] | null>((m, b) => (!m || b.total_minor < m.total_minor ? b : m), null);
  const pendingPanel = q.evaluators.filter((e) => !e.submitted);
  const awarded = q.status === "awarded";

  const suggestion = bestBid && lowest && bestBid.id !== lowest.id
    ? `${bestBid.vendors.trading_name} offers the highest weighted score (${best!.weightedScore.toFixed(1)}). ${lowest.vendors.trading_name} quoted ${Math.round((1 - lowest.total_minor / bestBid.total_minor) * 100)}% lower but scored lower on non-price criteria.`
    : bestBid ? `${bestBid.vendors.trading_name} offers both the lowest price and the highest weighted score.` : "";

  return (
    <>
      <Topbar crumbs={[{ label: "Sourcing", href: "/rfqs" }, { label: q.number, href: `/rfqs/${q.id}` }, { label: "Bid comparison" }]} />
      <div className="content">
        <PageHead
          title="Bid comparison"
          badge={<StatusBadge status={awarded ? "approved" : "pending"} label={awarded ? "Award recommended" : "Evaluation in progress"} />}
          sub={`${q.number}, ${q.title}. ${bids.length} of ${q.rfq_invites.length} invited vendors submitted before closing.`}
        />
        <Card className="flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Criterion</th><th className="num">Weight</th>
                  {bids.map((b) => <th key={b.id}>{b.vendors.trading_name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Total price, USD</td><td className="num muted" />
                  {bids.map((b) => <td key={b.id}>{formatMoney(b.total_minor)}</td>)}
                </tr>
                {criteria.map((c) => (
                  <tr key={c.id}>
                    <td>{c.is_price ? "Price score" : c.name}</td>
                    <td className="num muted">{c.weight}</td>
                    {bids.map((b) => {
                      const score = resultFor(b.id).criterionScores[c.id];
                      const note = noteFor(b, c.id);
                      return <td key={b.id}>{note ? `${note}, ` : ""}{score.toFixed(1)}</td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td>Quotation validity</td><td />
                  {bids.map((b) => <td key={b.id}>{b.validity_days} days</td>)}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Weighted score</td><td />
                  {bids.map((b) => {
                    const r = resultFor(b.id);
                    return (
                      <td key={b.id}>
                        <span className="total-value">{r.weightedScore.toFixed(1)}</span>{" "}
                        {r.recommended && <Badge tone="green">Recommended</Badge>}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid g-main">
          <Card title="Award recommendation">
            {awarded ? (
              <>
                <p style={{ marginTop: 0 }}>
                  <strong>{q.award_decision === "award"
                    ? `Award to ${bids.find((b) => b.vendor_id === q.award_vendor_id)?.vendors.trading_name}`
                    : humanize(q.award_decision ?? "")}</strong>
                </p>
                <p className="help">{q.award_justification}</p>
                {orders?.length ? (
                  <div className="actions">{orders.map((o) => <Link key={o.id} className="btn" href={`/purchase-orders/${o.id}`}>Open {o.number}</Link>)}</div>
                ) : q.award_decision === "award" && can("buyer") ? (
                  <ActionForm action={createPoFromAward}>
                    <input type="hidden" name="rfq_id" value={q.id} />
                    <Submit primary>Draft purchase order</Submit>
                  </ActionForm>
                ) : null}
              </>
            ) : can("buyer") ? (
              <ActionForm action={recommendAward}>
                <input type="hidden" name="rfq" value={q.id} />
                <label className="lbl" htmlFor="justification">Justification (retained in the procurement file)</label>
                <textarea className="input" id="justification" name="justification" defaultValue={suggestion} />
                <div className="radio-row">
                  {bids.map((b) => (
                    <label key={b.id}>
                      <input type="radio" name="decision" value={`award:${b.vendor_id}`} defaultChecked={b.id === bestBid?.id} /> Award to {b.vendors.trading_name}
                    </label>
                  ))}
                  <label><input type="radio" name="decision" value="split" /> Split award</label>
                  <label><input type="radio" name="decision" value="retender" /> Re-tender</label>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Submit primary disabled={pendingPanel.length > 0}>Submit award recommendation</Submit>
                  {pendingPanel.length > 0 && <p className="help">Waiting for {pendingPanel.map((p) => p.title).join(", ")} to submit scores.</p>}
                </div>
              </ActionForm>
            ) : (
              <p className="help">Only buyers can recommend an award.</p>
            )}
          </Card>
          <Card title="Evaluation panel">
            <div className="rows">
              {q.evaluators.map((e) => (
                <div key={e.title}>
                  <span>{e.title}</span>
                  {e.submitted ? <Badge tone="green">Scored</Badge> : q.status !== "evaluation" ? <Badge>Not scored</Badge> : (
                    <ActionForm action={submitEvaluation}>
                      <input type="hidden" name="rfq" value={q.id} />
                      <input type="hidden" name="title" value={e.title} />
                      <Submit small>Record scores</Submit>
                    </ActionForm>
                  )}
                </div>
              ))}
            </div>
            <p className="help">Scores are averaged once all panel members have submitted. Individual scores and comments are kept in the audit trail.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
