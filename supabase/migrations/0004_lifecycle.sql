-- Production hardening and the full procurement lifecycle.
--
-- Fixes from the audit:
--   * approval steps now require a specific role (finance review needs 'finance')
--   * requisitions must reference the caller's own org data and a budget line
--   * final approval is blocked when the budget line lacks funds
--   * goods receipts cannot exceed the ordered quantity across all receipts
--   * duplicate supplier invoice numbers are caught across all of a vendor's POs
--   * reference data, budgets, members and vendor documents change only through
--     audited functions (direct table writes removed)
--   * one organisation per user (the UI supports one), blocking demo-org spam
-- New lifecycle steps: member invites, RFQ creation/invites/bids/closing,
-- purchase orders (from award or direct), PO approval and issue, goods receipt
-- creation, invoice registration and matching, payment.

-- ---------------------------------------------------------------------------
-- Schema changes
-- ---------------------------------------------------------------------------

alter table orgs add column direct_po_limit_minor bigint not null default 100000;   -- USD 1,000
alter table orgs add column po_tolerance_pct integer not null default 10;
alter table orgs add column min_rfq_vendors integer not null default 3;

alter table approval_rules add column required_role member_role not null default 'approver';
alter table approval_steps add column required_role member_role not null default 'approver';
update approval_rules set required_role = 'finance' where approver_title = 'Finance Officer';
update approval_steps set required_role = 'finance' where approver_title = 'Finance Officer';

alter table purchase_orders add column approved_by uuid references auth.users(id);
alter table invoices add column approved_amount_minor bigint;
alter table invoices add column paid_on date;
alter table invoices add column payment_reference text;
alter table invoices add column registered_by uuid references auth.users(id);
alter table goods_receipts add column created_by uuid references auth.users(id);

create table member_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  email       text not null,
  display_name text not null,
  title       text not null default '',
  roles       member_role[] not null,
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);
alter table member_invites enable row level security;
create policy member_invites_read on member_invites for select using (has_role(org_id, 'admin'));

-- Writes to these tables now go only through the audited functions below.
drop policy if exists members_admin on members;
drop policy if exists vendor_documents_write on vendor_documents;
do $$
declare t text;
begin
  foreach t in array array['departments','projects','donors','budget_lines','approval_rules'] loop
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function assert_in_org(p_org uuid, p_table regclass, p_id uuid, p_what text) returns void
language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  if p_id is null then return; end if;
  execute format('select exists (select 1 from %s where id = $1 and org_id = $2)', p_table) into ok using p_id, p_org;
  if not ok then raise exception '% not found in this organisation', p_what; end if;
end;
$$;

create or replace function po_total(p_po uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(qty * unit_price_minor)), 0)::bigint from po_lines where po_id = p_po;
$$;

create or replace function received_qty(p_po_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(gl.received_qty), 0) from grn_lines gl
  join goods_receipts g on g.id = gl.grn_id
  where gl.po_line_id = p_po_line and g.status = 'accepted';
$$;

-- ---------------------------------------------------------------------------
-- Organisations: one per user
-- ---------------------------------------------------------------------------

create or replace function assert_no_membership() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'You already belong to an organisation';
  end if;
end;
$$;

