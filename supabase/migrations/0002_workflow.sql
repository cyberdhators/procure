-- Workflow functions. Every state transition runs here, inside one
-- transaction that checks roles, enforces segregation of duties, mutates
-- state and appends the audit event. The app never updates workflow
-- tables directly.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function next_doc_number(p_org uuid, p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into doc_counters (org_id, doc_type, next_val) values (p_org, p_type, 2)
  on conflict (org_id, doc_type) do update set next_val = doc_counters.next_val + 1
  returning next_val - 1 into v;
  return p_type || '-' || lpad(v::text, 4, '0');
end;
$$;

create or replace function actor_label(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(title, ''), display_name) from members
  where org_id = p_org and user_id = auth.uid();
$$;

create or replace function log_event(
  p_org uuid, p_action text, p_record_type text, p_record_id uuid,
  p_record_label text, p_detail text
) returns void
language sql security definer set search_path = public as $$
  insert into audit_events (org_id, actor_id, actor_label, action, record_type, record_id, record_label, detail)
  values (p_org, auth.uid(), coalesce(actor_label(p_org), 'System'), p_action,
          p_record_type, p_record_id, p_record_label, p_detail);
$$;

create or replace function require_role(p_org uuid, p_role member_role) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(p_org, p_role) then
    raise exception 'You need the % role for this action', p_role using errcode = '42501';
  end if;
end;
$$;

create or replace function money_text(p_minor bigint) returns text
language sql immutable as $$
  select to_char(p_minor / 100.0, 'FM999,999,999,990.00');
$$;

-- ---------------------------------------------------------------------------
-- Approval routing
-- ---------------------------------------------------------------------------

-- The approval plan for a requisition with the given attributes. Used both to
-- preview the route on the form and to create approval steps on submit.
create or replace function route_plan(
  p_org uuid, p_total_minor bigint, p_category text,
  p_department uuid, p_project uuid, p_donor uuid
) returns table (level integer, label text, approver_title text, note text)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by r.level)::integer,
         r.label,
         replace(replace(r.approver_title,
           '{department_head}', coalesce((select head_title from departments where id = p_department), 'Head of Department')),
           '{project_manager}', coalesce((select manager_title from projects where id = p_project), 'Project Manager')),
         case when r.min_value_minor is not null
              then 'Required for values above USD ' || to_char(r.min_value_minor / 100, 'FM999,999,999') || '.'
              else 'Escalates to ' || r.escalate_to || ' after ' || r.escalate_after_days || ' days.' end
  from approval_rules r
  where r.org_id = p_org
    and is_member(p_org)
    and (r.min_value_minor is null or p_total_minor > r.min_value_minor)
    and (r.category is null or r.category = p_category)
    and (r.donor_id is null or r.donor_id = p_donor)
  order by r.level;
$$;

-- ---------------------------------------------------------------------------
-- Requisitions
-- ---------------------------------------------------------------------------

