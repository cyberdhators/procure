-- CORWADO e-procurement: core schema.
-- Every tenant-owned row carries org_id and is protected by row-level security.
-- Money is stored as bigint minor units (cents) to avoid floating-point drift.


-- ---------------------------------------------------------------------------
-- Tenancy and people
-- ---------------------------------------------------------------------------

create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  currency    text not null default 'USD',
  created_at  timestamptz not null default now()
);

create type member_role as enum ('requester', 'approver', 'buyer', 'receiver', 'finance', 'admin');

create table members (
  org_id        uuid not null references orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,
  title         text not null default '',
  office        text not null default 'Head Office',
  roles         member_role[] not null default '{requester}',
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on members (user_id);

-- True when the calling user belongs to the org. SECURITY DEFINER so RLS
-- policies can call it without recursing into members' own policy.
create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function has_role(p_org uuid, p_role member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where org_id = p_org and user_id = auth.uid()
      and (p_role = any(roles) or 'admin' = any(roles))
  );
$$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table departments (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  name    text not null,
  head_title text not null default '',
  unique (org_id, name)
);

create table projects (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  name    text not null,
  manager_title text not null default '',
  unique (org_id, name)
);

create table donors (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  name    text not null,
  unique (org_id, name)
);

create table budget_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  code            text not null,
  department_id   uuid references departments(id),
  project_id      uuid references projects(id),
  donor_id        uuid references donors(id),
  amount_minor    bigint not null default 0,
  committed_minor bigint not null default 0,
  spent_minor     bigint not null default 0,
  unique (org_id, code)
);

-- Per-org, per-document-type sequential numbering (REQ-0142, PO-0088 ...).
create table doc_counters (
  org_id    uuid not null references orgs(id) on delete cascade,
  doc_type  text not null,
  next_val  integer not null default 1,
  primary key (org_id, doc_type)
);

-- Approval routing rules are data, not code. A rule applies when every
-- non-null condition matches; matching rules become the approval plan.
create table approval_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  level           integer not null,
  label           text not null,
  approver_title  text not null,       -- '{department_head}' / '{project_manager}' are resolved at submit
  min_value_minor bigint,
  category        text,
  donor_id        uuid references donors(id),
  escalate_after_days integer not null default 7,
  escalate_to     text not null default 'Country Director'
);

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------

create type vendor_status as enum ('pending', 'approved', 'suspended');

create table vendors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  number          text not null,
  legal_name      text not null,
  trading_name    text not null,
  status          vendor_status not null default 'pending',
  categories      text not null default '',
  registration_no text not null default '',
  tax_id          text not null default '',
  contact         text not null default '',
  email           text not null default '',
  bank            text not null default '',
  conflict_of_interest text not null default 'Not declared',
  registered_on   date not null default current_date,
  score_price            numeric(3,1),
  score_quality          numeric(3,1),
  score_delivery         numeric(3,1),
  score_responsiveness   numeric(3,1),
  score_compliance       numeric(3,1),
  on_time_pct     integer,
  unique (org_id, number)
);

create table vendor_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  vendor_id   uuid not null references vendors(id) on delete cascade,
  name        text not null,
  expires_on  date             -- null = no expiry
);

-- ---------------------------------------------------------------------------
-- Requisitions and approvals
-- ---------------------------------------------------------------------------

create type requisition_status as enum ('draft', 'submitted', 'approved', 'returned', 'rejected', 'cancelled');

create table requisitions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  number          text not null,
  title           text not null,
  status          requisition_status not null default 'draft',
  department_id   uuid references departments(id),
  project_id      uuid references projects(id),
  donor_id        uuid references donors(id),
  budget_line_id  uuid references budget_lines(id),
  category        text not null default 'Goods',
  required_by     date,
  justification   text not null default '',
  requester_id    uuid references auth.users(id),
  requester_label text not null,
  total_minor     bigint not null default 0,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (org_id, number)
);

create table requisition_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  requisition_id  uuid not null references requisitions(id) on delete cascade,
  line_no         integer not null,
  description     text not null,
  qty             numeric(12,2) not null check (qty > 0),
  unit            text not null default 'each',
  unit_cost_minor bigint not null check (unit_cost_minor >= 0)
);

create type step_status as enum ('waiting', 'pending', 'approved', 'returned', 'rejected', 'skipped');

