"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { previewRoute, saveRequisition } from "../../actions";
import { formatMoney, parseMoney, lineTotal } from "@/lib/money";

type Opt = { id: string; name: string };
type Budget = {
  code: string; department_id: string | null; project_id: string | null; donor_id: string | null;
  amount_minor: number; committed_minor: number;
};
type Line = { key: number; description: string; qty: string; unit: string; cost: string };
type Step = { level: number; label: string; approver_title: string; note: string };

const CATEGORIES = ["Goods", "Services", "Works", "Medical supplies", "Consultancy"];
const blank = (key: number): Line => ({ key, description: "", qty: "", unit: "each", cost: "" });

function Corners() {
  return <><i className="x bl" /><i className="x br" /></>;
}

export function RequisitionForm({ departments, projects, donors, budgets }: {
  departments: Opt[]; projects: Opt[]; donors: Opt[]; budgets: Budget[];
}) {
  const [state, action] = useActionState(saveRequisition, {});
  const [dept, setDept] = useState("");
  const [project, setProject] = useState("");
  const [donor, setDonor] = useState("");
  const [category, setCategory] = useState("Goods");
  const [lines, setLines] = useState<Line[]>([blank(1)]);
  const [route, setRoute] = useState<Step[]>([]);

  const total = useMemo(
    () => lines.reduce((a, l) => a + lineTotal(Number(l.qty) || 0, parseMoney(l.cost) ?? 0), 0),
    [lines],
  );
  const budget = budgets.find(
    (b) => b.department_id === (dept || null) && b.project_id === (project || null) && b.donor_id === (donor || null),
  );
  const remaining = budget ? Number(budget.amount_minor) - Number(budget.committed_minor) : null;

  useEffect(() => {
    const t = setTimeout(() => {
      previewRoute({ totalMinor: total, category, departmentId: dept, projectId: project, donorId: donor }).then(setRoute);
    }, 250);
    return () => clearTimeout(t);
  }, [total, category, dept, project, donor]);

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const checks = [
    { label: "Budget line found", ok: !!budget, note: budget?.code ?? "None" },
    {
      label: "Budget availability",
      ok: remaining !== null && remaining >= total,
      note: remaining === null ? "—" : remaining >= total ? "OK" : "Short",
    },
    { label: "Quotations required", ok: true, note: total > 500000 ? "3 quotes" : total > 100000 ? "2 quotes" : "1 quote" },
  ];

  return (
    <form action={action} className="stack">
      <div className="page-head">
        <div>
          <div className="page-title"><h1>New requisition</h1></div>
          <div className="page-sub">Routing is determined automatically on submission.</div>
        </div>
        <div className="actions">
          <button className="btn" type="submit" name="intent" value="draft">Save draft</button>
          <button className="btn btn-primary" type="submit" name="intent" value="submit">Submit for approval</button>
        </div>
      </div>
      {state.error && <div className="error" role="alert">{state.error}</div>}

      <div className="grid g-main">
        <div className="stack">
          <section className="card">
            <Corners />
            <div className="card-head"><h2>Request details</h2></div>
            <div className="form-grid">
              <div className="full">
                <label className="lbl" htmlFor="title">Title</label>
                <input className="input" id="title" name="title" required placeholder="Office furniture for field office" />
              </div>
              <div>
                <label className="lbl" htmlFor="department_id">Department</label>
                <select className="input" id="department_id" name="department_id" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">Select…</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="project_id">Project</label>
                <select className="input" id="project_id" name="project_id" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">None (core)</option>
                  {projects.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="donor_id">Donor or funding source</label>
                <select className="input" id="donor_id" name="donor_id" value={donor} onChange={(e) => setDonor(e.target.value)}>
                  <option value="">Select…</option>
                  {donors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="budget_code">Budget code</label>
                <input className="input" id="budget_code" value={budget?.code ?? "No matching budget line"} readOnly tabIndex={-1} />
              </div>
              <div>
                <label className="lbl" htmlFor="category">Procurement category</label>
                <select className="input" id="category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="required_by">Required delivery date</label>
                <input className="input" id="required_by" name="required_by" type="date" />
              </div>
              <div className="full">
                <label className="lbl" htmlFor="justification">Business justification</label>
                <textarea className="input" id="justification" name="justification" />
              </div>
            </div>
          </section>

          <section className="card">
            <Corners />
            <div className="card-head">
              <h2>Line items</h2>
              <button
                type="button"
                className="link"
                onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((l) => l.key)) + 1)])}
              >
                Add line
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 100 }}>Unit</th>
                    <th className="num" style={{ width: 140 }}>Est. unit cost</th><th className="num">Total</th><th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <input className="input" name="line_description" aria-label={`Line ${i + 1} description`}
                          value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                      </td>
                      <td>
                        <input className="input num-in" name="line_qty" inputMode="decimal" aria-label={`Line ${i + 1} quantity`}
                          value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                      </td>
                      <td>
                        <input className="input" name="line_unit" aria-label={`Line ${i + 1} unit`}
                          value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} />
                      </td>
                      <td>
                        <input className="input num-in" name="line_cost" inputMode="decimal" placeholder="0.00"
                          aria-label={`Line ${i + 1} unit cost`} value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
                      </td>
                      <td className="num">{formatMoney(lineTotal(Number(l.qty) || 0, parseMoney(l.cost) ?? 0))}</td>
                      <td className="num">
                        {lines.length > 1 && (
                          <button type="button" className="link" aria-label={`Remove line ${i + 1}`}
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={5} className="num total-label">Estimated total, USD</td>
                    <td className="num total-value">{formatMoney(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <Corners />
            <div className="card-head"><h2>Approval route</h2></div>
            <p className="card-note" style={{ marginTop: -8, marginBottom: 14 }}>
              Based on value USD {formatMoney(total)} and the selected funding.
            </p>
            <div className="route">
              {route.map((s) => (
                <div className="route-item" key={s.level}>
                  <div className="route-n">{s.level}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                    <div className="trail-sub">{s.approver_title}</div>
                  </div>
                </div>
              ))}
              {route.length === 0 && <div className="empty">No routing rules configured.</div>}
            </div>
          </section>
          <section className="card">
            <Corners />
            <div className="card-head"><h2>Checks</h2></div>
            <div className="rows">
              {checks.map((c) => (
                <div key={c.label}>
                  <span>{c.label}</span>
                  <span className={`badge ${c.ok ? "green" : "amber"}`}>{c.note}</span>
                </div>
              ))}
            </div>
            {remaining !== null && <p className="help">Budget remaining on {budget?.code}: USD {formatMoney(remaining)}.</p>}
          </section>
        </div>
      </div>
    </form>
  );
}
