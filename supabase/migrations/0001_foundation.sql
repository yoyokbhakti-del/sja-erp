-- =====================================================================
-- 0001 FONDASI: perusahaan, profil, RBAC, audit trail, penomoran,
--               helper untuk mendaftarkan "DocType" (master/transaksi)
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Perusahaan & pengaturan
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  abbr        text not null unique,
  address     text,
  city        text,
  npwp        text,
  phone       text,
  default_ppn numeric(5,2) not null default 11,
  created_at  timestamptz not null default now()
);

create or replace function public.default_company() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.companies order by created_at limit 1
$$;

-- ---------------------------------------------------------------------
-- Profil pengguna (1:1 dengan auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RBAC: role -> izin per doctype (read / write / submit / cancel)
-- doctype '*' = semua doctype
-- ---------------------------------------------------------------------
create table public.roles (
  id          text primary key,
  name        text not null,
  description text
);

create table public.permissions (
  role_id    text not null references public.roles(id) on delete cascade,
  doctype    text not null,
  can_read   boolean not null default true,
  can_write  boolean not null default false,
  can_submit boolean not null default false,
  can_cancel boolean not null default false,
  primary key (role_id, doctype)
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id text not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

create or replace function public.has_perm(p_doctype text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles pr on pr.id = ur.user_id and pr.is_active
    join public.permissions p on p.role_id = ur.role_id
    where ur.user_id = auth.uid()
      and (p.doctype = p_doctype or p.doctype = '*')
      and case p_action
            when 'read'   then p.can_read
            when 'write'  then p.can_write
            when 'submit' then p.can_submit
            when 'cancel' then p.can_cancel
            else false end
  )
$$;

create or replace function public.require_perm(p_doctype text, p_action text)
returns void language plpgsql stable as $$
begin
  if not public.has_perm(p_doctype, p_action) then
    raise exception 'Akses ditolak: tidak punya izin % pada %', p_action, p_doctype
      using errcode = '42501';
  end if;
end $$;

-- Izin milik user yang sedang login (dipakai UI untuk menampilkan menu/tombol)
create or replace function public.my_permissions()
returns table (doctype text, can_read boolean, can_write boolean, can_submit boolean, can_cancel boolean)
language sql stable security definer set search_path = public as $$
  select p.doctype, bool_or(p.can_read), bool_or(p.can_write), bool_or(p.can_submit), bool_or(p.can_cancel)
  from public.user_roles ur
  join public.permissions p on p.role_id = ur.role_id
  join public.profiles pr on pr.id = ur.user_id and pr.is_active
  where ur.user_id = auth.uid()
  group by p.doctype
$$;

-- Profil otomatis saat user mendaftar. User PERTAMA otomatis jadi admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));

  if not exists (select 1 from public.user_roles where role_id = 'admin') then
    insert into public.user_roles values (new.id, 'admin');
  else
    insert into public.user_roles values (new.id, 'viewer');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- AUDIT TRAIL (append-only; tidak bisa diubah/dihapus dari aplikasi)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  user_email text,
  table_name text not null,
  record_id  text,
  action     text not null,          -- INSERT / UPDATE / DELETE / SUBMIT / CANCEL
  changed    jsonb,                  -- untuk UPDATE: hanya kolom yang berubah {kolom: [lama, baru]}
  old_data   jsonb,
  new_data   jsonb
);
create index on public.audit_log (table_name, record_id);
create index on public.audit_log (at desc);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_changed jsonb;
  v_action text := tg_op;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(v_old->k, v_new->k))
      into v_changed
      from jsonb_object_keys(v_new) k
     where (v_old->k) is distinct from (v_new->k)
       and k not in ('updated_at', 'updated_by');
    if v_changed is null then return new; end if;
    if v_changed ? 'docstatus' then
      v_action := case (v_new->>'docstatus') when '1' then 'SUBMIT' when '2' then 'CANCEL' else 'UPDATE' end;
    end if;
  end if;

  insert into public.audit_log (user_id, user_email, table_name, record_id, action, changed, old_data, new_data)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          tg_table_name, coalesce(v_new->>'id', v_old->>'id', v_new->>'code', v_old->>'code'),
          v_action, v_changed,
          case when tg_op = 'DELETE' then v_old end,
          case when tg_op = 'INSERT' then v_new end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Metadata baris: created/updated by/at
-- ---------------------------------------------------------------------
create or replace function public.set_meta()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Penomoran dokumen otomatis ala ERPNext: PO-2026-00001
-- ---------------------------------------------------------------------
create table public.naming_series (
  key     text primary key,     -- contoh: 'PO-2026'
  current integer not null default 0
);

create or replace function public.next_name(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_prefix || '-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY');
  v_n int;
begin
  insert into public.naming_series (key, current) values (v_key, 1)
  on conflict (key) do update set current = naming_series.current + 1
  returning current into v_n;
  return v_key || '-' || lpad(v_n::text, 5, '0');
end $$;

create or replace function public.set_doc_name()
returns trigger language plpgsql as $$
begin
  if new.name is null or new.name = '' then
    new.name := public.next_name(tg_argv[0]);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Siklus dokumen ala ERPNext: docstatus 0=Draft, 1=Submitted, 2=Cancelled
