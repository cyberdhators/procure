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

// ---------------------------------------------------------------- Lifecycle helpers

type Args = Record<string, unknown>;

/** Calls a workflow function and refreshes every page; Postgres errors become form messages. */
async function run(fn: string, args: Args, ok: string): Promise<ActionState> {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok };
}

/** Like run(), but navigates to the record the function created. */
async function runAndGo(fn: string, args: Args, to: (id: string) => string): Promise<ActionState> {
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect(to(data as string));
}

const money = (d: FormData, k: string) => parseMoney(str(d, k));
const dateOrNull = (d: FormData, k: string) => str(d, k) || null;

// ---------------------------------------------------------------- Settings

export async function addReference(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  return run("add_reference", { p_org: orgId, p_kind: str(d, "kind"), p_name: str(d, "name"), p_title: str(d, "title") },
    `${str(d, "name")} added.`);
}

export async function addBudgetLine(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  const amount = money(d, "amount");
  if (amount === null) return { error: "Enter a valid amount, for example 25000.00." };
  return run("add_budget_line", {
    p_org: orgId, p_code: str(d, "code"), p_department: str(d, "department_id") || null,
    p_project: str(d, "project_id") || null, p_donor: str(d, "donor_id") || null, p_amount_minor: amount,
  }, "Budget line added.");
}

export async function setBudgetAmount(_: ActionState, d: FormData): Promise<ActionState> {
  const amount = money(d, "amount");
  if (amount === null) return { error: "Enter a valid amount." };
  return run("set_budget_amount", { p_line: str(d, "id"), p_amount_minor: amount, p_reason: str(d, "reason") }, "Budget revised.");
}

export async function addApprovalRule(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  const min = str(d, "min_value") ? money(d, "min_value") : null;
  if (str(d, "min_value") && min === null) return { error: "Enter a valid threshold." };
  return run("add_approval_rule", {
    p_org: orgId, p_label: str(d, "label"), p_approver_title: str(d, "approver_title"),
    p_required_role: str(d, "required_role"), p_min_value_minor: min, p_category: str(d, "category"),
  }, "Routing rule added.");
}

export async function deleteApprovalRule(_: ActionState, d: FormData): Promise<ActionState> {
  return run("delete_approval_rule", { p_rule: str(d, "id") }, "Routing rule removed.");
}

export async function setOrgControls(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  const limit = money(d, "direct_po_limit");
  if (limit === null) return { error: "Enter a valid direct purchase limit." };
  return run("set_org_controls", {
    p_org: orgId, p_direct_po_limit_minor: limit,
    p_tolerance_pct: Number(str(d, "tolerance")), p_min_vendors: Number(str(d, "min_vendors")),
  }, "Controls saved.");
}

export async function inviteMember(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  return run("invite_member", {
    p_org: orgId, p_email: str(d, "email"), p_display_name: str(d, "display_name"),
    p_title: str(d, "title"), p_roles: d.getAll("roles").map(String),
  }, `Invitation recorded. ${str(d, "email")} joins automatically after signing up with that address.`);
}

export async function setMemberRoles(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  return run("set_member_roles", {
    p_org: orgId, p_user: str(d, "user_id"), p_title: str(d, "title"), p_roles: d.getAll("roles").map(String),
  }, "Roles updated.");
}

export async function removeMember(_: ActionState, d: FormData): Promise<ActionState> {
  const { orgId } = await getContext();
  return run("remove_member", { p_org: orgId, p_user: str(d, "user_id") }, "Member removed.");
}

export async function addVendorDocument(_: ActionState, d: FormData): Promise<ActionState> {
  return run("add_vendor_document", {
    p_vendor: str(d, "vendor_id"), p_name: str(d, "name"), p_expires_on: dateOrNull(d, "expires_on"),
  }, "Document recorded.");
}

// ---------------------------------------------------------------- Sourcing and ordering

export async function createRfq(_: ActionState, d: FormData): Promise<ActionState> {
  const closes = str(d, "closes_at");
  if (!closes) return { error: "Set a closing date and time." };
  return runAndGo("create_rfq", {
    p_req: str(d, "requisition_id"), p_closes_at: new Date(closes).toISOString(),
    p_location: str(d, "location"), p_terms: str(d, "terms"),
  }, (id) => `/rfqs/${id}`);
}

export async function createDirectPo(_: ActionState, d: FormData): Promise<ActionState> {
  if (!str(d, "vendor_id")) return { error: "Choose a vendor." };
  return runAndGo("create_direct_po", { p_req: str(d, "requisition_id"), p_vendor: str(d, "vendor_id") },
    (id) => `/purchase-orders/${id}`);
}

export async function inviteVendor(_: ActionState, d: FormData): Promise<ActionState> {
  if (!str(d, "vendor_id")) return { error: "Choose a vendor." };
  return run("invite_vendor", { p_rfq: str(d, "rfq_id"), p_vendor: str(d, "vendor_id") }, "Vendor invited.");
}