create table approval_steps (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  requisition_id  uuid not null references requisitions(id) on delete cascade,
  level           integer not null,
  label           text not null,
  approver_title  text not null,
  status          step_status not null default 'waiting',
  note            text not null default '',
  activated_at    timestamptz,
  acted_at        timestamptz,
  acted_by        uuid references auth.users(id),
  acted_by_label  text,
  comment         text,
  unique (requisition_id, level)
);

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  record_type   text not null,
  record_id     uuid not null,
  name          text not null,
  size_bytes    integer not null default 0,
  storage_path  text,
  created_at    timestamptz not null default now()
);
create index on attachments (record_type, record_id);

-- ---------------------------------------------------------------------------
-- Sourcing
-- ---------------------------------------------------------------------------

create type rfq_status as enum ('draft', 'open', 'evaluation', 'awarded', 'cancelled');

create table rfqs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  number            text not null,
  requisition_id    uuid references requisitions(id),
  title             text not null,
  status            rfq_status not null default 'draft',
  method            text not null default 'Request for quotation',
  closes_at         timestamptz,
  currency          text not null default 'USD',
  delivery_location text not null default '',
  terms             text not null default '',
  award_decision    text,
  award_vendor_id   uuid references vendors(id),
  award_justification text,
  unique (org_id, number)
);

create table rfq_criteria (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  rfq_id   uuid not null references rfqs(id) on delete cascade,
  position integer not null,
  name     text not null,
  type     text not null,              -- Financial / Technical / Non-financial / Compliance
  weight   integer not null check (weight between 0 and 100),
  is_price boolean not null default false
);

create table rfq_invites (
  org_id      uuid not null references orgs(id) on delete cascade,
  rfq_id      uuid not null references rfqs(id) on delete cascade,
  vendor_id   uuid not null references vendors(id),
  invited_at  timestamptz not null default now(),
  status      text not null default 'Invited',   -- Invited / Acknowledged / Bid received
  primary key (rfq_id, vendor_id)
);

create table bids (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  rfq_id          uuid not null references rfqs(id) on delete cascade,
  vendor_id       uuid not null references vendors(id),
  total_minor     bigint not null,
  validity_days   integer not null,
  submitted_at    timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

-- Non-price criterion scores, already on the criterion's weight scale
-- (e.g. 0..25 for a weight-25 criterion). Price scores are always computed.
create table bid_scores (
  org_id        uuid not null references orgs(id) on delete cascade,
  bid_id        uuid not null references bids(id) on delete cascade,
  criterion_id  uuid not null references rfq_criteria(id) on delete cascade,
  score         numeric(5,2) not null,
  note          text not null default '',
  primary key (bid_id, criterion_id)
);

create table evaluators (
  org_id      uuid not null references orgs(id) on delete cascade,
  rfq_id      uuid not null references rfqs(id) on delete cascade,
  title       text not null,
  submitted   boolean not null default false,
  primary key (rfq_id, title)
);

create table clarifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  rfq_id      uuid not null references rfqs(id) on delete cascade,
  vendor_id   uuid not null references vendors(id),
  question    text not null,
  answer      text,
  asked_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------

create type po_status as enum ('draft', 'approved', 'issued', 'partially_received', 'received', 'invoiced', 'closed', 'cancelled');

create table purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  number            text not null,
  vendor_id         uuid not null references vendors(id),
  requisition_id    uuid references requisitions(id),
  rfq_id            uuid references rfqs(id),
  title             text not null,
  status            po_status not null default 'draft',
  version           integer not null default 1,
  po_date           date,
  expected_delivery date,
  delivery_location text not null default '',
  payment_terms     text not null default '30 days after acceptance',
  currency          text not null default 'USD',
  budget_line_id    uuid references budget_lines(id),
  tax_minor         bigint not null default 0,
  tax_label         text not null default 'Tax',
  status_dates      jsonb not null default '{}',
  created_by        uuid references auth.users(id),
  unique (org_id, number)
);

create table po_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  po_id             uuid not null references purchase_orders(id) on delete cascade,
  line_no           integer not null,
  description       text not null,
  short_name        text not null,
  qty               numeric(12,2) not null,
  unit_price_minor  bigint not null
);

create table po_versions (
  org_id        uuid not null references orgs(id) on delete cascade,
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  version       integer not null,
  change        text not null,
  by_label      text not null,
  approved_by   text not null,
  approved_on   date not null,
  primary key (po_id, version)
);

