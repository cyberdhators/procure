import { getContext } from "@/lib/context";
import { spendByProject, toCsv } from "@/lib/reports";

export async function GET(request: Request) {
  const { supabase, orgId } = await getContext();
  const params = new URL(request.url).searchParams;
  const rows = await spendByProject(supabase, orgId, {
    donor: params.get("donor") ?? undefined,
    department: params.get("department") ?? undefined,
  });
  const csv = toCsv([
    ["Project", "Requisitions", "POs", "Committed USD", "Paid USD"],
    ...rows.map((r) => [r.project, r.requisitions, r.pos, (r.committedMinor / 100).toFixed(2), (r.paidMinor / 100).toFixed(2)]),
  ]);
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="procurement-summary-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
