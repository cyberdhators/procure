import type { Db } from "./context";

export type ReportFilters = { donor?: string; department?: string };
export type ReportRow = {
  project: string; requisitions: number; pos: number; committedMinor: number; paidMinor: number;
};

/** Spend by project: budget commitments and payments, with document counts. Aggregated in Postgres. */
export async function spendByProject(supabase: Db, orgId: string, f: ReportFilters): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("spend_by_project", {
    p_org: orgId, p_donor: f.donor || null, p_department: f.department || null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { project: string; requisitions: number; pos: number; committed_minor: number; paid_minor: number }) => ({
    project: r.project,
    requisitions: Number(r.requisitions),
    pos: Number(r.pos),
    committedMinor: Number(r.committed_minor),
    paidMinor: Number(r.paid_minor),
  }));
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