create type grn_status as enum ('draft', 'accepted');

create table goods_receipts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  number          text not null,
  po_id           uuid not null references purchase_orders(id),
  status          grn_status not null default 'draft',
  delivered_on    date not null default current_date,
  location        text not null default '',
  checklist       jsonb not null default '{}',
  discrepancy_item text,
  discrepancy_type text,
  discrepancy_note text,
  received_by     uuid references auth.users(id),
  accepted_at     timestamptz,
  unique (org_id, number)
);

create table grn_lines (
  org_id        uuid not null references orgs(id) on delete cascade,
  grn_id        uuid not null references goods_receipts(id) on delete cascade,
  po_line_id    uuid not null references po_lines(id),
  received_qty  numeric(12,2) not null default 0 check (received_qty >= 0),
  inspection    text not null default 'Passed',   -- Passed / Short delivery / Not delivered / Rejected
  primary key (grn_id, po_line_id)
);

create type invoice_status as enum ('registered', 'matched', 'exception', 'approved_for_payment', 'returned', 'paid');

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  number          text not null,
  vendor_ref      text not null,
  po_id           uuid not null references purchase_orders(id),
  status          invoice_status not null default 'registered',
  invoice_date    date not null,
  received_on     date not null,
  resolution      text,
  resolution_reason text,
  unique (org_id, number),
  unique (org_id, po_id, vendor_ref)
);

create table invoice_lines (
  org_id            uuid not null references orgs(id) on delete cascade,
  invoice_id        uuid not null references invoices(id) on delete cascade,
  po_line_id        uuid not null references po_lines(id),
  qty               numeric(12,2) not null,
  unit_price_minor  bigint not null,
  primary key (invoice_id, po_line_id)
);

-- ---------------------------------------------------------------------------
-- Audit log: append-only. Updates and deletes are rejected by trigger,
-- and no RLS policy grants them.
-- ---------------------------------------------------------------------------

create table audit_events (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references orgs(id) on delete cascade,
  at            timestamptz not null default now(),
  actor_id      uuid,
  actor_label   text not null,
  action        text not null,
  record_type   text not null,
  record_id     uuid,
  record_label  text not null,
  detail        text not null default ''
);
create index on audit_events (org_id, at desc);

create or replace function audit_events_immutable() returns trigger
language plpgsql as $$
begin
  -- Allow the cascade when a whole tenant is deleted; block everything else.
  if tg_op = 'DELETE' and not exists (select 1 from orgs where id = old.org_id) then
    return old;
  end if;
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table orgs enable row level security;
create policy orgs_read on orgs for select using (is_member(id));

alter table members enable row level security;
create policy members_read on members for select using (is_member(org_id));
create policy members_admin on members for all
  using (has_role(org_id, 'admin')) with check (has_role(org_id, 'admin'));

-- Tenant tables: members may read and write rows of their own org.
-- State-changing workflow steps go through SECURITY DEFINER functions
-- (see 0002) which enforce role and segregation-of-duties checks.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','projects','donors','budget_lines','approval_rules',
    'vendors','vendor_documents','requisitions','requisition_lines','approval_steps',
    'attachments','rfqs','rfq_criteria','rfq_invites','bids','bid_scores','evaluators',
    'clarifications','purchase_orders','po_lines','po_versions','goods_receipts',
    'grn_lines','invoices','invoice_lines'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_member(org_id))', t || '_read', t);
  end loop;
end $$;

-- Direct writes are allowed only where there is no workflow invariant to protect.
do $$
declare t text;
begin
  foreach t in array array['departments','projects','donors','budget_lines','approval_rules'] loop
    execute format('create policy %I on %I for insert with check (has_role(org_id, ''admin''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_role(org_id, ''admin''))', t || '_update', t);
  end loop;
end $$;
-- New vendors always start as pending; approval goes through set_vendor_status().
create policy vendors_insert on vendors for insert with check (has_role(org_id, 'buyer') and status = 'pending');
create policy vendor_documents_write on vendor_documents for all
  using (has_role(org_id, 'buyer')) with check (has_role(org_id, 'buyer'));

alter table doc_counters enable row level security;   -- only used via definer functions

alter table audit_events enable row level security;
create policy audit_read on audit_events for select using (is_member(org_id));
