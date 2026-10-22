-- Fixes from the Supabase security and performance advisors.

-- Helpers that must not be callable through the REST API. po_total and
-- received_qty do no membership check and would reveal another organisation's
-- figures to anyone holding a record id; the others are internal guards or
-- trigger functions. Workflow functions call them as the definer.
revoke execute on function po_total(uuid), received_qty(uuid), vendor_has_expired_docs(uuid),
  actor_label(uuid), assert_no_membership(), assert_not_sourced(uuid), require_role(uuid, member_role),
  vendors_audit_insert() from authenticated, anon, public;

-- Fixed search_path on the remaining functions.
alter function audit_events_immutable() set search_path = public;
alter function money_text(bigint) set search_path = public;

-- Indexes for foreign keys (tenant filters, parent lookups and joins).
create index if not exists approval_rules_org_id_idx on approval_rules (org_id);
create index if not exists approval_rules_donor_id_idx on approval_rules (donor_id);
create index if not exists approval_steps_org_id_idx on approval_steps (org_id);
create index if not exists approval_steps_acted_by_idx on approval_steps (acted_by);
create index if not exists attachments_org_id_idx on attachments (org_id);
create index if not exists bid_scores_org_id_idx on bid_scores (org_id);
create index if not exists bid_scores_criterion_id_idx on bid_scores (criterion_id);
create index if not exists bids_org_id_idx on bids (org_id);
create index if not exists bids_vendor_id_idx on bids (vendor_id);
create index if not exists budget_lines_department_id_idx on budget_lines (department_id);
create index if not exists budget_lines_project_id_idx on budget_lines (project_id);
create index if not exists budget_lines_donor_id_idx on budget_lines (donor_id);
create index if not exists clarifications_org_id_idx on clarifications (org_id);
create index if not exists clarifications_rfq_id_idx on clarifications (rfq_id);
create index if not exists clarifications_vendor_id_idx on clarifications (vendor_id);
create index if not exists evaluators_org_id_idx on evaluators (org_id);
create index if not exists goods_receipts_po_id_idx on goods_receipts (po_id);
create index if not exists goods_receipts_created_by_idx on goods_receipts (created_by);
create index if not exists goods_receipts_received_by_idx on goods_receipts (received_by);
create index if not exists grn_lines_org_id_idx on grn_lines (org_id);
create index if not exists grn_lines_po_line_id_idx on grn_lines (po_line_id);
create index if not exists invoice_lines_org_id_idx on invoice_lines (org_id);
create index if not exists invoice_lines_po_line_id_idx on invoice_lines (po_line_id);
create index if not exists invoices_po_id_idx on invoices (po_id);
create index if not exists invoices_registered_by_idx on invoices (registered_by);
create index if not exists member_invites_invited_by_idx on member_invites (invited_by);
create index if not exists member_invites_email_idx on member_invites (email) where accepted_at is null;
create index if not exists po_lines_org_id_idx on po_lines (org_id);
create index if not exists po_lines_po_id_idx on po_lines (po_id);
create index if not exists po_versions_org_id_idx on po_versions (org_id);
create index if not exists purchase_orders_vendor_id_idx on purchase_orders (vendor_id);
create index if not exists purchase_orders_requisition_id_idx on purchase_orders (requisition_id);
create index if not exists purchase_orders_rfq_id_idx on purchase_orders (rfq_id);
create index if not exists purchase_orders_budget_line_id_idx on purchase_orders (budget_line_id);
create index if not exists purchase_orders_created_by_idx on purchase_orders (created_by);
create index if not exists purchase_orders_approved_by_idx on purchase_orders (approved_by);
create index if not exists requisition_lines_org_id_idx on requisition_lines (org_id);
create index if not exists requisition_lines_requisition_id_idx on requisition_lines (requisition_id);
create index if not exists requisitions_budget_line_id_idx on requisitions (budget_line_id);
create index if not exists requisitions_department_id_idx on requisitions (department_id);
create index if not exists requisitions_project_id_idx on requisitions (project_id);
create index if not exists requisitions_donor_id_idx on requisitions (donor_id);
create index if not exists requisitions_requester_id_idx on requisitions (requester_id);
create index if not exists rfq_criteria_org_id_idx on rfq_criteria (org_id);
create index if not exists rfq_criteria_rfq_id_idx on rfq_criteria (rfq_id);
create index if not exists rfq_invites_org_id_idx on rfq_invites (org_id);
create index if not exists rfq_invites_vendor_id_idx on rfq_invites (vendor_id);
create index if not exists rfqs_requisition_id_idx on rfqs (requisition_id);
create index if not exists rfqs_award_vendor_id_idx on rfqs (award_vendor_id);
create index if not exists vendor_documents_org_id_idx on vendor_documents (org_id);
create index if not exists vendor_documents_vendor_id_idx on vendor_documents (vendor_id);
