import type { Db } from "./context";

export type ReportFilters = { donor?: string; department?: string };
export type ReportRow = {
  project: string; requisitions: number; pos: number; committedMinor: number; paidMinor: number;
};

/** Spend by project: budget commitments and payments, with document counts. */
export async function spendByProject(supabase: Db, orgId: string, f: ReportFilters) {
  let budgets = supabase
    .from("budget_lines")
    .select("id, committed_minor, spent_minor, project_id, projects(name)")
    .eq("org_id", orgId);
  let reqs = supabase.from("requisitions").select("id, project_id, budget_line_id").eq("org_id", orgId).neq("status", "draft");
  if (f.donor) {
    budgets = budgets.eq("donor_id", f.donor);
    reqs = reqs.eq("donor_id", f.donor);
  }
  if (f.department) {
    budgets = budgets.eq("department_id", f.department);
    reqs = reqs.eq("department_id", f.department);
  }
  const [{ data: b }, { data: r }, { data: p }] = await Promise.all([
    budgets,
    reqs,
    supabase.from("purchase_orders").select("budget_line_id, requisition_id").eq("org_id", orgId).neq("status", "cancelled"),
  ]);

  const rows = new Map<string, ReportRow>();
  const row = (name: string) => {
    if (!rows.has(name)) rows.set(name, { project: name, requisitions: 0, pos: 0, committedMinor: 0, paidMinor: 0 });
    return rows.get(name)!;
  };
  const projectName = new Map<string, string>();
  const budgetProject = new Map<string, string>();
  for (const x of b ?? []) {
    const name = (x.projects as unknown as { name: string } | null)?.name ?? "Core (no project)";
    if (x.project_id) projectName.set(x.project_id, name);
    budgetProject.set(x.id, name);
    const target = row(name);
    target.committedMinor += Number(x.committed_minor);
    target.paidMinor += Number(x.spent_minor);
  }
  const reqProject = new Map<string, string>();
  for (const x of r ?? []) {
    const name = (x.project_id && projectName.get(x.project_id)) || (x.budget_line_id && budgetProject.get(x.budget_line_id));
    if (!name) continue;
    reqProject.set(x.id, name);
    row(name).requisitions++;
  }
  for (const x of p ?? []) {
    const name = (x.budget_line_id && budgetProject.get(x.budget_line_id)) || (x.requisition_id && reqProject.get(x.requisition_id));
    if (name) row(name).pos++;
  }
  return [...rows.values()].sort((a, c) => a.project.localeCompare(c.project));
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => {
      const s = String(v);
      // Neutralise spreadsheet formula injection and quote when needed.
      const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    }).join(","))
    .join("\r\n");
}