-- Dokumen yang sudah submit TIDAK bisa diedit/dihapus kecuali lewat fungsi
-- submit/cancel resmi (yang menyalakan flag app.bypass di transaksinya).
-- ---------------------------------------------------------------------
create or replace function public.bypass_on() returns boolean language sql stable as $$
  select coalesce(current_setting('app.bypass', true), '') = 'on'
$$;

create or replace function public.guard_parent()
returns trigger language plpgsql as $$
begin
  if public.bypass_on() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.docstatus <> 0 then raise exception 'Dokumen baru harus berstatus Draft'; end if;
    new.status := 'Draft';
    return new;
  elsif tg_op = 'UPDATE' then
    if old.docstatus <> 0 then
      raise exception 'Dokumen % sudah %, tidak bisa diubah', old.name,
        case old.docstatus when 1 then 'disubmit' else 'dibatalkan' end;
    end if;
    if new.docstatus <> old.docstatus then
      raise exception 'Gunakan tombol Submit/Cancel untuk mengubah status dokumen';
    end if;
    return new;
  else -- DELETE
    if old.docstatus = 1 then
      raise exception 'Dokumen % sudah disubmit. Batalkan (Cancel) dulu.', old.name;
    end if;
    return old;
  end if;
end $$;

-- child guard: tg_argv[0] = nama tabel induk
create or replace function public.guard_child()
returns trigger language plpgsql as $$
declare v_status int; v_parent uuid := coalesce(new.parent_id, old.parent_id);
begin
  if public.bypass_on() then return coalesce(new, old); end if;
  execute format('select docstatus from public.%I where id = $1', tg_argv[0])
    into v_status using v_parent;
  if v_status is not null and v_status <> 0 then
    raise exception 'Baris item tidak bisa diubah: dokumen induk sudah disubmit/dibatalkan';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Helper pendaftaran tabel (dipakai migrasi berikutnya)
--   _setup_master(tabel)                 -> meta, audit, RLS
--   _setup_doc(tabel, prefix_penomoran)  -> + penomoran, guard docstatus
--   _setup_child(tabel_anak, tabel_induk)-> guard, audit, RLS ikut induk
-- ---------------------------------------------------------------------
create or replace function public._rls(p_table text, p_doctype text)
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('create policy %I on public.%I for select to authenticated using (public.has_perm(%L, ''read''))',
                 p_table || '_read', p_table, p_doctype);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(%L, ''write''))',
                 p_table || '_insert', p_table, p_doctype);
  execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(%L, ''write'')) with check (public.has_perm(%L, ''write''))',
                 p_table || '_update', p_table, p_doctype, p_doctype);
  execute format('create policy %I on public.%I for delete to authenticated using (public.has_perm(%L, ''write''))',
                 p_table || '_delete', p_table, p_doctype);
end $$;

create or replace function public._setup_master(p_table text)
returns void language plpgsql as $$
begin
  execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_meta()',
                 p_table || '_meta', p_table);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
                 p_table || '_audit', p_table);
  perform public._rls(p_table, p_table);
end $$;

create or replace function public._setup_doc(p_table text, p_prefix text)
returns void language plpgsql as $$
begin
  perform public._setup_master(p_table);
  execute format('create trigger %I before insert on public.%I for each row execute function public.set_doc_name(%L)',
                 p_table || '_name', p_table, p_prefix);
  execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.guard_parent()',
                 p_table || '_guard', p_table);
end $$;

create or replace function public._setup_child(p_table text, p_parent text)
returns void language plpgsql as $$
begin
  execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.guard_child(%L)',
                 p_table || '_guard', p_table, p_parent);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
                 p_table || '_audit', p_table);
  perform public._rls(p_table, p_parent);
end $$;

-- ---------------------------------------------------------------------
-- RLS untuk tabel fondasi
-- ---------------------------------------------------------------------
alter table public.companies     enable row level security;
alter table public.profiles      enable row level security;
alter table public.roles         enable row level security;
alter table public.permissions   enable row level security;
alter table public.user_roles    enable row level security;
alter table public.audit_log     enable row level security;
alter table public.naming_series enable row level security;

create policy companies_read  on public.companies for select to authenticated using (true);
create policy companies_write on public.companies for all to authenticated
  using (public.has_perm('companies','write')) with check (public.has_perm('companies','write'));

create policy profiles_read  on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('users','read'));
create policy profiles_write on public.profiles for update to authenticated
  using (public.has_perm('users','write')) with check (public.has_perm('users','write'));

create policy roles_read on public.roles for select to authenticated using (true);
create policy roles_write on public.roles for all to authenticated
  using (public.has_perm('users','write')) with check (public.has_perm('users','write'));
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy permissions_write on public.permissions for all to authenticated
  using (public.has_perm('users','write')) with check (public.has_perm('users','write'));
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_perm('users','read'));
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.has_perm('users','write')) with check (public.has_perm('users','write'));

create policy audit_read on public.audit_log for select to authenticated
  using (public.has_perm('audit_log','read'));
-- tidak ada policy insert/update/delete -> hanya trigger (security definer) yang bisa menulis
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
revoke all on public.naming_series from anon, authenticated;

create trigger companies_audit   after insert or update or delete on public.companies   for each row execute function public.audit_trigger();
create trigger profiles_audit    after update or delete on public.profiles             for each row execute function public.audit_trigger();
create trigger permissions_audit after insert or update or delete on public.permissions for each row execute function public.audit_trigger();
create trigger user_roles_audit  after insert or update or delete on public.user_roles  for each row execute function public.audit_trigger();
