-- Licensing: an organisation needs an active C-Procurement license to work.
--
-- Keys are issued by the platform owner (scripts/license.mjs, service role)
-- and stored only as a SHA-256 hash. An administrator activates a key for
-- their organisation; each key adds its term (12 months by default) after the
-- organisation's current expiry, so renewals stack. Without an active license
-- has_role() is false, which blocks every workflow function and admin write;
-- members can still sign in and read their records.

create table licenses (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique,
  key_hint     text not null,
  customer     text not null default '',
  term_months  integer not null default 12 check (term_months between 1 and 120),
  org_id       uuid references orgs(id) on delete set null,
  starts_at    timestamptz,
  expires_at   timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index licenses_org_id_idx on licenses (org_id);
create index licenses_activated_by_idx on licenses (activated_by);
alter table licenses enable row level security;
create policy licenses_read on licenses for select using (is_member(org_id));
-- Members see their own licenses, never the key hashes.
revoke all on licenses from anon, authenticated;
grant select (id, key_hint, customer, term_months, org_id, starts_at, expires_at, activated_at, revoked_at)
  on licenses to authenticated;

-- Sales enquiries from the pricing page. Readable only with the service role.
create table license_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  organisation text not null check (length(organisation) between 1 and 200),
  contact_name text not null check (length(contact_name) between 1 and 200),
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  country      text not null default '' check (length(country) <= 100),
  message      text not null default '' check (length(message) <= 2000),
  status       text not null default 'new' check (status in ('new', 'contacted', 'issued', 'closed'))
);
create index license_requests_created_at_idx on license_requests (created_at desc);
alter table license_requests enable row level security;
revoke all on license_requests from anon, authenticated;

-- Normalised form of a key as typed: case, dashes, spaces and the CPRO prefix
-- are ignored, and the look-alikes O, I and L read as 0 and 1.
create or replace function license_key_hash(p_key text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(
    translate(regexp_replace(upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g')), '^CPRO', ''), 'OIL', '011'),
    'UTF8')), 'hex');
$$;

create or replace function org_licensed(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from licenses
    where org_id = p_org and revoked_at is null and starts_at <= now() and expires_at > now()
  );
$$;

create or replace function has_role(p_org uuid, p_role member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select org_licensed(p_org) and exists (
    select 1 from members
    where org_id = p_org and user_id = auth.uid()
      and (p_role = any(roles) or 'admin' = any(roles))
  );
$$;

create or replace function require_role(p_org uuid, p_role member_role) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if is_member(p_org) and not org_licensed(p_org) then
    raise exception 'This organisation has no active C-Procurement license. An administrator can activate one.'
      using errcode = '42501';
  end if;
  if not has_role(p_org, p_role) then
    raise exception 'You need the % role for this action', p_role using errcode = '42501';
  end if;
end;
$$;

-- The few writes that check membership rather than a role.
create or replace function enforce_license() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not org_licensed(new.org_id) then
    raise exception 'This organisation has no active C-Procurement license. An administrator can activate one.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger requisitions_license before update of status on requisitions
  for each row when (new.status = 'submitted' and old.status is distinct from new.status)
  execute function enforce_license();
create trigger evaluators_license before update on evaluators
  for each row execute function enforce_license();
-- Uploaded files only; the demo seed records file names without storage.
create trigger attachments_license before insert on attachments
  for each row when (new.storage_path is not null)
  execute function enforce_license();

create or replace function activate_license(p_org uuid, p_key text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare l licenses; v_start timestamptz; v_end timestamptz; v_org text;
begin
  if not exists (select 1 from members where org_id = p_org and user_id = auth.uid() and 'admin' = any(roles)) then
    raise exception 'Only an administrator can activate a license' using errcode = '42501';
  end if;
  select * into l from licenses where key_hash = license_key_hash(p_key) for update;
  if l.id is null or l.revoked_at is not null then raise exception 'This license key is not valid'; end if;
  if l.org_id = p_org then raise exception 'This license key is already active for your organisation'; end if;
  if l.org_id is not null then raise exception 'This license key has already been used'; end if;

  select greatest(now(), coalesce(max(expires_at), now())) into v_start
  from licenses where org_id = p_org and revoked_at is null;
  v_end := v_start + make_interval(months => l.term_months);
  update licenses set org_id = p_org, activated_by = auth.uid(), activated_at = now(),
    starts_at = v_start, expires_at = v_end
  where id = l.id;

  select name into v_org from orgs where id = p_org;
  perform log_event(p_org, 'License activated', 'org', p_org, v_org,
    'Key ending ' || l.key_hint || ', ' || l.term_months || ' months, valid until ' || to_char(v_end, 'DD Mon YYYY') || '.');
  return v_end;
end;
$$;

create or replace function request_license(
  p_organisation text, p_contact_name text, p_email text, p_country text, p_message text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if (select count(*) from license_requests where created_at > now() - interval '1 hour') >= 30
     or (select count(*) from license_requests where email = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'We already have your request. We will be in touch shortly.';
  end if;
  insert into license_requests (organisation, contact_name, email, country, message)
  values (trim(p_organisation), trim(p_contact_name), v_email, coalesce(trim(p_country), ''), coalesce(trim(p_message), ''));
exception when check_violation then
  raise exception 'Check the organisation, name and email address.';
end;
$$;

revoke execute on function license_key_hash(text), org_licensed(uuid), enforce_license(),
  activate_license(uuid, text), request_license(text, text, text, text, text) from public, anon, authenticated;
grant execute on function activate_license(uuid, text) to authenticated;
grant execute on function request_license(text, text, text, text, text) to anon, authenticated;
