"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { parseMoney } from "@/lib/money";
import type { ActionState } from "@/components/action-form";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();

// ---------------------------------------------------------------- Requisitions

export async function saveRequisition(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase, orgId } = await getContext();
  const descriptions = d.getAll("line_description").map(String);
  const qtys = d.getAll("line_qty").map(String);
  const units = d.getAll("line_unit").map(String);
  const costs = d.getAll("line_cost").map(String);

  const lines: { description: string; qty: number; unit: string; unit_cost_minor: number }[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i].trim();
    if (!description && !qtys[i] && !costs[i]) continue;
    const qty = Number(qtys[i]);
    const unitCost = parseMoney(costs[i] ?? "");
    if (!description) return { error: `Line ${i + 1}: enter a description.` };
    if (!(qty > 0)) return { error: `Line ${i + 1}: quantity must be greater than zero.` };
    if (unitCost === null) return { error: `Line ${i + 1}: enter a valid unit cost, for example 310.00.` };
    lines.push({ description, qty, unit: units[i]?.trim() || "each", unit_cost_minor: unitCost });
  }

  const { data: id, error } = await supabase.rpc("save_requisition", {
    p_org: orgId,
    p_submit: str(d, "intent") === "submit",
    p_payload: {
      title: str(d, "title"),
      department_id: str(d, "department_id"),
      project_id: str(d, "project_id"),
      donor_id: str(d, "donor_id"),
      category: str(d, "category"),
      required_by: str(d, "required_by"),
      justification: str(d, "justification"),
      lines,
    },
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect(`/requisitions/${id}`);
}

export async function previewRoute(input: {
  totalMinor: number; category: string; departmentId: string; projectId: string; donorId: string;
}) {
  const { supabase, orgId } = await getContext();
  const { data } = await supabase.rpc("route_plan", {
    p_org: orgId,
    p_total_minor: input.totalMinor,
    p_category: input.category,
    p_department: input.departmentId || null,
    p_project: input.projectId || null,
    p_donor: input.donorId || null,
  });
  return (data ?? []) as { level: number; label: string; approver_title: string; note: string }[];
}

export async function submitRequisition(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("submit_requisition", { p_req: str(d, "id") });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Submitted for approval." };
}

export async function decideRequisition(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const decision = str(d, "decision");
  const { error } = await supabase.rpc("decide_requisition", {
    p_req: str(d, "id"), p_decision: decision, p_comment: str(d, "comment"),
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  const done = { approve: "Approved.", return: "Returned to the requester for correction.", reject: "Rejected." };
  return { ok: done[decision as keyof typeof done] ?? "Saved." };
}

// ---------------------------------------------------------------- Sourcing

export async function answerClarification(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("answer_clarification", { p_id: str(d, "id"), p_answer: str(d, "answer") });
  if (error) return { error: error.message };
  revalidatePath("/rfqs");
  return { ok: "Answer shared with all invited vendors." };
}

export async function submitEvaluation(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("submit_evaluation", { p_rfq: str(d, "rfq"), p_title: str(d, "title") });
  if (error) return { error: error.message };
  revalidatePath("/rfqs");
  return { ok: `${str(d, "title")} scores recorded.` };
}

export async function recommendAward(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const choice = str(d, "decision");
  const [decision, vendor] = choice.startsWith("award:") ? ["award", choice.slice(6)] : [choice, null];
  if (!decision) return { error: "Choose award, split award or re-tender." };
  const { error } = await supabase.rpc("recommend_award", {
    p_rfq: str(d, "rfq"), p_decision: decision, p_vendor: vendor, p_justification: str(d, "justification"),
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Award recommendation submitted." };
}

// ---------------------------------------------------------------- Receiving

export async function saveGoodsReceipt(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const ids = d.getAll("po_line_id").map(String);
  const lines = ids.map((id) => ({
    po_line_id: id,
    received_qty: Number(d.get(`qty_${id}`) ?? 0),
    inspection: String(d.get(`insp_${id}`) ?? "Passed"),
  }));
  if (lines.some((l) => !(l.received_qty >= 0))) return { error: "Received quantities must be zero or more." };

  const checklist = Object.fromEntries(d.getAll("check_item").map((k) => [String(k), d.get(`check_${k}`) === "on"]));
  const accept = str(d, "intent") === "accept";
  const { error } = await supabase.rpc("save_goods_receipt", {
    p_grn: str(d, "id"), p_lines: lines, p_checklist: checklist,
    p_disc_item: str(d, "disc_item"), p_disc_type: str(d, "disc_type"), p_disc_note: str(d, "disc_note"),
    p_accept: accept,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: accept ? "Goods receipt accepted and signed." : "Draft saved." };
}

// ---------------------------------------------------------------- Invoices

export async function resolveInvoice(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const resolution = str(d, "resolution");
  if (!resolution) return { error: "Choose how to resolve the exception." };
  const { error } = await supabase.rpc("resolve_invoice", {
    p_invoice: str(d, "id"), p_resolution: resolution, p_reason: str(d, "reason"),
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Resolution recorded in the audit trail." };
}

// ---------------------------------------------------------------- Vendors

export async function addVendor(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase, orgId } = await getContext();
  const legal = str(d, "legal_name");
  if (!legal) return { error: "Enter the vendor's legal name." };
  const { data: number, error: numErr } = await supabase.rpc("next_vendor_number", { p_org: orgId });
  if (numErr) return { error: numErr.message };
  const { data, error } = await supabase
    .from("vendors")
    .insert({
      org_id: orgId, number, legal_name: legal, trading_name: str(d, "trading_name") || legal,
      categories: str(d, "categories"), email: str(d, "email"), tax_id: str(d, "tax_id"),
      registration_no: str(d, "registration_no"),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  redirect(`/vendors/${data.id}`);
}

export async function setVendorStatus(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("set_vendor_status", { p_vendor: str(d, "id"), p_status: str(d, "status") });
  if (error) return { error: error.message };
  revalidatePath("/vendors");
  return { ok: `Vendor ${str(d, "status")}.` };
}
