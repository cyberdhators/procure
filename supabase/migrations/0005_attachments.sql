-- Attachments: files live in a private Supabase Storage bucket under
-- <org_id>/<record_type>/<record_id>/<uuid>-<filename>. Storage policies let
-- members read and upload only within their own organisation's folder; the
-- metadata row is written by add_attachment() so every upload is audited.

create or replace function add_attachment(
  p_org uuid, p_record_type text, p_record_id uuid, p_name text, p_size integer, p_path text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_label text;
begin
  if not is_member(p_org) then raise exception 'Not a member of this organisation'; end if;
  if p_record_type not in ('requisition', 'rfq', 'purchase_order', 'goods_receipt', 'invoice', 'vendor') then
    raise exception 'Attachments are not supported on %', p_record_type;
  end if;
  if p_path not like p_org::text || '/' || p_record_type || '/' || p_record_id::text || '/%' then
    raise exception 'Invalid storage path';
  end if;
  execute format('select number from %I where id = $1 and org_id = $2',
    case p_record_type when 'requisition' then 'requisitions' when 'rfq' then 'rfqs'
         when 'purchase_order' then 'purchase_orders' when 'goods_receipt' then 'goods_receipts'
         when 'invoice' then 'invoices' else 'vendors' end)
    into v_label using p_record_id, p_org;
  if v_label is null then raise exception 'Record not found'; end if;

  insert into attachments (org_id, record_type, record_id, name, size_bytes, storage_path)
  values (p_org, p_record_type, p_record_id, left(p_name, 200), p_size, p_path) returning id into v_id;
  perform log_event(p_org, 'Document uploaded', p_record_type, p_record_id, v_label,
    left(p_name, 200) || ' (' || greatest(1, p_size / 1024) || ' KB).');
  return v_id;
end;
$$;
revoke execute on function add_attachment from anon, public;
grant execute on function add_attachment to authenticated;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('attachments', 'attachments', false, 4194304)
  on conflict (id) do update set public = false, file_size_limit = 4194304;

  execute $p$
    create policy "attachments: members read own org" on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "attachments: members upload to own org" on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  -- Uploader may remove their own object only while no attachment record
  -- points at it (rolling back a failed metadata write); recorded evidence stays.
  execute $p$
    create policy "attachments: uploader can remove unrecorded" on storage.objects for delete to authenticated
    using (bucket_id = 'attachments' and owner_id = auth.uid()::text
           and not exists (select 1 from public.attachments a where a.storage_path = storage.objects.name))
  $p$;
end $$;
