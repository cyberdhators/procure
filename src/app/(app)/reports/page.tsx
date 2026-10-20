import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, Topbar } from "@/components/ui";
import { spendByProject } from "@/lib/reports";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Reports and exports" };

const REPORTS = [
  ["Spend by department, project, donor", "Summary", "/reports"],
  ["Requisition and approval status", "List", "/requisitions"],
  ["Vendor performance", "Scorecard", "/vendors"],
  ["Open purchase orders", "List", "/purchase-orders"],
  ["Invoice exceptions", "List", "/invoices"],
  ["Audit trail", "Log", "/audit"],
] as const;

export default async function Reports({ searchParams }: { searchParams: Promise<{ donor?: string; department?: string }> }) {
  const filters = await searchParams;
  const { supabase, orgId } = await getContext();
  const [{ data: donors }, { data: departments }, rows] = await Promise.all([
    supabase.from("donors").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("departments").select("id, name").eq("org_id", orgId).order("name"),
    spendByProject(supabase, orgId, filters),
  ]);
  const donorName = donors?.find((d) => d.id === filters.donor)?.name;
  const total = rows.reduce(
    (a, r) => ({ requisitions: a.requisitions + r.requisitions, pos: a.pos + r.pos, committed: a.committed + r.committedMinor, paid: a.paid + r.paidMinor }),
    { requisitions: 0, pos: 0, committed: 0, paid: 0 },
  );
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <Topbar crumbs={[{ label: "Governance" }, { label: "Reports" }]} />
      <div className="content">
        <PageHead
          title="Reports and exports"
          sub="Filter by department or donor. Export to CSV for Excel."
          actions={<a className="btn btn-primary" href={`/reports/export${qs ? `?${qs}` : ""}`}>Export to Excel</a>}
        />
        <Card>
          <form className="actions" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="lbl" htmlFor="department">Department</label>
              <select className="input" id="department" name="department" defaultValue={filters.department ?? ""}>
                <option value="">All</option>
                {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="lbl" htmlFor="donor">Donor</label>
              <select className="input" id="donor" name="donor" defaultValue={filters.donor ?? ""}>
                <option value="">All</option>
                {donors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <button className="btn" type="submit">Apply</button>
          </form>
        </Card>
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2.2fr)", alignItems: "start" }}>
          <Card title="Available reports">
            <div className="rows">
              {REPORTS.map(([name, kind, href]) => (
                <Link key={name} href={href}><span>{name}</span><span className="card-note">{kind}</span></Link>
              ))}
            </div>
          </Card>
          <Card title={`${donorName ?? "All donors"} procurement summary`}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Project</th><th className="num">Requisitions</th><th className="num">POs</th><th className="num">Committed, USD</th><th className="num">Paid, USD</th><th className="num">Paid %</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.project}>
                      <td>{r.project}</td>
                      <td className="num">{r.requisitions}</td>
                      <td className="num">{r.pos}</td>
                      <td className="num">{formatMoney(r.committedMinor)}</td>
                      <td className="num">{formatMoney(r.paidMinor)}</td>
                      <td className="num">{r.committedMinor ? Math.round((r.paidMinor / r.committedMinor) * 100) : 0}%</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6} className="empty">No data for these filters.</td></tr>}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="total-row" style={{ fontWeight: 600 }}>
                      <td>Total</td>
                      <td className="num">{total.requisitions}</td>
                      <td className="num">{total.pos}</td>
                      <td className="num">{formatMoney(total.committed)}</td>
                      <td className="num">{formatMoney(total.paid)}</td>
                      <td className="num">{total.committed ? Math.round((total.paid / total.committed) * 100) : 0}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="help">Committed and paid figures come from budget lines; counts link back to the underlying requisitions and purchase orders.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