create or replace function create_org(p_name text, p_display_name text, p_title text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  perform assert_no_membership();
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter an organisation name'; end if;
  insert into orgs (name) values (trim(p_name)) returning id into v_org;
  insert into members (org_id, user_id, display_name, title, roles)
  values (v_org, auth.uid(), trim(p_display_name), coalesce(trim(p_title), ''),
          '{requester,approver,buyer,receiver,finance,admin}');
  perform install_default_rules(v_org);
  perform log_event(v_org, 'Organisation created', 'org', v_org, trim(p_name), 'Created by ' || trim(p_display_name) || '.');
  return v_org;
end;
$$;

create or replace function install_default_rules(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into approval_rules (org_id, level, label, approver_title, min_value_minor, required_role) values
    (p_org, 1, 'Line manager', '{department_head}', null, 'approver'),
    (p_org, 2, 'Budget holder', '{project_manager}', null, 'approver'),
    (p_org, 3, 'Finance review', 'Finance Officer', 1000000, 'finance');
$$;

-- ---------------------------------------------------------------------------
-- Members and invitations
-- ---------------------------------------------------------------------------

create or replace function invite_member(p_org uuid, p_email text, p_display_name text, p_title text, p_roles member_role[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  perform require_role(p_org, 'admin');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if coalesce(array_length(p_roles, 1), 0) = 0 then raise exception 'Choose at least one role'; end if;
  if exists (select 1 from members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception '% is already a member', v_email;
  end if;
  insert into member_invites (org_id, email, display_name, title, roles, invited_by)
  values (p_org, v_email, trim(p_display_name), coalesce(trim(p_title), ''), p_roles, auth.uid())
  on conflict (org_id, email) do update
    set display_name = excluded.display_name, title = excluded.title, roles = excluded.roles,
        invited_by = excluded.invited_by, created_at = now(), accepted_at = null;
  perform log_event(p_org, 'Member invited', 'member', null, v_email,
    'Roles: ' || array_to_string(p_roles, ', ') || '.');
end;
$$;

-- Joins the caller to the organisation that invited their email address.
create or replace function accept_invite() returns uuid
language plpgsql security definer set search_path = public as $$
declare i member_invites; v_email text;
begin
  if auth.uid() is null then return null; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into i from member_invites where email = v_email and accepted_at is null
  order by created_at desc limit 1;
  if i.id is null then return null; end if;
  insert into members (org_id, user_id, display_name, title, roles)
  values (i.org_id, auth.uid(), i.display_name, i.title, i.roles);
  update member_invites set accepted_at = now() where id = i.id;
  perform log_event(i.org_id, 'Member joined', 'member', null, i.display_name,
    'Accepted invitation as ' || coalesce(nullif(i.title, ''), 'member') || '.');
  return i.org_id;
end;
$$;

create or replace function set_member_roles(p_org uuid, p_user uuid, p_title text, p_roles member_role[])
returns void
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  perform require_role(p_org, 'admin');
  select * into m from members where org_id = p_org and user_id = p_user for update;
  if m.user_id is null then raise exception 'Member not found'; end if;
  if 'admin' = any(m.roles) and not ('admin' = any(p_roles))
     and (select count(*) from members where org_id = p_org and 'admin' = any(roles)) = 1 then
    raise exception 'An organisation needs at least one administrator';
  end if;
  update members set roles = p_roles, title = coalesce(trim(p_title), title) where org_id = p_org and user_id = p_user;
  perform log_event(p_org, 'Permission changed', 'member', null, 'User: ' || m.display_name,
    'Roles ' || array_to_string(m.roles, ', ') || ' → ' || array_to_string(p_roles, ', ') || '.');
end;
$$;

create or replace function remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  perform require_role(p_org, 'admin');
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  delete from members where org_id = p_org and user_id = p_user returning * into m;
  if m.user_id is null then raise exception 'Member not found'; end if;
  perform log_event(p_org, 'Member removed', 'member', null, 'User: ' || m.display_name, 'Access revoked.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference data and budgets
-- ---------------------------------------------------------------------------

create or replace function add_reference(p_org uuid, p_kind text, p_name text, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := trim(p_name);
begin
  perform require_role(p_org, 'admin');
  if coalesce(v_name, '') = '' then raise exception 'Enter a name'; end if;
  case p_kind
    when 'department' then
      insert into departments (org_id, name, head_title) values (p_org, v_name, coalesce(nullif(trim(p_title), ''), 'Head of ' || v_name)) returning id into v_id;
    when 'project' then
      insert into projects (org_id, name, manager_title) values (p_org, v_name, coalesce(nullif(trim(p_title), ''), v_name || ' Manager')) returning id into v_id;
    when 'donor' then
      insert into donors (org_id, name) values (p_org, v_name) returning id into v_id;
    else raise exception 'Unknown reference type %', p_kind;
  end case;
  perform log_event(p_org, 'Reference data added', p_kind, v_id, v_name, initcap(p_kind) || ' created.');
  return v_id;
exception when unique_violation then
  raise exception '% "%" already exists', initcap(p_kind), v_name;
end;
$$;

create or replace function add_budget_line(p_org uuid, p_code text, p_department uuid, p_project uuid, p_donor uuid, p_amount_minor bigint)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_role(p_org, 'admin');
  if coalesce(trim(p_code), '') = '' then raise exception 'Enter a budget code'; end if;
  if p_department is null or p_donor is null then raise exception 'Choose a department and a donor'; end if;
  if p_amount_minor is null or p_amount_minor < 0 then raise exception 'Enter a valid amount'; end if;
  perform assert_in_org(p_org, 'departments', p_department, 'Department');
  perform assert_in_org(p_org, 'projects', p_project, 'Project');
  perform assert_in_org(p_org, 'donors', p_donor, 'Donor');
  if exists (select 1 from budget_lines where org_id = p_org and department_id = p_department
             and project_id is not distinct from p_project and donor_id = p_donor) then
    raise exception 'A budget line already exists for this department, project and donor';
  end if;
  insert into budget_lines (org_id, code, department_id, project_id, donor_id, amount_minor)
  values (p_org, upper(trim(p_code)), p_department, p_project, p_donor, p_amount_minor) returning id into v_id;
  perform log_event(p_org, 'Budget line added', 'budget_line', v_id, upper(trim(p_code)), 'Amount USD ' || money_text(p_amount_minor) || '.');
  return v_id;
exception when unique_violation then
  raise exception 'Budget code % already exists', upper(trim(p_code));
end;
$$;

create or replace function set_budget_amount(p_line uuid, p_amount_minor bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b budget_lines;
begin
  select * into b from budget_lines where id = p_line for update;
  if b.id is null or not is_member(b.org_id) then raise exception 'Budget line not found'; end if;
  perform require_role(b.org_id, 'admin');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for budget changes'; end if;
  if p_amount_minor < b.committed_minor then
    raise exception 'Amount cannot be below the USD % already committed', money_text(b.committed_minor);
  end if;
  update budget_lines set amount_minor = p_amount_minor where id = p_line;
  perform log_event(b.org_id, 'Budget revised', 'budget_line', p_line, b.code,
    'USD ' || money_text(b.amount_minor) || ' → USD ' || money_text(p_amount_minor) || '. Reason: ' || trim(p_reason));
end;
$$;

create or replace function add_approval_rule(p_org uuid, p_label text, p_approver_title text,
  p_required_role member_role, p_min_value_minor bigint, p_category text) returns void
language plpgsql security definer set search_path = public as $$
declare v_level integer;
begin
  perform require_role(p_org, 'admin');
  if coalesce(trim(p_label), '') = '' or coalesce(trim(p_approver_title), '') = '' then
    raise exception 'Enter a label and an approver title';
  end if;
  select coalesce(max(level), 0) + 1 into v_level from approval_rules where org_id = p_org;
  insert into approval_rules (org_id, level, label, approver_title, required_role, min_value_minor, category)
  values (p_org, v_level, trim(p_label), trim(p_approver_title), p_required_role, p_min_value_minor, nullif(trim(p_category), ''));
  perform log_event(p_org, 'Routing rule added', 'org', p_org, trim(p_label),
    'Level ' || v_level || ', ' || p_required_role || coalesce(', above USD ' || money_text(p_min_value_minor), '') || '.');
end;
$$;

create or replace function delete_approval_rule(p_rule uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_rules;
begin
  select * into r from approval_rules where id = p_rule;
  if r.id is null or not is_member(r.org_id) then raise exception 'Rule not found'; end if;
  perform require_role(r.org_id, 'admin');
  delete from approval_rules where id = p_rule;
  -- Keep levels contiguous.
  update approval_rules a set level = s.n
  from (select id, row_number() over (order by level) n from approval_rules where org_id = r.org_id) s
  where a.id = s.id;
  perform log_event(r.org_id, 'Routing rule removed', 'org', r.org_id, r.label, 'Applies to requisitions submitted from now on.');
end;
$$;

create or replace function set_org_controls(p_org uuid, p_direct_po_limit_minor bigint, p_tolerance_pct integer, p_min_vendors integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(p_org, 'admin');
  if p_direct_po_limit_minor < 0 or p_tolerance_pct not between 0 and 50 or p_min_vendors not between 1 and 10 then
    raise exception 'Values out of range';
  end if;
  update orgs set direct_po_limit_minor = p_direct_po_limit_minor, po_tolerance_pct = p_tolerance_pct,
                  min_rfq_vendors = p_min_vendors where id = p_org;
  perform log_event(p_org, 'Controls changed', 'org', p_org, 'Procurement controls',
    'Direct PO limit USD ' || money_text(p_direct_po_limit_minor) || ', PO tolerance ' || p_tolerance_pct
    || '%, minimum RFQ vendors ' || p_min_vendors || '.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Vendor documents
-- ---------------------------------------------------------------------------

create or replace function add_vendor_document(p_vendor uuid, p_name text, p_expires_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v vendors;
begin
  select * into v from vendors where id = p_vendor;
  if v.id is null or not is_member(v.org_id) then raise exception 'Vendor not found'; end if;
  perform require_role(v.org_id, 'buyer');
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the document name'; end if;
  insert into vendor_documents (org_id, vendor_id, name, expires_on) values (v.org_id, p_vendor, trim(p_name), p_expires_on);
  perform log_event(v.org_id, 'Document uploaded', 'vendor', p_vendor, v.number,
    trim(p_name) || coalesce(', valid to ' || to_char(p_expires_on, 'DD Mon YYYY'), ', no expiry') || '.');
end;
$$;

create or replace function vendor_has_expired_docs(p_vendor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vendor_documents where vendor_id = p_vendor and expires_on < current_date);
$$;

-- ---------------------------------------------------------------------------
-- Requisitions: role-bound routing, org validation, budget control
-- ---------------------------------------------------------------------------

drop function if exists route_plan(uuid, bigint, text, uuid, uuid, uuid);
create function route_plan(
  p_org uuid, p_total_minor bigint, p_category text,
  p_department uuid, p_project uuid, p_donor uuid
) returns table (level integer, label text, approver_title text, note text, required_role member_role)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by r.level)::integer,
         r.label,
         replace(replace(r.approver_title,
           '{department_head}', coalesce((select head_title from departments where id = p_department and org_id = p_org), 'Head of Department')),
           '{project_manager}', coalesce((select manager_title from projects where id = p_project and org_id = p_org), 'Budget Holder')),
         case when r.min_value_minor is not null
              then 'Required for values above USD ' || to_char(r.min_value_minor / 100, 'FM999,999,999') || '.'
              else 'Escalates to ' || r.escalate_to || ' after ' || r.escalate_after_days || ' days.' end,
         r.required_role
  from approval_rules r
  where r.org_id = p_org
    and is_member(p_org)
    and (r.min_value_minor is null or p_total_minor > r.min_value_minor)
    and (r.category is null or r.category = p_category)
    and (r.donor_id is null or r.donor_id = p_donor)
  order by r.level;
$$;
revoke execute on function route_plan from anon, public;

create or replace function save_requisition(p_org uuid, p_payload jsonb, p_submit boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_number text; v_total bigint; v_budget uuid; v_lines integer;
  v_dept uuid := nullif(p_payload->>'department_id', '')::uuid;
  v_project uuid := nullif(p_payload->>'project_id', '')::uuid;
  v_donor uuid := nullif(p_payload->>'donor_id', '')::uuid;
begin
  perform require_role(p_org, 'requester');
  perform assert_in_org(p_org, 'departments', v_dept, 'Department');
  perform assert_in_org(p_org, 'projects', v_project, 'Project');
  perform assert_in_org(p_org, 'donors', v_donor, 'Donor');

  if coalesce(trim(p_payload->>'title'), '') = '' then raise exception 'Title is required'; end if;
  v_lines := jsonb_array_length(coalesce(p_payload->'lines', '[]'));
  if p_submit and v_lines = 0 then raise exception 'Add at least one line item before submitting'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payload->'lines', '[]')) l
             where coalesce((l->>'qty')::numeric, 0) <= 0 or coalesce((l->>'unit_cost_minor')::bigint, -1) < 0
                or coalesce(trim(l->>'description'), '') = '') then
    raise exception 'Every line needs a description, a positive quantity and a unit cost';
  end if;

  select id into v_budget from budget_lines
  where org_id = p_org and department_id is not distinct from v_dept
    and project_id is not distinct from v_project and donor_id is not distinct from v_donor
  limit 1;

  v_number := next_doc_number(p_org, 'REQ');
  insert into requisitions (org_id, number, title, department_id, project_id, donor_id, budget_line_id,
                            category, required_by, justification, requester_id, requester_label)
  values (p_org, v_number, trim(p_payload->>'title'), v_dept, v_project, v_donor, v_budget,
          coalesce(nullif(p_payload->>'category', ''), 'Goods'),
          nullif(p_payload->>'required_by', '')::date,
          coalesce(p_payload->>'justification', ''),
          auth.uid(), actor_label(p_org))
  returning id into v_id;

  insert into requisition_lines (org_id, requisition_id, line_no, description, qty, unit, unit_cost_minor)
  select p_org, v_id, ord::integer, trim(l->>'description'), (l->>'qty')::numeric,
         coalesce(nullif(l->>'unit', ''), 'each'), (l->>'unit_cost_minor')::bigint
  from jsonb_array_elements(coalesce(p_payload->'lines', '[]')) with ordinality as t(l, ord);

  select coalesce(sum(round(qty * unit_cost_minor)), 0) into v_total from requisition_lines where requisition_id = v_id;
  update requisitions set total_minor = v_total where id = v_id;

  perform log_event(p_org, 'Draft saved', 'requisition', v_id, v_number,
                    v_lines || ' line items, estimated USD ' || money_text(v_total) || '.');
  if p_submit then perform submit_requisition(v_id); end if;
  return v_id;
end;
$$;

create or replace function submit_requisition(p_req uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r requisitions; v_steps integer; v_attachments integer;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  if r.requester_id is distinct from auth.uid() then raise exception 'Only the requester can submit this requisition'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'Requisition % is already %', r.number, r.status; end if;
  if r.total_minor <= 0 then raise exception 'Add at least one priced line item before submitting'; end if;
  if r.budget_line_id is null then
    raise exception 'No budget line exists for this department, project and donor. Ask an administrator to add one.';
  end if;

  -- Keep the history of earlier rounds; only clear steps that never acted.
  -- Earlier rounds are archived at level >= 1000 (round n at n*1000 + level).
  delete from approval_steps where requisition_id = p_req and acted_at is null;
  update approval_steps
  set level = level + (select (coalesce(max(level), 0) / 1000 + 1) * 1000 from approval_steps where requisition_id = p_req)
  where requisition_id = p_req and level < 1000;
  insert into approval_steps (org_id, requisition_id, level, label, approver_title, note, required_role)
  select r.org_id, p_req, p.level, p.label, p.approver_title, p.note, p.required_role
  from route_plan(r.org_id, r.total_minor, r.category, r.department_id, r.project_id, r.donor_id) p;
  get diagnostics v_steps = row_count;
  if v_steps = 0 then raise exception 'No approval rule matches this requisition; ask an admin to configure routing'; end if;

  update approval_steps set status = 'pending', activated_at = now() where requisition_id = p_req and level = 1;
  update requisitions set status = 'submitted', submitted_at = now() where id = p_req;

  select count(*) into v_attachments from attachments where record_type = 'requisition' and record_id = p_req;
  perform log_event(r.org_id, case when r.status = 'returned' then 'Resubmitted' else 'Submitted' end, 'requisition', p_req, r.number,
    (select count(*) from requisition_lines where requisition_id = p_req) || ' line items, '
    || v_attachments || ' attachments, estimated USD ' || money_text(r.total_minor) || '.');
end;
$$;

create or replace function decide_requisition(p_req uuid, p_decision text, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r requisitions; s approval_steps; b budget_lines; v_total_levels integer; v_next integer;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  if r.status <> 'submitted' then raise exception 'Requisition % is not awaiting approval', r.number; end if;

  select * into s from approval_steps where requisition_id = p_req and status = 'pending' for update;
  perform require_role(r.org_id, s.required_role);
  if r.requester_id = auth.uid() then
    raise exception 'Segregation of duties: you cannot decide on a requisition you raised';
  end if;
  if exists (select 1 from approval_steps where requisition_id = p_req and level < 1000
             and acted_by = auth.uid() and status = 'approved') then
    raise exception 'Segregation of duties: you already approved an earlier level';
  end if;
  if p_decision in ('return', 'reject') and coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment is required to % a requisition', p_decision;
  end if;

  select count(*) into v_total_levels from approval_steps where requisition_id = p_req and level < 1000;

  if p_decision = 'approve' then
    select min(level) into v_next from approval_steps where requisition_id = p_req and status = 'waiting';
    if v_next is null then
      -- Final approval commits the budget; block when funds are insufficient.
      select * into b from budget_lines where id = r.budget_line_id for update;
      if b.id is null then raise exception 'Requisition has no budget line'; end if;
      if b.amount_minor - b.committed_minor < r.total_minor then
        raise exception 'Insufficient budget on %: USD % available, USD % requested',
          b.code, money_text(b.amount_minor - b.committed_minor), money_text(r.total_minor);
      end if;
    end if;
  end if;

  update approval_steps
  set status = case p_decision when 'approve' then 'approved'::step_status
                               when 'return' then 'returned'::step_status
                               when 'reject' then 'rejected'::step_status end,
      acted_at = now(), acted_by = auth.uid(), acted_by_label = actor_label(r.org_id),
      comment = nullif(trim(p_comment), '')
  where id = s.id;

  if p_decision = 'approve' then
    if v_next is not null then
      update approval_steps set status = 'pending', activated_at = now() where requisition_id = p_req and level = v_next;
    else
      update requisitions set status = 'approved' where id = p_req;
      update budget_lines set committed_minor = committed_minor + r.total_minor where id = r.budget_line_id;
    end if;
    perform log_event(r.org_id, 'Approved', 'requisition', p_req, r.number,
      'Level ' || s.level || ' of ' || v_total_levels || coalesce('. Comment: ' || nullif(trim(p_comment), ''), '') || '.');
  elsif p_decision in ('return', 'reject') then
    update requisitions set status = case p_decision when 'return' then 'returned'::requisition_status else 'rejected'::requisition_status end
    where id = p_req;
    update approval_steps set status = 'skipped' where requisition_id = p_req and status = 'waiting';
    perform log_event(r.org_id, initcap(p_decision) || 'ed', 'requisition', p_req, r.number,
      initcap(p_decision) || 'ed at level ' || s.level || '. ' || trim(p_comment));
  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end;
$$;

-- Demo seeding uses the new route_plan shape.
create or replace function _demo_req(
  p_org uuid, p_number text, p_title text, p_dept text, p_project text, p_donor text,
  p_category text, p_required_in_days integer, p_justification text, p_requester text,
  p_submitted_days_ago integer, p_level_now integer, p_status requisition_status, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_dept uuid; v_project uuid; v_donor uuid; v_total bigint; v_sub timestamptz;
begin
  select id into v_dept from departments where org_id = p_org and name = p_dept;
  select id into v_project from projects where org_id = p_org and name = p_project;
  select id into v_donor from donors where org_id = p_org and name = p_donor;
  v_sub := now() - make_interval(days => p_submitted_days_ago, hours => 3);

  insert into requisitions (org_id, number, title, status, department_id, project_id, donor_id, budget_line_id,
                            category, required_by, justification, requester_label, submitted_at, created_at)
  values (p_org, p_number, p_title, p_status, v_dept, v_project, v_donor,
          (select id from budget_lines where org_id = p_org and department_id = v_dept
             and project_id is not distinct from v_project and donor_id = v_donor limit 1),
          p_category, current_date + p_required_in_days, p_justification, p_requester, v_sub, v_sub - interval '1 day')
  returning id into v_id;

  insert into requisition_lines (org_id, requisition_id, line_no, description, qty, unit, unit_cost_minor)
  select p_org, v_id, ord::integer, l->>0, (l->>1)::numeric, coalesce(l->>3, 'each'), (l->>2)::bigint
  from jsonb_array_elements(p_lines) with ordinality t(l, ord);

  select sum(round(qty * unit_cost_minor)) into v_total from requisition_lines where requisition_id = v_id;
  update requisitions set total_minor = v_total where id = v_id;

  insert into approval_steps (org_id, requisition_id, level, label, approver_title, note, required_role, status,
                              activated_at, acted_at, acted_by_label, comment)
  select p_org, v_id, p.level, p.label, p.approver_title, p.note, p.required_role,
         case when p_status = 'approved' or p.level < p_level_now then 'approved'::step_status
              when p.level = p_level_now then 'pending'::step_status else 'waiting'::step_status end,
         case when p.level <= p_level_now or p_status = 'approved' then v_sub + make_interval(days => p.level - 1) end,
         case when p_status = 'approved' or p.level < p_level_now then v_sub + make_interval(days => p.level) end,
         case when p_status = 'approved' or p.level < p_level_now then p.approver_title end,
         case when p_number = 'REQ-0142' and p.level = 1 then 'Quantities consistent with distribution plan.' end
  from route_plan(p_org, v_total, p_category, v_dept, v_project, v_donor) p;
  return v_id;
end;
$$;
revoke execute on function _demo_req from anon, public, authenticated;

-- create_demo_org is defined in 0003; add the one-org guard in front of it.
alter function create_demo_org(text) rename to _create_demo_org_unguarded;
revoke execute on function _create_demo_org_unguarded from anon, public, authenticated;
create function create_demo_org(p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform assert_no_membership();
  return _create_demo_org_unguarded(p_display_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sourcing
-- ---------------------------------------------------------------------------

create or replace function assert_not_sourced(p_req uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from rfqs where requisition_id = p_req and status <> 'cancelled')
     or exists (select 1 from purchase_orders where requisition_id = p_req and status <> 'cancelled') then
    raise exception 'This requisition is already being sourced';
  end if;
end;
$$;

create or replace function create_rfq(p_req uuid, p_closes_at timestamptz, p_location text, p_terms text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r requisitions; v_id uuid; v_number text;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  perform require_role(r.org_id, 'buyer');
  if r.status <> 'approved' then raise exception 'Only approved requisitions can be sourced'; end if;
  perform assert_not_sourced(p_req);
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Closing date must be in the future'; end if;

  v_number := next_doc_number(r.org_id, 'RFQ');
  insert into rfqs (org_id, number, requisition_id, title, status, closes_at, delivery_location, terms)
  values (r.org_id, v_number, p_req, r.title, 'draft', p_closes_at, coalesce(trim(p_location), ''), coalesce(trim(p_terms), ''))
  returning id into v_id;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight, is_price) values
    (r.org_id, v_id, 1, 'Total price', 'Financial', 40, true),
    (r.org_id, v_id, 2, 'Compliance with specifications', 'Technical', 25, false),
    (r.org_id, v_id, 3, 'Delivery lead time', 'Technical', 15, false),
    (r.org_id, v_id, 4, 'Vendor past performance', 'Non-financial', 10, false),
    (r.org_id, v_id, 5, 'Validity of licences and documents', 'Compliance', 10, false);
  insert into evaluators (org_id, rfq_id, title, submitted) values
    (r.org_id, v_id, 'Procurement Officer', false), (r.org_id, v_id, 'Technical Lead', false), (r.org_id, v_id, 'Finance Officer', false);
  perform log_event(r.org_id, 'RFQ created', 'rfq', v_id, v_number, 'Created from ' || r.number || '.');
  return v_id;
end;
$$;

create or replace function invite_vendor(p_rfq uuid, p_vendor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs; v vendors;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status not in ('draft', 'open') then raise exception 'Vendors can only be invited before bids close'; end if;
  select * into v from vendors where id = p_vendor and org_id = q.org_id;
  if v.id is null then raise exception 'Vendor not found'; end if;
  if v.status <> 'approved' then raise exception '% is not an approved vendor', v.trading_name; end if;
  if vendor_has_expired_docs(p_vendor) then raise exception '% has expired documents', v.trading_name; end if;
  insert into rfq_invites (org_id, rfq_id, vendor_id) values (q.org_id, p_rfq, p_vendor)
  on conflict do nothing;
  perform log_event(q.org_id, 'Vendor invited', 'rfq', p_rfq, q.number, v.trading_name || '.');
end;
$$;

create or replace function open_rfq(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs; v_min integer; v_count integer;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status <> 'draft' then raise exception 'RFQ is already %', q.status; end if;
  select min_rfq_vendors into v_min from orgs where id = q.org_id;
  select count(*) into v_count from rfq_invites where rfq_id = p_rfq;
  if v_count < v_min then raise exception 'Invite at least % vendors (currently %)', v_min, v_count; end if;
  if q.closes_at <= now() then raise exception 'Closing date has passed; set a new one'; end if;
  update rfqs set status = 'open' where id = p_rfq;
  perform log_event(q.org_id, 'RFQ opened', 'rfq', p_rfq, q.number, v_count || ' vendors invited. Closes ' || to_char(q.closes_at, 'DD Mon YYYY HH24:MI') || ' UTC.');
end;
$$;

-- p_scores: {criterion_id: {"score": n, "note": "..."}} for non-price criteria.
create or replace function record_bid(p_rfq uuid, p_vendor uuid, p_total_minor bigint, p_validity_days integer, p_scores jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs; v_bid uuid; c rfq_criteria; v_score numeric;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status not in ('open', 'evaluation') then raise exception 'Bids can only be recorded once the RFQ is open'; end if;
  if not exists (select 1 from rfq_invites where rfq_id = p_rfq and vendor_id = p_vendor) then
    raise exception 'Only invited vendors can bid';
  end if;
  if p_total_minor is null or p_total_minor <= 0 then raise exception 'Enter the quoted total'; end if;
  if p_validity_days is null or p_validity_days <= 0 then raise exception 'Enter the quotation validity in days'; end if;

  insert into bids (org_id, rfq_id, vendor_id, total_minor, validity_days)
  values (q.org_id, p_rfq, p_vendor, p_total_minor, p_validity_days)
  on conflict (rfq_id, vendor_id) do update set total_minor = excluded.total_minor,
    validity_days = excluded.validity_days, submitted_at = now()
  returning id into v_bid;

  for c in select * from rfq_criteria where rfq_id = p_rfq and not is_price loop
    v_score := nullif(p_scores->(c.id::text)->>'score', '')::numeric;
    if v_score is null or v_score < 0 or v_score > c.weight then
      raise exception 'Score for "%" must be between 0 and %', c.name, c.weight;
    end if;
    insert into bid_scores (org_id, bid_id, criterion_id, score, note)
    values (q.org_id, v_bid, c.id, v_score, coalesce(p_scores->(c.id::text)->>'note', ''))
    on conflict (bid_id, criterion_id) do update set score = excluded.score, note = excluded.note;
  end loop;

  update rfq_invites set status = 'Bid received' where rfq_id = p_rfq and vendor_id = p_vendor;
  perform log_event(q.org_id, 'Bid recorded', 'rfq', p_rfq, q.number,
    (select trading_name from vendors where id = p_vendor) || ', USD ' || money_text(p_total_minor) || '.');
end;
$$;

create or replace function close_rfq(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs; v_bids integer; v_invites integer;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status <> 'open' then raise exception 'RFQ is not open'; end if;
  select count(*) into v_bids from bids where rfq_id = p_rfq;
  select count(*) into v_invites from rfq_invites where rfq_id = p_rfq;
  -- Sealed bidding: no early close unless every invited vendor has bid.
  if now() < q.closes_at and v_bids < v_invites then
    raise exception 'Bidding closes %; it can only close early once every invited vendor has bid',
      to_char(q.closes_at, 'DD Mon YYYY HH24:MI') || ' UTC';
  end if;
  if v_bids = 0 then raise exception 'No bids were received; cancel or re-tender'; end if;
  update rfqs set status = 'evaluation' where id = p_rfq;
  perform log_event(q.org_id, 'Bidding closed', 'rfq', p_rfq, q.number, v_bids || ' of ' || v_invites || ' invited vendors bid.');
end;
$$;

create or replace function submit_evaluation(p_rfq uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs;
begin
  select * into q from rfqs where id = p_rfq;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  if q.status <> 'evaluation' then raise exception 'Scores can only be submitted during evaluation'; end if;
  update evaluators set submitted = true where rfq_id = p_rfq and title = p_title;
  if not found then raise exception 'Evaluator not on this panel'; end if;
  perform log_event(q.org_id, 'Scores submitted', 'rfq', p_rfq, q.number, p_title || ' submitted evaluation scores.');
end;
$$;

create or replace function recommend_award(p_rfq uuid, p_decision text, p_vendor uuid, p_justification text)
returns void
language plpgsql security definer set search_path = public as $$
declare q rfqs;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status <> 'evaluation' then raise exception 'Awards can only be made after bidding closes'; end if;
  if p_decision not in ('award', 'split', 'retender') then raise exception 'Unknown decision'; end if;
  if coalesce(trim(p_justification), '') = '' then
    raise exception 'A justification is required; it is retained in the procurement file';
  end if;
  if p_decision = 'award' and not exists (select 1 from bids where rfq_id = p_rfq and vendor_id = p_vendor) then
    raise exception 'Choose a vendor that submitted a bid';
  end if;
  if exists (select 1 from evaluators where rfq_id = p_rfq and not submitted) then
    raise exception 'All evaluation panel members must submit scores first';
  end if;

  update rfqs set status = case when p_decision = 'retender' then 'cancelled'::rfq_status else 'awarded'::rfq_status end,
         award_decision = p_decision,
         award_vendor_id = case when p_decision = 'award' then p_vendor end,
         award_justification = trim(p_justification)
  where id = p_rfq;
  perform log_event(q.org_id, 'Award recommended', 'rfq', p_rfq, q.number,
    case p_decision when 'award' then 'Award to ' || (select trading_name from vendors where id = p_vendor)
                    when 'split' then 'Split award' else 'Re-tender; RFQ cancelled' end || '.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------

create or replace function _create_po(r requisitions, p_vendor uuid, p_rfq uuid, p_bid_total bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_number text; v_req_total bigint := r.total_minor;
begin
  v_number := next_doc_number(r.org_id, 'PO');
  insert into purchase_orders (org_id, number, vendor_id, requisition_id, rfq_id, title, status, budget_line_id,
                               expected_delivery, created_by, status_dates, tax_label)
  values (r.org_id, v_number, p_vendor, r.id, p_rfq, r.title, 'draft', r.budget_line_id,
          r.required_by, auth.uid(), jsonb_build_object('draft', current_date), 'Tax')
  returning id into v_id;
  -- Lines come from the requisition. With an awarded bid, unit prices are
  -- scaled towards the bid and rounded down, so the draft never exceeds the
  -- award; the buyer then enters the quoted unit prices before approval.
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  select r.org_id, v_id, l.line_no, l.description, left(l.description, 40), l.qty,
         case when p_bid_total is null or v_req_total = 0 then l.unit_cost_minor
              else floor(l.unit_cost_minor * p_bid_total::numeric / v_req_total) end
  from requisition_lines l where l.requisition_id = r.id;
  insert into po_versions (org_id, po_id, version, change, by_label, approved_by, approved_on)
  values (r.org_id, v_id, 1, 'Draft created from ' || r.number || '.', actor_label(r.org_id), 'Pending', current_date);
  return v_id;
end;
$$;
revoke execute on function _create_po from anon, public, authenticated;

create or replace function create_po_from_award(p_rfq uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q rfqs; r requisitions; v_total bigint; v_id uuid;
begin
  select * into q from rfqs where id = p_rfq for update;
  if q.id is null or not is_member(q.org_id) then raise exception 'RFQ not found'; end if;
  perform require_role(q.org_id, 'buyer');
  if q.status <> 'awarded' or q.award_decision <> 'award' then raise exception 'RFQ has no single-vendor award'; end if;
  if exists (select 1 from purchase_orders where rfq_id = p_rfq and status <> 'cancelled') then
    raise exception 'A purchase order already exists for this award';
  end if;
  select * into r from requisitions where id = q.requisition_id;
  select total_minor into v_total from bids where rfq_id = p_rfq and vendor_id = q.award_vendor_id;
  v_id := _create_po(r, q.award_vendor_id, p_rfq, v_total);
  update purchase_orders set delivery_location = q.delivery_location where id = v_id;
  perform log_event(q.org_id, 'PO drafted', 'purchase_order', v_id, (select number from purchase_orders where id = v_id),
    'From award on ' || q.number || ', USD ' || money_text(po_total(v_id)) || '.');
  return v_id;
end;
$$;

create or replace function create_direct_po(p_req uuid, p_vendor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r requisitions; v vendors; v_limit bigint; v_id uuid;
begin
  select * into r from requisitions where id = p_req for update;
  if r.id is null or not is_member(r.org_id) then raise exception 'Requisition not found'; end if;
  perform require_role(r.org_id, 'buyer');
  if r.status <> 'approved' then raise exception 'Only approved requisitions can be ordered'; end if;
  perform assert_not_sourced(p_req);
  select direct_po_limit_minor into v_limit from orgs where id = r.org_id;
  if r.total_minor > v_limit then
    raise exception 'Requisitions above USD % need competitive quotations (RFQ)', money_text(v_limit);
  end if;
  select * into v from vendors where id = p_vendor and org_id = r.org_id;
  if v.id is null or v.status <> 'approved' then raise exception 'Choose an approved vendor'; end if;
  if vendor_has_expired_docs(p_vendor) then raise exception '% has expired documents', v.trading_name; end if;
  v_id := _create_po(r, p_vendor, null, null);
  perform log_event(r.org_id, 'PO drafted', 'purchase_order', v_id, (select number from purchase_orders where id = v_id),
    'Direct purchase from ' || v.trading_name || ' under the USD ' || money_text(v_limit) || ' limit.');
  return v_id;
end;
$$;

-- p_lines: [{id, unit_price_minor}]
create or replace function save_po_draft(p_po uuid, p_lines jsonb, p_expected date, p_location text, p_terms text)
returns void
language plpgsql security definer set search_path = public as $$
declare po purchase_orders;
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.id is null or not is_member(po.org_id) then raise exception 'Purchase order not found'; end if;
  perform require_role(po.org_id, 'buyer');
  if po.status <> 'draft' then raise exception 'Only draft purchase orders can be edited'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'unit_price_minor')::bigint, -1) < 0) then
    raise exception 'Unit prices must be zero or more';
  end if;
  update po_lines pl set unit_price_minor = (l->>'unit_price_minor')::bigint
  from jsonb_array_elements(p_lines) l
  where pl.po_id = p_po and pl.id = (l->>'id')::uuid;
  update purchase_orders set expected_delivery = p_expected,
    delivery_location = coalesce(trim(p_location), delivery_location),
    payment_terms = coalesce(nullif(trim(p_terms), ''), payment_terms)
  where id = p_po;
  perform log_event(po.org_id, 'PO draft saved', 'purchase_order', p_po, po.number, 'Total USD ' || money_text(po_total(p_po)) || '.');
end;
$$;

create or replace function approve_po(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare po purchase_orders; v_total bigint; v_req bigint; v_tol integer;
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.id is null or not is_member(po.org_id) then raise exception 'Purchase order not found'; end if;
  perform require_role(po.org_id, 'approver');
  if po.status <> 'draft' then raise exception 'Purchase order is already %', po.status; end if;
  if po.created_by = auth.uid() then raise exception 'Segregation of duties: you drafted this purchase order'; end if;
  v_total := po_total(p_po);
  if v_total <= 0 then raise exception 'Purchase order has no value'; end if;
  if po.rfq_id is not null and v_total > (select total_minor from bids b join rfqs q on q.id = b.rfq_id
                                          where b.rfq_id = po.rfq_id and b.vendor_id = q.award_vendor_id) then
    raise exception 'PO total USD % exceeds the awarded bid', money_text(v_total);
  end if;
  select total_minor into v_req from requisitions where id = po.requisition_id;
  select po_tolerance_pct into v_tol from orgs where id = po.org_id;
  if v_req is not null and v_total > v_req * (100 + v_tol) / 100 then
    raise exception 'PO total USD % exceeds the approved requisition (USD %) by more than % percent; raise a new requisition',
      money_text(v_total), money_text(v_req), v_tol;
  end if;
  update purchase_orders set status = 'approved', approved_by = auth.uid(), po_date = current_date,
    status_dates = status_dates || jsonb_build_object('approved', current_date)
  where id = p_po;
  update po_versions set approved_by = actor_label(po.org_id), approved_on = current_date
  where po_id = p_po and version = po.version;
  perform log_event(po.org_id, 'Approved', 'purchase_order', p_po, po.number, 'USD ' || money_text(v_total) || '.');
end;
$$;

create or replace function issue_po(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare po purchase_orders; v_total bigint; v_req bigint;
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.id is null or not is_member(po.org_id) then raise exception 'Purchase order not found'; end if;
  perform require_role(po.org_id, 'buyer');
  if po.status <> 'approved' then raise exception 'Only approved purchase orders can be issued'; end if;
  v_total := po_total(p_po);
  select total_minor into v_req from requisitions where id = po.requisition_id;
  -- Replace the requisition estimate with the actual order value in the budget.
  if v_req is not null then
    update budget_lines set committed_minor = committed_minor + (v_total - v_req) where id = po.budget_line_id;
  end if;
  update purchase_orders set status = 'issued', status_dates = status_dates || jsonb_build_object('issued', current_date)
  where id = p_po;
  perform log_event(po.org_id, 'PO issued', 'purchase_order', p_po, po.number,
    'Sent to ' || (select trading_name from vendors where id = po.vendor_id) || ', USD ' || money_text(v_total) || '.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Goods receipt
-- ---------------------------------------------------------------------------

create or replace function create_goods_receipt(p_po uuid, p_delivered_on date, p_location text) returns uuid
language plpgsql security definer set search_path = public as $$
declare po purchase_orders; v_id uuid; v_number text;
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.id is null or not is_member(po.org_id) then raise exception 'Purchase order not found'; end if;
  perform require_role(po.org_id, 'receiver');
  if po.status not in ('issued', 'partially_received') then raise exception 'Goods can only be received against an issued order'; end if;
  if po.created_by = auth.uid() then
    raise exception 'Segregation of duties: you raised % and cannot receive goods against it', po.number;
  end if;
  if exists (select 1 from goods_receipts where po_id = p_po and status = 'draft') then
    raise exception 'A draft goods receipt already exists for this order';
  end if;
  if p_delivered_on is null or p_delivered_on > current_date then raise exception 'Enter a delivery date that is not in the future'; end if;
  v_number := next_doc_number(po.org_id, 'GRN');
  insert into goods_receipts (org_id, number, po_id, delivered_on, location, created_by)
  values (po.org_id, v_number, p_po, p_delivered_on, coalesce(nullif(trim(p_location), ''), po.delivery_location), auth.uid())
  returning id into v_id;
  insert into grn_lines (org_id, grn_id, po_line_id, received_qty, inspection)
  select po.org_id, v_id, pl.id, greatest(pl.qty - received_qty(pl.id), 0), 'Passed'
  from po_lines pl where pl.po_id = p_po and pl.qty > received_qty(pl.id);
  perform log_event(po.org_id, 'Receipt started', 'goods_receipt', v_id, v_number, 'Against ' || po.number || '.');
  return v_id;
end;
$$;

-- Re-run invoice matching for a PO (after receipts change).
create or replace function refresh_invoice_status(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i invoices; v_bad integer;
begin
  for i in select * from invoices where po_id = p_po and status in ('registered', 'matched', 'exception') loop
    select count(*) into v_bad
    from invoice_lines il join po_lines pl on pl.id = il.po_line_id
    where il.invoice_id = i.id
      and (il.unit_price_minor <> pl.unit_price_minor or il.qty > received_qty(pl.id));
    update invoices set status = case when v_bad = 0 then 'matched'::invoice_status else 'exception'::invoice_status end
    where id = i.id;
  end loop;
end;
$$;

create or replace function save_goods_receipt(
  p_grn uuid, p_lines jsonb, p_checklist jsonb,
  p_disc_item text, p_disc_type text, p_disc_note text, p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare g goods_receipts; po purchase_orders; v_short integer; v_fully boolean;
begin
  select * into g from goods_receipts where id = p_grn for update;
  if g.id is null or not is_member(g.org_id) then raise exception 'Goods receipt not found'; end if;
  perform require_role(g.org_id, 'receiver');
  if g.status = 'accepted' then raise exception '% is already accepted and signed', g.number; end if;

  select * into po from purchase_orders where id = g.po_id for update;
  if po.created_by = auth.uid() then
    raise exception 'Segregation of duties: you raised % and cannot receive goods against it', po.number;
  end if;

  update grn_lines gl
  set received_qty = (l->>'received_qty')::numeric,
      inspection   = coalesce(nullif(l->>'inspection', ''), 'Passed')
  from jsonb_array_elements(p_lines) l
  where gl.grn_id = p_grn and gl.po_line_id = (l->>'po_line_id')::uuid;

  -- Cumulative check across every accepted receipt plus this one.
  if exists (select 1 from grn_lines gl join po_lines pl on pl.id = gl.po_line_id
             where gl.grn_id = p_grn and (gl.received_qty < 0 or gl.received_qty + received_qty(pl.id) > pl.qty)) then
    raise exception 'Received quantity cannot exceed the quantity still outstanding on the order';
  end if;
  if p_accept and (select coalesce(sum(received_qty), 0) from grn_lines where grn_id = p_grn) = 0 then
    raise exception 'Nothing has been received on this note';
  end if;
  if p_accept and exists (select 1 from grn_lines where grn_id = p_grn and inspection <> 'Passed')
     and coalesce(trim(p_disc_note), '') = '' then
    raise exception 'Describe the discrepancy before accepting a receipt with failed inspections';
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
  select bool_and(received_qty(pl.id) >= pl.qty) into v_fully from po_lines pl where pl.po_id = po.id;

  update purchase_orders
  set status = case when v_fully then 'received'::po_status else 'partially_received'::po_status end,
      status_dates = status_dates || jsonb_build_object(
        case when v_fully then 'received' else 'partially_received' end, to_char(g.delivered_on, 'YYYY-MM-DD'))
  where id = po.id and status in ('issued', 'partially_received');

  perform refresh_invoice_status(po.id);
  perform log_event(g.org_id, 'Goods received', 'goods_receipt', p_grn, g.number,
    case when v_fully then 'Full receipt against ' else 'Partial receipt against ' end || po.number || '.'
    || case when v_short > 0 then ' ' || v_short || ' line(s) with discrepancies.' else '' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices and payment
-- ---------------------------------------------------------------------------

-- p_lines: [{po_line_id, qty, unit_price_minor}]
create or replace function register_invoice(p_po uuid, p_vendor_ref text, p_invoice_date date, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare po purchase_orders; v_id uuid; v_number text; v_ref text := upper(trim(p_vendor_ref));
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.id is null or not is_member(po.org_id) then raise exception 'Purchase order not found'; end if;
  perform require_role(po.org_id, 'finance');
  if po.status not in ('issued', 'partially_received', 'received', 'invoiced') then
    raise exception 'Invoices can only be registered against an issued order';
  end if;
  if coalesce(v_ref, '') = '' then raise exception 'Enter the supplier invoice number'; end if;
  if p_invoice_date is null or p_invoice_date > current_date then raise exception 'Enter an invoice date that is not in the future'; end if;
  if exists (select 1 from invoices i join purchase_orders p on p.id = i.po_id
             where p.vendor_id = po.vendor_id and upper(i.vendor_ref) = v_ref and i.org_id = po.org_id) then
    raise exception 'Duplicate: invoice % from this vendor is already registered', v_ref;
  end if;
  if not exists (select 1 from jsonb_array_elements(p_lines) l where (l->>'qty')::numeric > 0) then
    raise exception 'Enter at least one invoiced line';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             left join po_lines pl on pl.id = (l->>'po_line_id')::uuid and pl.po_id = p_po
             where pl.id is null or (l->>'qty')::numeric < 0 or (l->>'unit_price_minor')::bigint < 0) then
    raise exception 'Invoice lines must belong to this order and be non-negative';
  end if;

  v_number := next_doc_number(po.org_id, 'INV');
  insert into invoices (org_id, number, vendor_ref, po_id, invoice_date, received_on, registered_by)
  values (po.org_id, v_number, v_ref, p_po, p_invoice_date, current_date, auth.uid()) returning id into v_id;
  insert into invoice_lines (org_id, invoice_id, po_line_id, qty, unit_price_minor)
  select po.org_id, v_id, (l->>'po_line_id')::uuid, (l->>'qty')::numeric, (l->>'unit_price_minor')::bigint
  from jsonb_array_elements(p_lines) l where (l->>'qty')::numeric > 0;
  perform refresh_invoice_status(p_po);
  perform log_event(po.org_id, 'Invoice registered', 'invoice', v_id, v_number,
    'Supplier ref ' || v_ref || ' against ' || po.number || '. Matching: '
    || (select status from invoices where id = v_id) || '.');
  return v_id;
end;
$$;

create or replace function resolve_invoice(p_invoice uuid, p_resolution text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare i invoices; v_payable bigint; v_status invoice_status; v_detail text; v_amount bigint;
begin
  select * into i from invoices where id = p_invoice for update;
  if i.id is null or not is_member(i.org_id) then raise exception 'Invoice not found'; end if;
  perform require_role(i.org_id, 'finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required; it is recorded in the audit trail'; end if;
  if i.status in ('approved_for_payment', 'paid', 'returned') then raise exception 'Invoice % is already %', i.number, i.status; end if;
  if p_resolution in ('approve', 'partial_payment') and exists (
       select 1 from goods_receipts where po_id = i.po_id and received_by = auth.uid()) then
    raise exception 'Segregation of duties: you received these goods and cannot approve the invoice';
  end if;
  if p_resolution in ('approve', 'partial_payment') and i.registered_by = auth.uid() then
    raise exception 'Segregation of duties: you registered this invoice and cannot approve it';
  end if;

  select coalesce(sum(round(least(il.qty, received_qty(il.po_line_id)) * least(il.unit_price_minor, pl.unit_price_minor))), 0)
  into v_payable
  from invoice_lines il join po_lines pl on pl.id = il.po_line_id where il.invoice_id = p_invoice;

  case p_resolution
    when 'approve' then
      if i.status <> 'matched' then raise exception 'Only a fully matched invoice can be approved in full'; end if;
      select coalesce(sum(round(qty * unit_price_minor)), 0) into v_amount from invoice_lines where invoice_id = p_invoice;
      v_status := 'approved_for_payment'; v_detail := 'Approved for payment, USD ' || money_text(v_amount) || '.';
    when 'partial_payment' then
      if v_payable = 0 then raise exception 'Nothing on this invoice has been received yet'; end if;
      v_amount := v_payable; v_status := 'approved_for_payment';
      v_detail := 'Partial payment of USD ' || money_text(v_payable) || ' authorised for received goods.';
    when 'credit_note' then v_status := 'exception'; v_detail := 'Credit note requested for undelivered quantities.';
    when 'hold' then v_status := 'exception'; v_detail := 'Held until goods receipt for outstanding items is recorded.';
    when 'return_to_vendor' then v_status := 'returned'; v_detail := 'Returned to vendor.';
    else raise exception 'Unknown resolution %', p_resolution;
  end case;

  update invoices set status = v_status, resolution = p_resolution, resolution_reason = trim(p_reason),
                      approved_amount_minor = coalesce(v_amount, approved_amount_minor)
  where id = p_invoice;
  if v_status = 'approved_for_payment' then
    update purchase_orders set status = 'invoiced',
      status_dates = status_dates || jsonb_build_object('invoiced', to_char(now(), 'YYYY-MM-DD'))
    where id = i.po_id and status = 'received';
  end if;
  perform log_event(i.org_id, case when v_status = 'approved_for_payment' then 'Approved for payment' else 'Exception resolved' end,
    'invoice', p_invoice, i.number, v_detail || ' Reason: ' || trim(p_reason));
end;
$$;

create or replace function mark_invoice_paid(p_invoice uuid, p_paid_on date, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare i invoices; po purchase_orders; v_paid bigint;
begin
  select * into i from invoices where id = p_invoice for update;
  if i.id is null or not is_member(i.org_id) then raise exception 'Invoice not found'; end if;
  perform require_role(i.org_id, 'finance');
  if i.status <> 'approved_for_payment' then raise exception 'Only invoices approved for payment can be paid'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'Enter the payment reference'; end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'Enter a payment date that is not in the future'; end if;

  update invoices set status = 'paid', paid_on = p_paid_on, payment_reference = trim(p_reference) where id = p_invoice;
  select * into po from purchase_orders where id = i.po_id for update;
  update budget_lines set spent_minor = spent_minor + i.approved_amount_minor where id = po.budget_line_id;

  -- Close the order once it is fully received and fully paid.
  select coalesce(sum(approved_amount_minor), 0) into v_paid from invoices where po_id = po.id and status = 'paid';
  if po.status in ('received', 'invoiced') and v_paid >= po_total(po.id) then
    update purchase_orders set status = 'closed', status_dates = status_dates || jsonb_build_object('closed', current_date)
    where id = po.id;
  end if;
  perform log_event(i.org_id, 'Payment recorded', 'invoice', p_invoice, i.number,
    'USD ' || money_text(i.approved_amount_minor) || ' paid ' || to_char(p_paid_on, 'DD Mon YYYY') || ', ref ' || trim(p_reference) || '.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Aggregates computed in SQL (the REST API caps result sets at 1,000 rows,
-- so totals must not be summed client-side).
-- ---------------------------------------------------------------------------

create or replace function dashboard_stats(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_member(p_org) then raise exception 'Not a member'; end if;
  select jsonb_build_object(
    'open_reqs', (select count(*) from requisitions where org_id = p_org and status in ('draft', 'submitted', 'returned')),
    'awaiting_approval', (select count(*) from requisitions where org_id = p_org and status = 'submitted'),
    'open_pos', (select count(*) from purchase_orders where org_id = p_org and status in ('approved', 'issued', 'partially_received', 'received')),
    'open_po_value', (select coalesce(sum(po_total(id)), 0) from purchase_orders where org_id = p_org and status in ('approved', 'issued', 'partially_received', 'received')),
    'pending_grns', (select count(*) from goods_receipts where org_id = p_org and status = 'draft'),
    'late_deliveries', (select count(*) from purchase_orders where org_id = p_org and status in ('issued', 'partially_received') and expected_delivery < current_date),
    'exceptions', (select count(*) from invoices where org_id = p_org and status = 'exception'),
    'exception_value', (select coalesce(sum(round(il.qty * il.unit_price_minor)), 0) from invoice_lines il join invoices i on i.id = il.invoice_id where i.org_id = p_org and i.status = 'exception'),
    'overdue_approvals', (select count(*) from approval_steps where org_id = p_org and status = 'pending' and activated_at < now() - interval '3 days'),
    'expiring_docs', (select count(*) from vendor_documents where org_id = p_org and expires_on <= current_date + 30),
    'rfqs_open', (select count(*) from rfqs where org_id = p_org and status = 'open'),
    'rfqs_evaluation', (select count(*) from rfqs where org_id = p_org and status = 'evaluation'),
    'rfqs_awarded', (select count(*) from rfqs r where org_id = p_org and status = 'awarded'
                      and not exists (select 1 from purchase_orders p where p.rfq_id = r.id)),
    'pos_issued', (select count(*) from purchase_orders where org_id = p_org and status = 'issued'),
    'invoices_open', (select count(*) from invoices where org_id = p_org and status in ('registered', 'matched', 'exception')),
    'by_department', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'committed', c) order by c desc), '[]')
                      from (select coalesce(d.name, 'Unassigned') name, sum(b.committed_minor) c
                            from budget_lines b left join departments d on d.id = b.department_id
                            where b.org_id = p_org group by 1) x),
    'cycle_req_to_approval', (select round(avg(extract(epoch from (s.last - r.submitted_at)) / 86400)::numeric, 1)
                              from requisitions r join (select requisition_id, max(acted_at) last from approval_steps group by 1) s
                                on s.requisition_id = r.id where r.org_id = p_org and r.status = 'approved' and r.submitted_at is not null),
    'cycle_po_to_delivery', (select round(avg(g.delivered_on - p.po_date)::numeric, 1) from goods_receipts g
                             join purchase_orders p on p.id = g.po_id where g.org_id = p_org and g.status = 'accepted' and p.po_date is not null),
    'cycle_receipt_to_invoice', (select round(avg(i.received_on - g.delivered_on)::numeric, 1) from invoices i
                                 join lateral (select max(delivered_on) delivered_on from goods_receipts where po_id = i.po_id and status = 'accepted') g on true
                                 where i.org_id = p_org and g.delivered_on is not null),
    'approved_count', (select count(*) from requisitions where org_id = p_org and status = 'approved'),
    'accepted_grns', (select count(*) from goods_receipts where org_id = p_org and status = 'accepted')
  ) into v;
  return v;
end;
$$;

create or replace function spend_by_project(p_org uuid, p_donor uuid, p_department uuid)
returns table (project text, requisitions bigint, pos bigint, committed_minor bigint, paid_minor bigint)
language sql stable security definer set search_path = public as $$
  with b as (
    select bl.*, coalesce(p.name, 'Core (no project)') pname from budget_lines bl left join projects p on p.id = bl.project_id
    where bl.org_id = p_org and is_member(p_org)
      and (p_donor is null or bl.donor_id = p_donor) and (p_department is null or bl.department_id = p_department)
  )
  select b.pname,
         (select count(*) from requisitions r where r.budget_line_id = any(array_agg(b.id)) and r.status <> 'draft'),
         (select count(*) from purchase_orders po where po.budget_line_id = any(array_agg(b.id)) and po.status <> 'cancelled'),
         sum(b.committed_minor)::bigint, sum(b.spent_minor)::bigint
  from b group by b.pname order by b.pname;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function log_event, next_doc_number, install_default_rules, _demo_req, _create_po,
  _create_demo_org_unguarded, refresh_invoice_status, assert_in_org from authenticated;