export async function openRfq(_: ActionState, d: FormData): Promise<ActionState> {
  return run("open_rfq", { p_rfq: str(d, "rfq_id") }, "RFQ is open for bids.");
}

export async function closeRfq(_: ActionState, d: FormData): Promise<ActionState> {
  return run("close_rfq", { p_rfq: str(d, "rfq_id") }, "Bidding closed. Evaluation can start.");
}

export async function recordBid(_: ActionState, d: FormData): Promise<ActionState> {
  const total = money(d, "total");
  if (total === null) return { error: "Enter the quoted total, for example 17950.00." };
  const scores: Record<string, { score: number; note: string }> = {};
  for (const cid of d.getAll("criterion_id").map(String)) {
    const raw = str(d, `score_${cid}`);
    if (raw === "" || Number.isNaN(Number(raw))) return { error: "Score every criterion." };
    scores[cid] = { score: Number(raw), note: str(d, `note_${cid}`) };
  }
  return run("record_bid", {
    p_rfq: str(d, "rfq_id"), p_vendor: str(d, "vendor_id"), p_total_minor: total,
    p_validity_days: Number(str(d, "validity")), p_scores: scores,
  }, "Bid recorded.");
}

export async function createPoFromAward(_: ActionState, d: FormData): Promise<ActionState> {
  return runAndGo("create_po_from_award", { p_rfq: str(d, "rfq_id") }, (id) => `/purchase-orders/${id}`);
}

export async function savePoDraft(_: ActionState, d: FormData): Promise<ActionState> {
  const lines: { id: string; unit_price_minor: number }[] = [];
  for (const id of d.getAll("line_id").map(String)) {
    const price = money(d, `price_${id}`);
    if (price === null) return { error: "Enter a valid unit price on every line." };
    lines.push({ id, unit_price_minor: price });
  }
  return run("save_po_draft", {
    p_po: str(d, "po_id"), p_lines: lines, p_expected: dateOrNull(d, "expected_delivery"),
    p_location: str(d, "delivery_location"), p_terms: str(d, "payment_terms"),
  }, "Draft saved.");
}

export async function approvePo(_: ActionState, d: FormData): Promise<ActionState> {
  return run("approve_po", { p_po: str(d, "po_id") }, "Purchase order approved.");
}

export async function issuePo(_: ActionState, d: FormData): Promise<ActionState> {
  return run("issue_po", { p_po: str(d, "po_id") }, "Purchase order issued to the vendor.");
}

export async function createGoodsReceipt(_: ActionState, d: FormData): Promise<ActionState> {
  return runAndGo("create_goods_receipt", {
    p_po: str(d, "po_id"), p_delivered_on: str(d, "delivered_on") || new Date().toISOString().slice(0, 10),
    p_location: str(d, "location"),
  }, (id) => `/goods-receipts/${id}`);
}

export async function registerInvoice(_: ActionState, d: FormData): Promise<ActionState> {
  const lines: { po_line_id: string; qty: number; unit_price_minor: number }[] = [];
  for (const id of d.getAll("po_line_id").map(String)) {
    const qty = Number(str(d, `qty_${id}`) || 0);
    const price = money(d, `price_${id}`);
    if (Number.isNaN(qty) || qty < 0) return { error: "Quantities must be zero or more." };
    if (price === null) return { error: "Enter a valid unit price on every line." };
    lines.push({ po_line_id: id, qty, unit_price_minor: price });
  }
  return runAndGo("register_invoice", {
    p_po: str(d, "po_id"), p_vendor_ref: str(d, "vendor_ref"), p_invoice_date: str(d, "invoice_date"), p_lines: lines,
  }, (id) => `/invoices/${id}`);
}

export async function markInvoicePaid(_: ActionState, d: FormData): Promise<ActionState> {
  return run("mark_invoice_paid", {
    p_invoice: str(d, "id"), p_paid_on: str(d, "paid_on"), p_reference: str(d, "reference"),
  }, "Payment recorded.");
}

// ---------------------------------------------------------------- Attachments

const MAX_UPLOAD = 4 * 1024 * 1024;

export async function uploadAttachment(_: ActionState, d: FormData): Promise<ActionState> {
  const { supabase, orgId } = await getContext();
  const file = d.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_UPLOAD) return { error: "Files must be 4 MB or smaller." };
  const recordType = str(d, "record_type");
  const recordId = str(d, "record_id");
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const path = `${orgId}/${recordType}/${recordId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage.from("attachments").upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (upErr) return { error: `Upload failed: ${upErr.message}` };
  const { error } = await supabase.rpc("add_attachment", {
    p_org: orgId, p_record_type: recordType, p_record_id: recordId, p_name: file.name, p_size: file.size, p_path: path,
  });
  if (error) {
    await supabase.storage.from("attachments").remove([path]);
    return { error: error.message };
  }
  revalidatePath("/", "layout");
  return { ok: `${file.name} attached.` };
}
