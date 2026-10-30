-- =====================================================================
-- 0009 "DIPAKAI DI MANA?" untuk pesan hapus yang jelas
--   where_used('items', '<id>') -> daftar dokumen/data yang masih memakai record ini
-- =====================================================================
create or replace function public._where_used_raw(p_table text, p_id text)
returns table (doctype text, doc_name text, status text)
language plpgsql stable security definer set search_path = public as $$
declare
  r record; v_parent text; v_has_name boolean; v_has_status boolean; v_has_code boolean;
begin
  for r in
    select cl.relname tbl, a.attname col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.confrelid = format('public.%I', p_table)::regclass
  loop
    -- riwayat stok / jurnal
    if r.tbl in ('stock_ledger','bins','batches') then
      return query execute format('select ''Riwayat stok''::text, count(*)::text || '' baris'', null::text
                                   from public.%I where %I::text = $1 having count(*) > 0', r.tbl, r.col) using p_id;
      continue;
    end if;
    if r.tbl = 'gl_entries' then
      return query execute format('select ''Jurnal akuntansi''::text, count(*)::text || '' baris'', null::text
                                   from public.gl_entries where %I::text = $1 having count(*) > 0', r.col) using p_id;
      continue;
    end if;

    -- tabel anak -> tampilkan dokumen induknya
    select pc.relname into v_parent
      from pg_constraint c
      join pg_class pc on pc.oid = c.confrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.conrelid = format('public.%I', r.tbl)::regclass and a.attname = 'parent_id'
       and exists (select 1 from information_schema.columns ic
                    where ic.table_schema = 'public' and ic.table_name = pc.relname and ic.column_name = 'docstatus')
     limit 1;
    if v_parent is not null then
      return query execute format(
        'select distinct %L::text, p.name::text, p.status::text from public.%I x join public.%I p on p.id = x.parent_id where x.%I::text = $1',
        v_parent, r.tbl, v_parent, r.col) using p_id;
      continue;
    end if;

    select bool_or(column_name = 'name'), bool_or(column_name = 'status'), bool_or(column_name = 'code')
      into v_has_name, v_has_status, v_has_code
      from information_schema.columns where table_schema = 'public' and table_name = r.tbl;
    return query execute format('select %L::text, (%s)::text, (%s)::text from public.%I where %I::text = $1',
      r.tbl,
      case when v_has_code then 'coalesce(code, name)' when v_has_name then 'name' else '''(1 data)''' end,
      case when v_has_status then 'status' else 'null' end,
      r.tbl, r.col) using p_id;
  end loop;
end $$;
revoke execute on function public._where_used_raw(text, text) from public, anon, authenticated;

create or replace function public.where_used(p_table text, p_id text)
returns table (doctype text, doc_name text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_table, 'write') then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  return query
    select distinct r.doctype, r.doc_name, r.status from public._where_used_raw(p_table, p_id) r
     where r.doctype not in ('Riwayat stok', 'Jurnal akuntansi')
    union all
    select r.doctype, 'sudah ada', null from public._where_used_raw(p_table, p_id) r
     where r.doctype in ('Riwayat stok', 'Jurnal akuntansi') group by r.doctype
    order by 1, 2;
end $$;
revoke execute on function public.where_used(text, text) from public, anon;
grant execute on function public.where_used(text, text) to authenticated;