-- p_payload: {title, department_id, project_id, donor_id, category, required_by,
--             justification, lines: [{description, qty, unit, unit_cost_minor}]}
create or replace function save_requisition(p_org uuid, p_payload jsonb, p_submit boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_number text;
  v_total bigint;
  v_budget uuid;
  v_lines integer;
begin
  perform require_role(p_org, 'requester');

  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'Title is required';
  end if;
  v_lines := jsonb_array_length(coalesce(p_payload->'lines', '[]'));
  if p_submit and v_lines = 0 then
    raise exception 'Add at least one line item before submitting';
  end if;

  select id into v_budget from budget_lines
  where org_id = p_org
    and department_id is not distinct from nullif(p_payload->>'department_id', '')::uuid
    and project_id    is not distinct from nullif(p_payload->>'project_id', '')::uuid
    and donor_id      is not distinct from nullif(p_payload->>'donor_id', '')::uuid
  limit 1;

  v_number := next_doc_number(p_org, 'REQ');
  insert into requisitions (org_id, number, title, department_id, project_id, donor_id, budget_line_id,
                            category, required_by, justification, requester_id, requester_label)
  values (p_org, v_number, trim(p_payload->>'title'),
          nullif(p_payload->>'department_id', '')::uuid,
          nullif(p_payload->>'project_id', '')::uuid,
          nullif(p_payload->>'donor_id', '')::uuid,
          v_budget,
          coalesce(nullif(p_payload->>'category', ''), 'Goods'),
          nullif(p_payload->>'required_by', '')::date,
          coalesce(p_payload->>'justification', ''),
          auth.uid(), actor_label(p_org))
  returning id into v_id;

  insert into requisition_lines (org_id, requisition_id, line_no, description, qty, unit, unit_cost_minor)
  select p_org, v_id, ord::integer, l->>'description', (l->>'qty')::numeric,
         coalesce(nullif(l->>'unit', ''), 'each'), (l->>'unit_cost_minor')::bigint
  from jsonb_array_elements(coalesce(p_payload->'lines', '[]')) with ordinality as t(l, ord);

  select coalesce(sum(round(qty * unit_cost_minor)), 0) into v_total
  from requisition_lines where requisition_id = v_id;
  update requisitions set total_minor = v_total where id = v_id;

  perform log_event(p_org, 'Draft saved', 'requisition', v_id, v_number,
                    v_lines || ' line items, estimated USD ' || money_text(v_total) || '.');

  if p_submit then
    perform submit_requisition(v_id);
  end if;
  return v_id;
end;
$$;

create or replace function submit_requisition(p_req uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requisitions;
  v_steps integer;
  v_attachments integer;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  if r.requester_id is distinct from auth.uid() then
    raise exception 'Only the requester can submit this requisition';
  end if;
  if r.status not in ('draft', 'returned') then
    raise exception 'Requisition % is already %', r.number, r.status;
  end if;

  delete from approval_steps where requisition_id = p_req;
  insert into approval_steps (org_id, requisition_id, level, label, approver_title, note)
  select r.org_id, p_req, p.level, p.label, p.approver_title, p.note
  from route_plan(r.org_id, r.total_minor, r.category, r.department_id, r.project_id, r.donor_id) p;
  get diagnostics v_steps = row_count;

  if v_steps = 0 then
    raise exception 'No approval rule matches this requisition; ask an admin to configure routing';
  end if;

  update approval_steps set status = 'pending', activated_at = now()
  where requisition_id = p_req and level = 1;
  update requisitions set status = 'submitted', submitted_at = now() where id = p_req;

  select count(*) into v_attachments from attachments where record_type = 'requisition' and record_id = p_req;
  perform log_event(r.org_id, 'Submitted', 'requisition', p_req, r.number,
    (select count(*) from requisition_lines where requisition_id = p_req) || ' line items, '
    || v_attachments || ' attachments, estimated USD ' || money_text(r.total_minor) || '.');
end;
$$;

-- p_decision: 'approve' | 'return' | 'reject'
create or replace function decide_requisition(p_req uuid, p_decision text, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r requisitions;
  s approval_steps;
  v_total_levels integer;
  v_next integer;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  perform require_role(r.org_id, 'approver');

  -- Segregation of duties: nobody approves their own request.
  if r.requester_id = auth.uid() then
    raise exception 'Segregation of duties: you cannot decide on a requisition you raised';
  end if;
  if r.status <> 'submitted' then
    raise exception 'Requisition % is not awaiting approval', r.number;
  end if;
  if p_decision in ('return', 'reject') and coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment is required to % a requisition', p_decision;
  end if;

  select * into s from approval_steps where requisition_id = p_req and status = 'pending' for update;
  -- The same person may not approve two levels of one requisition.
  if exists (select 1 from approval_steps where requisition_id = p_req
             and acted_by = auth.uid() and status = 'approved') then
    raise exception 'Segregation of duties: you already approved an earlier level';
  end if;

  select count(*) into v_total_levels from approval_steps where requisition_id = p_req;

  update approval_steps
  set status = case p_decision when 'approve' then 'approved'::step_status
                               when 'return' then 'returned'::step_status
                               else 'rejected'::step_status end,
      acted_at = now(), acted_by = auth.uid(), acted_by_label = actor_label(r.org_id),
      comment = nullif(trim(p_comment), '')
  where id = s.id;

  if p_decision = 'approve' then
    select min(level) into v_next from approval_steps
    where requisition_id = p_req and status = 'waiting';
    if v_next is not null then
      update approval_steps set status = 'pending', activated_at = now()
      where requisition_id = p_req and level = v_next;
    else
      update requisitions set status = 'approved' where id = p_req;
      -- Commit the budget at final approval.
      update budget_lines set committed_minor = committed_minor + r.total_minor
      where id = r.budget_line_id;
    end if;
    perform log_event(r.org_id, 'Approved', 'requisition', p_req, r.number,
      'Level ' || s.level || ' of ' || v_total_levels ||
      coalesce('. Comment: ' || nullif(trim(p_comment), ''), '') || '.');
  elsif p_decision = 'return' then
    update requisitions set status = 'returned' where id = p_req;
    update approval_steps set status = 'skipped' where requisition_id = p_req and status = 'waiting';
    perform log_event(r.org_id, 'Returned', 'requisition', p_req, r.number,
      'Returned at level ' || s.level || '. ' || trim(p_comment));
  elsif p_decision = 'reject' then
    update requisitions set status = 'rejected' where id = p_req;
    update approval_steps set status = 'skipped' where requisition_id = p_req and status = 'waiting';
    perform log_event(r.org_id, 'Rejected', 'requisition', p_req, r.number,
      'Rejected at level ' || s.level || '. ' || trim(p_comment));
  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sourcing
-- ---------------------------------------------------------------------------

create or replace function answer_clarification(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare c clarifications; v_rfq text;
begin
  select * into c from clarifications where id = p_id for update;
  if c.id is null or not is_member(c.org_id) then raise exception 'Clarification not found'; end if;
  perform require_role(c.org_id, 'buyer');
  if coalesce(trim(p_answer), '') = '' then raise exception 'Answer cannot be empty'; end if;
  update clarifications set answer = trim(p_answer) where id = p_id;
  select number into v_rfq from rfqs where id = c.rfq_id;
  perform log_event(c.org_id, 'Clarification answered', 'rfq', c.rfq_id, v_rfq,
    'Response to ' || (select trading_name from vendors where id = c.vendor_id) || ' shared with all invited vendors.');
end;
$$;

-- p_decision: 'award' | 'split' | 'retender'
create or replace function recommend_award(p_rfq uuid, p_decision text, p_vendor uuid, p_justification text)
returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if p_decision not in ('award', 'split', 'retender') then raise exception 'Unknown decision'; end if;
  if coalesce(trim(p_justification), '') = '' then
    raise exception 'A justification is required; it is retained in the procurement file';
  end if;
  if p_decision = 'award' and p_vendor is null then raise exception 'Choose the vendor to award'; end if;
  if exists (select 1 from evaluators where rfq_id = p_rfq and not submitted) then
    raise exception 'All evaluation panel members must submit scores first';
  end if;

  update rfqs set status = 'awarded', award_decision = p_decision,
         award_vendor_id = case when p_decision = 'award' then p_vendor end,
         award_justification = trim(p_justification)
  where id = p_rfq;
  perform log_event(q.org_id, 'Award recommended', 'rfq', p_rfq, q.number,
    case p_decision when 'award' then 'Award to ' || (select trading_name from vendors where id = p_vendor)
                    when 'split' then 'Split award' else 'Re-tender' end || '.');
end;
$$;

create or replace function submit_evaluation(p_rfq uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs;
begin
  select * into q from rfqs where id = p_rfq;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  update evaluators set submitted = true where rfq_id = p_rfq and title = p_title;
  perform log_event(q.org_id, 'Scores submitted', 'rfq', p_rfq, q.number, p_title || ' submitted evaluation scores.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Goods receipt
-- ---------------------------------------------------------------------------

-- p_lines: [{po_line_id, received_qty, inspection}]
create or replace function save_goods_receipt(
  p_grn uuid, p_lines jsonb, p_checklist jsonb,
  p_disc_item text, p_disc_type text, p_disc_note text, p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  g goods_receipts;
  po purchase_orders;
  v_short integer;
  v_fully boolean;
begin
  select * into g from goods_receipts where id = p_grn for update;
  if g.id is null or not is_member(g.org_id) then raise exception 'Goods receipt not found'; end if;
  perform require_role(g.org_id, 'receiver');
  if g.status = 'accepted' then raise exception '% is already accepted and signed', g.number; end if;

  select * into po from purchase_orders where id = g.po_id for update;
  -- Segregation of duties: whoever raised the PO cannot receive against it.
  if po.created_by = auth.uid() then
    raise exception 'Segregation of duties: you raised % and cannot receive goods against it', po.number;
  end if;

  update grn_lines gl
  set received_qty = (l->>'received_qty')::numeric,
      inspection   = coalesce(nullif(l->>'inspection', ''), 'Passed')
  from jsonb_array_elements(p_lines) l
  where gl.grn_id = p_grn and gl.po_line_id = (l->>'po_line_id')::uuid;

  if exists (select 1 from grn_lines gl join po_lines pl on pl.id = gl.po_line_id
             where gl.grn_id = p_grn and gl.received_qty > pl.qty) then
    raise exception 'Received quantity cannot exceed the ordered quantity';
  end if;

  update goods_receipts
  set checklist = coalesce(p_checklist, '{}'),
      discrepancy_item = nullif(trim(p_disc_item), ''),
      discrepancy_type = nullif(trim(p_disc_type), ''),
      discrepancy_note = nullif(trim(p_disc_note), '')
  where id = p_grn;

  if not p_accept then
    perform log_event(g.org_id, 'Draft saved', 'goods_receipt', p_grn, g.number, 'Receipt against ' || po.number || ' saved as draft.');
    return;
  end if;

  update goods_receipts set status = 'accepted', accepted_at = now(), received_by = auth.uid() where id = p_grn;

  select count(*) into v_short from grn_lines where grn_id = p_grn and inspection <> 'Passed';
  select bool_and(coalesce(rec.qty, 0) >= pl.qty) into v_fully
  from po_lines pl
  left join (select gl.po_line_id, sum(gl.received_qty) qty
             from grn_lines gl join goods_receipts gr on gr.id = gl.grn_id
             where gr.po_id = po.id and gr.status = 'accepted' group by 1) rec on rec.po_line_id = pl.id
  where pl.po_id = po.id;

  update purchase_orders
  set status = case when v_fully then 'received'::po_status else 'partially_received'::po_status end,
      status_dates = status_dates || jsonb_build_object(
        case when v_fully then 'received' else 'partially_received' end, to_char(g.delivered_on, 'YYYY-MM-DD'))
  where id = po.id and status in ('issued', 'partially_received');

  perform log_event(g.org_id, 'Goods received', 'goods_receipt', p_grn, g.number,
    case when v_fully then 'Full receipt against ' else 'Partial receipt against ' end || po.number || '.'
    || case when v_short > 0 then ' ' || v_short || ' line(s) with discrepancies.' else '' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

-- p_resolution: 'credit_note' | 'partial_payment' | 'hold' | 'approve' | 'return_to_vendor'
create or replace function resolve_invoice(p_invoice uuid, p_resolution text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  i invoices;
  v_received_value bigint;
  v_status invoice_status;
  v_detail text;
begin
  select * into i from invoices where id = p_invoice for update;
  if i.id is null or not is_member(i.org_id) then raise exception 'Invoice not found'; end if;
  perform require_role(i.org_id, 'finance');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required; it is recorded in the audit trail';
  end if;
  if i.status in ('approved_for_payment', 'paid') then
    raise exception 'Invoice % is already approved for payment', i.number;
  end if;
  -- Segregation of duties: a receiver of these goods cannot approve the invoice.
  if p_resolution in ('approve', 'partial_payment') and exists (
       select 1 from goods_receipts where po_id = i.po_id and received_by = auth.uid()) then
    raise exception 'Segregation of duties: you received these goods and cannot approve the invoice';
  end if;

  select coalesce(sum(round(least(il.qty, coalesce(rec.qty, 0)) * il.unit_price_minor)), 0)
  into v_received_value
  from invoice_lines il
  left join (select gl.po_line_id, sum(gl.received_qty) qty
             from grn_lines gl join goods_receipts gr on gr.id = gl.grn_id
             where gr.po_id = i.po_id and gr.status = 'accepted' group by 1) rec on rec.po_line_id = il.po_line_id
  where il.invoice_id = p_invoice;

  case p_resolution
    when 'approve' then
      if i.status <> 'matched' then raise exception 'Only a fully matched invoice can be sent straight to finance approval'; end if;
      v_status := 'approved_for_payment'; v_detail := 'Sent to finance approval.';
    when 'partial_payment' then
      v_status := 'approved_for_payment';
      v_detail := 'Partial payment of USD ' || money_text(v_received_value) || ' authorised for received goods.';
    when 'credit_note' then
      v_status := 'exception'; v_detail := 'Credit note requested for undelivered quantities.';
    when 'hold' then
      v_status := 'exception'; v_detail := 'Held until goods receipt for outstanding items is recorded.';
    when 'return_to_vendor' then
      v_status := 'returned'; v_detail := 'Returned to vendor.';
    else raise exception 'Unknown resolution %', p_resolution;
  end case;

  update invoices set status = v_status, resolution = p_resolution, resolution_reason = trim(p_reason)
  where id = p_invoice;
  if v_status = 'approved_for_payment' then
    update purchase_orders set status = 'invoiced',
      status_dates = status_dates || jsonb_build_object('invoiced', to_char(now(), 'YYYY-MM-DD'))
    where id = i.po_id and status in ('received', 'partially_received');
  end if;
  perform log_event(i.org_id, 'Exception resolved', 'invoice', p_invoice, i.number, v_detail || ' Reason: ' || trim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------

create or replace function next_vendor_number(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(p_org, 'buyer');
  return next_doc_number(p_org, 'VND');
end;
$$;

create or replace function set_vendor_status(p_vendor uuid, p_status vendor_status) returns void
language plpgsql security definer set search_path = public as $$
declare v vendors;
begin
  select * into v from vendors where id = p_vendor for update;
  if v.id is null or not is_member(v.org_id) then raise exception 'Vendor not found'; end if;
  perform require_role(v.org_id, 'admin');
  update vendors set status = p_status where id = p_vendor;
  perform log_event(v.org_id, 'Vendor ' || p_status, 'vendor', p_vendor, v.number,
    v.trading_name || ' moved from ' || v.status || ' to ' || p_status || '.');
end;
$$;

-- Log vendors created directly through the table API.
create or replace function vendors_audit_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.org_id, 'Vendor registered', 'vendor', new.id, new.number, new.legal_name || ', pending approval.');
  return new;
end;
$$;
create trigger vendors_after_insert after insert on vendors
  for each row when (new.status = 'pending') execute function vendors_audit_insert();

-- ---------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------

-- Default routing used by every new org: line manager, budget holder, and
-- finance review above USD 10,000.
create or replace function install_default_rules(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into approval_rules (org_id, level, label, approver_title, min_value_minor) values
    (p_org, 1, 'Line manager', '{department_head}', null),
    (p_org, 2, 'Budget holder', '{project_manager}', null),
    (p_org, 3, 'Finance review', 'Finance Officer', 1000000);
$$;

create or replace function create_org(p_name text, p_display_name text, p_title text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into orgs (name) values (trim(p_name)) returning id into v_org;
  insert into members (org_id, user_id, display_name, title, roles)
  values (v_org, auth.uid(), trim(p_display_name), coalesce(trim(p_title), ''),
          '{requester,approver,buyer,receiver,finance,admin}');
  perform install_default_rules(v_org);
  perform log_event(v_org, 'Organisation created', 'org', v_org, trim(p_name), 'Created by ' || trim(p_display_name) || '.');
  return v_org;
end;
$$;

-- Lock the workflow functions down to signed-in users.
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
-- Internal helpers must not be callable directly: they would let a user forge
-- audit events, burn document numbers or rewrite another org's routing.
revoke execute on function log_event, next_doc_number, install_default_rules from authenticated;
