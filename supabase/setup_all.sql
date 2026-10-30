-- SJA ERP: SEMUA migrasi + data awal dalam 1 file.
-- Tempel seluruh isi file ini di Supabase > SQL Editor > New query, lalu klik Run (cukup sekali, di project KOSONG).


-- ================= supabase/migrations/0001_foundation.sql =================
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

-- ================= supabase/migrations/0002_master_data.sql =================
-- =====================================================================
-- 0002 MASTER DATA: satuan, grup item, item, gudang, supplier, customer
-- =====================================================================

create table public.uoms (
  code       text primary key,            -- 'Kg', 'L', 'Pcs', 'Botol', 'Sak'
  name       text not null,
  whole_number boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.item_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  parent_id  uuid references public.item_groups(id),
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  item_group_id   uuid references public.item_groups(id),
  item_type       text not null default 'Produk Jadi'
                  check (item_type in ('Bahan Baku','Bahan Kemas','Produk Jadi','Barang Dagang','Jasa','Lainnya')),
  stock_uom       text not null references public.uoms(code),
  is_stock_item   boolean not null default true,
  has_batch       boolean not null default false,
  has_expiry      boolean not null default false,
  shelf_life_days integer,
  standard_buying_rate  numeric(18,2) not null default 0,
  standard_selling_rate numeric(18,2) not null default 0,
  min_qty         numeric(18,3) not null default 0,     -- titik reorder
  reg_number      text,                                 -- No. registrasi Kementan
  description     text,
  disabled        boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  constraint expiry_needs_batch check (not has_expiry or has_batch)
);

create table public.warehouses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  warehouse_type text not null default 'Umum'
                 check (warehouse_type in ('Umum','Karantina','Bahan Baku','Bahan Kemas','Produk Jadi','Reject','Transit')),
  company_id     uuid not null default public.default_company() references public.companies(id),
  is_group       boolean not null default false,
  disabled       boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  supplier_group   text default 'Lokal' check (supplier_group in ('Lokal','Impor','Jasa')),
  npwp             text,
  address          text,
  city             text,
  phone            text,
  email            text,
  contact_person   text,
  payment_terms_days integer not null default 30,
  is_approved      boolean not null default false,   -- Approved Vendor (CPOHB)
  disabled         boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  customer_group   text default 'Distributor'
                   check (customer_group in ('Distributor','Poultry Shop','Peternak','Tambak','Pemerintah','Lainnya')),
  npwp             text,
  address          text,
  city             text,
  phone            text,
  email            text,
  contact_person   text,
  payment_terms_days integer not null default 30,
  credit_limit     numeric(18,2) not null default 0,
  disabled         boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

select public._setup_master('uoms');
select public._setup_master('item_groups');
select public._setup_master('items');
select public._setup_master('warehouses');
select public._setup_master('suppliers');
select public._setup_master('customers');

-- ================= supabase/migrations/0003_stock.sql =================
-- =====================================================================
-- 0003 STOK & GUDANG
--   batches        : nomor batch + tanggal produksi/kedaluwarsa
--   bins           : saldo per item+gudang (qty, nilai, harga rata-rata)
--   stock_ledger   : buku besar stok, append-only (sumber kebenaran)
--   stock_entries  : dokumen Stock Entry (terima / keluar / transfer)
-- Valuasi: moving average per item+gudang. Pengeluaran batch: FEFO.
-- =====================================================================

create table public.batches (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.items(id),
  batch_no         text not null,
  mfg_date         date,
  expiry_date      date,
  supplier_batch_no text,
  created_at       timestamptz not null default now(),
  unique (item_id, batch_no)
);

create table public.bins (
  item_id        uuid not null references public.items(id),
  warehouse_id   uuid not null references public.warehouses(id),
  actual_qty     numeric(18,3) not null default 0,
  valuation_rate numeric(18,4) not null default 0,
  stock_value    numeric(18,2) not null default 0,
  primary key (item_id, warehouse_id)
);

create table public.stock_ledger (
  id                    bigserial primary key,
  posting_date          date not null,
  created_at            timestamptz not null default now(),
  item_id               uuid not null references public.items(id),
  warehouse_id          uuid not null references public.warehouses(id),
  batch_id              uuid references public.batches(id),
  qty                   numeric(18,3) not null,       -- + masuk, - keluar
  valuation_rate        numeric(18,4) not null,
  stock_value_difference numeric(18,2) not null,
  qty_after             numeric(18,3) not null,        -- saldo item+gudang setelah transaksi
  voucher_type          text not null,
  voucher_id            uuid not null,
  voucher_no            text not null,
  is_cancelled          boolean not null default false,
  created_by            uuid default auth.uid()
);
create index on public.stock_ledger (item_id, warehouse_id, batch_id);
create index on public.stock_ledger (voucher_type, voucher_id);
create index on public.stock_ledger (posting_date);

-- Tabel ledger hanya bisa ditulis lewat fungsi posting (security definer)
alter table public.batches      enable row level security;
alter table public.bins         enable row level security;
alter table public.stock_ledger enable row level security;
create policy batches_read on public.batches      for select to authenticated using (public.has_perm('stock_ledger','read'));
create policy bins_read    on public.bins         for select to authenticated using (public.has_perm('stock_ledger','read'));
create policy sle_read     on public.stock_ledger for select to authenticated using (public.has_perm('stock_ledger','read'));
revoke insert, update, delete, truncate on public.batches, public.bins, public.stock_ledger from anon, authenticated;

-- ---------------------------------------------------------------------
-- Posting satu baris ledger + update bin (internal)
-- ---------------------------------------------------------------------
create or replace function public._post_sle(
  p_item uuid, p_wh uuid, p_batch uuid, p_qty numeric, p_rate numeric,
  p_date date, p_vtype text, p_vid uuid, p_vno text, p_cancel boolean default false)
returns numeric  -- valuation rate yang dipakai
language plpgsql security definer set search_path = public as $$
declare
  b public.bins;
  v_rate numeric;
  v_diff numeric;
  v_batch_qty numeric;
  v_item public.items;
begin
  select * into v_item from public.items where id = p_item;
  if not v_item.is_stock_item then return coalesce(p_rate, 0); end if;

  insert into public.bins (item_id, warehouse_id) values (p_item, p_wh) on conflict do nothing;
  select * into b from public.bins where item_id = p_item and warehouse_id = p_wh for update;

  if p_qty < 0 then
    if b.actual_qty + p_qty < 0 then
      raise exception 'Stok tidak cukup: % di gudang %. Tersedia %, dibutuhkan %',
        v_item.code, (select code from public.warehouses where id = p_wh), b.actual_qty, -p_qty;
    end if;
    if p_batch is not null then
      select coalesce(sum(qty), 0) into v_batch_qty from public.stock_ledger
       where item_id = p_item and warehouse_id = p_wh and batch_id = p_batch;
      if v_batch_qty + p_qty < 0 then
        raise exception 'Stok batch % (%) tidak cukup. Tersedia %, dibutuhkan %',
          (select batch_no from public.batches where id = p_batch), v_item.code, v_batch_qty, -p_qty;
      end if;
    end if;
    v_rate := coalesce(p_rate, b.valuation_rate);   -- keluar: pakai harga rata-rata (atau rate asal saat cancel)
    v_diff := round(p_qty * v_rate, 2);
    if b.actual_qty + p_qty = 0 then v_diff := -b.stock_value; end if;  -- hindari sisa pembulatan
    update public.bins set actual_qty = actual_qty + p_qty,
                           stock_value = stock_value + v_diff
     where item_id = p_item and warehouse_id = p_wh;
  else
    v_rate := coalesce(p_rate, b.valuation_rate, 0);
    v_diff := round(p_qty * v_rate, 2);
    update public.bins set actual_qty = actual_qty + p_qty,
                           stock_value = stock_value + v_diff,
                           valuation_rate = case when actual_qty + p_qty > 0
                                                 then (stock_value + v_diff) / (actual_qty + p_qty)
                                                 else valuation_rate end
     where item_id = p_item and warehouse_id = p_wh;
  end if;

  insert into public.stock_ledger (posting_date, item_id, warehouse_id, batch_id, qty, valuation_rate,
                                   stock_value_difference, qty_after, voucher_type, voucher_id, voucher_no, is_cancelled)
  values (p_date, p_item, p_wh, p_batch, p_qty, v_rate, v_diff, b.actual_qty + p_qty,
          p_vtype, p_vid, p_vno, p_cancel);
  return v_rate;
end $$;

-- Cari / buat batch (untuk transaksi masuk)
create or replace function public._ensure_batch(
  p_item uuid, p_batch_no text, p_mfg date, p_exp date, p_supplier_batch text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_item public.items; v_id uuid;
begin
  select * into v_item from public.items where id = p_item;
  if not v_item.has_batch then return null; end if;
  if coalesce(p_batch_no, '') = '' then
    raise exception 'Item % wajib diisi Nomor Batch', v_item.code;
  end if;
  select id into v_id from public.batches where item_id = p_item and batch_no = p_batch_no;
  if v_id is null then
    if v_item.has_expiry and p_exp is null then
      if v_item.shelf_life_days is not null and p_mfg is not null then
        p_exp := p_mfg + v_item.shelf_life_days;
      else
        raise exception 'Item % wajib diisi Tanggal Kedaluwarsa untuk batch %', v_item.code, p_batch_no;
      end if;
    end if;
    insert into public.batches (item_id, batch_no, mfg_date, expiry_date, supplier_batch_no)
    values (p_item, p_batch_no, p_mfg, p_exp, p_supplier_batch) returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Pengeluaran FEFO (First Expired First Out).
-- Jika p_batch_no diisi -> keluarkan dari batch itu saja.
-- Batch kedaluwarsa tidak boleh keluar kecuali p_allow_expired (mis. ke gudang Reject).
-- Mengembalikan alokasi (batch_id, qty, rate) untuk dipakai transfer.
-- ---------------------------------------------------------------------
create or replace function public._issue_stock(
  p_item uuid, p_wh uuid, p_qty numeric, p_batch_no text,
  p_date date, p_vtype text, p_vid uuid, p_vno text, p_allow_expired boolean default false)
returns table (batch_id uuid, qty numeric, rate numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_remaining numeric := p_qty;
  v_take numeric;
  r record;
  v_batch uuid;
  v_rate numeric;
begin
  select * into v_item from public.items where id = p_item;

  if not v_item.has_batch then
    v_rate := public._post_sle(p_item, p_wh, null, -p_qty, null, p_date, p_vtype, p_vid, p_vno);
    batch_id := null; qty := p_qty; rate := v_rate; return next; return;
  end if;

  if coalesce(p_batch_no, '') <> '' then
    select b.id into v_batch from public.batches b where b.item_id = p_item and b.batch_no = p_batch_no;
    if v_batch is null then raise exception 'Batch % untuk item % tidak ditemukan', p_batch_no, v_item.code; end if;
    if not p_allow_expired and exists (select 1 from public.batches b where b.id = v_batch and b.expiry_date < p_date) then
      raise exception 'Batch % (%) sudah kedaluwarsa, tidak boleh dikeluarkan', p_batch_no, v_item.code;
    end if;
    v_rate := public._post_sle(p_item, p_wh, v_batch, -p_qty, null, p_date, p_vtype, p_vid, p_vno);
    batch_id := v_batch; qty := p_qty; rate := v_rate; return next; return;
  end if;

  for r in
    select b.id, b.batch_no, s.bal
      from public.batches b
      join (select sl.batch_id, sum(sl.qty) bal from public.stock_ledger sl
             where sl.item_id = p_item and sl.warehouse_id = p_wh group by sl.batch_id) s on s.batch_id = b.id
     where s.bal > 0
       and (p_allow_expired or b.expiry_date is null or b.expiry_date >= p_date)
     order by b.expiry_date nulls last, b.mfg_date nulls last, b.created_at
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, r.bal);
    v_rate := public._post_sle(p_item, p_wh, r.id, -v_take, null, p_date, p_vtype, p_vid, p_vno);
    batch_id := r.id; qty := v_take; rate := v_rate; return next;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Stok batch (belum kedaluwarsa) untuk % di gudang % tidak cukup. Kurang %',
      v_item.code, (select code from public.warehouses where id = p_wh), v_remaining;
  end if;
end $$;

-- Pembatalan: balik semua baris ledger suatu voucher
create or replace function public._reverse_sle(p_vtype text, p_vid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.stock_ledger;
begin
  -- balik yang masuk dulu? Tidak: balik keluar dulu (mengembalikan stok), baru tarik yang masuk.
  for r in select * from public.stock_ledger
            where voucher_type = p_vtype and voucher_id = p_vid and not is_cancelled
            order by (qty > 0), id desc
  loop
    perform public._post_sle(r.item_id, r.warehouse_id, r.batch_id, -r.qty, r.valuation_rate,
                             r.posting_date, r.voucher_type, r.voucher_id, r.voucher_no, true);
  end loop;
  update public.stock_ledger set is_cancelled = true where voucher_type = p_vtype and voucher_id = p_vid;
end $$;

-- ---------------------------------------------------------------------
-- STOCK ENTRY
-- ---------------------------------------------------------------------
create table public.stock_entries (
  id              uuid primary key default gen_random_uuid(),
  name            text unique,
  purpose         text not null default 'Penerimaan Material'
                  check (purpose in ('Penerimaan Material','Pengeluaran Material','Transfer Material')),
  posting_date    date not null default current_date,
  from_warehouse_id uuid references public.warehouses(id),
  to_warehouse_id   uuid references public.warehouses(id),
  company_id      uuid not null default public.default_company() references public.companies(id),
  remarks         text,
  total_amount    numeric(18,2) not null default 0,
  docstatus       smallint not null default 0,
  status          text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.stock_entry_items (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid not null references public.stock_entries(id) on delete cascade,
  idx            integer not null default 1,
  item_id        uuid not null references public.items(id),
  qty            numeric(18,3) not null check (qty > 0),
  s_warehouse_id uuid references public.warehouses(id),
  t_warehouse_id uuid references public.warehouses(id),
  batch_no       text,
  mfg_date       date,
  expiry_date    date,
  basic_rate     numeric(18,4) not null default 0,
  amount         numeric(18,2) generated always as (round(qty * basic_rate, 2)) stored
);

select public._setup_doc('stock_entries', 'STE');
select public._setup_child('stock_entry_items', 'stock_entries');

-- ================= supabase/migrations/0004_buying_selling.sql =================
-- =====================================================================
-- 0004 PEMBELIAN & PENJUALAN
--   Purchase Order -> Purchase Receipt (stok masuk) -> Purchase Invoice
--   Sales Order    -> Delivery Note (stok keluar FEFO) -> Sales Invoice
-- =====================================================================

-- ------------------------- PEMBELIAN ---------------------------------
create table public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  name             text unique,
  supplier_id      uuid not null references public.suppliers(id),
  transaction_date date not null default current_date,
  schedule_date    date,
  set_warehouse_id uuid references public.warehouses(id),
  company_id       uuid not null default public.default_company() references public.companies(id),
  ppn_percent      numeric(5,2) not null default 11,
  total_qty        numeric(18,3) not null default 0,
  net_total        numeric(18,2) not null default 0,
  tax_amount       numeric(18,2) not null default 0,
  grand_total      numeric(18,2) not null default 0,
  per_received     numeric(5,2) not null default 0,
  remarks          text,
  docstatus        smallint not null default 0,
  status           text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.purchase_order_items (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references public.purchase_orders(id) on delete cascade,
  idx          integer not null default 1,
  item_id      uuid not null references public.items(id),
  qty          numeric(18,3) not null check (qty > 0),
  rate         numeric(18,2) not null default 0 check (rate >= 0),
  amount       numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  warehouse_id uuid references public.warehouses(id),
  received_qty numeric(18,3) not null default 0
);

create table public.purchase_receipts (
  id                uuid primary key default gen_random_uuid(),
  name              text unique,
  supplier_id       uuid not null references public.suppliers(id),
  posting_date      date not null default current_date,
  supplier_delivery_note text,                          -- No. surat jalan supplier
  purchase_order_id uuid references public.purchase_orders(id),
  set_warehouse_id  uuid references public.warehouses(id),
  company_id        uuid not null default public.default_company() references public.companies(id),
  ppn_percent       numeric(5,2) not null default 11,
  total_qty         numeric(18,3) not null default 0,
  net_total         numeric(18,2) not null default 0,
  tax_amount        numeric(18,2) not null default 0,
  grand_total       numeric(18,2) not null default 0,
  remarks           text,
  docstatus         smallint not null default 0,
  status            text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.purchase_receipt_items (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references public.purchase_receipts(id) on delete cascade,
  idx          integer not null default 1,
  item_id      uuid not null references public.items(id),
  qty          numeric(18,3) not null check (qty > 0),
  rate         numeric(18,2) not null default 0 check (rate >= 0),
  amount       numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  warehouse_id uuid references public.warehouses(id),
  batch_no     text,
  mfg_date     date,
  expiry_date  date,
  po_item_id   uuid references public.purchase_order_items(id)
);

create table public.purchase_invoices (
  id                  uuid primary key default gen_random_uuid(),
  name                text unique,
  supplier_id         uuid not null references public.suppliers(id),
  posting_date        date not null default current_date,
  due_date            date,
  bill_no             text,                         -- No. invoice supplier
  faktur_pajak_no     text,
  purchase_receipt_id uuid references public.purchase_receipts(id),
  company_id          uuid not null default public.default_company() references public.companies(id),
  ppn_percent         numeric(5,2) not null default 11,
  total_qty           numeric(18,3) not null default 0,
  net_total           numeric(18,2) not null default 0,
  tax_amount          numeric(18,2) not null default 0,
  grand_total         numeric(18,2) not null default 0,
  outstanding_amount  numeric(18,2) not null default 0,
  remarks             text,
  docstatus           smallint not null default 0,
  status              text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.purchase_invoice_items (
  id        uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.purchase_invoices(id) on delete cascade,
  idx       integer not null default 1,
  item_id   uuid not null references public.items(id),
  qty       numeric(18,3) not null check (qty > 0),
  rate      numeric(18,2) not null default 0 check (rate >= 0),
  amount    numeric(18,2) generated always as (round(qty * rate, 2)) stored
);

-- ------------------------- PENJUALAN ---------------------------------
create table public.sales_orders (
  id               uuid primary key default gen_random_uuid(),
  name             text unique,
  customer_id      uuid not null references public.customers(id),
  transaction_date date not null default current_date,
  delivery_date    date,
  po_no            text,                           -- No. PO dari customer
  set_warehouse_id uuid references public.warehouses(id),
  company_id       uuid not null default public.default_company() references public.companies(id),
  ppn_percent      numeric(5,2) not null default 11,
  total_qty        numeric(18,3) not null default 0,
  net_total        numeric(18,2) not null default 0,
  tax_amount       numeric(18,2) not null default 0,
  grand_total      numeric(18,2) not null default 0,
  per_delivered    numeric(5,2) not null default 0,
  remarks          text,
  docstatus        smallint not null default 0,
  status           text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.sales_order_items (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid not null references public.sales_orders(id) on delete cascade,
  idx           integer not null default 1,
  item_id       uuid not null references public.items(id),
  qty           numeric(18,3) not null check (qty > 0),
  rate          numeric(18,2) not null default 0 check (rate >= 0),
  amount        numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  warehouse_id  uuid references public.warehouses(id),
  delivered_qty numeric(18,3) not null default 0
);

create table public.delivery_notes (
  id               uuid primary key default gen_random_uuid(),
  name             text unique,
  customer_id      uuid not null references public.customers(id),
  posting_date     date not null default current_date,
  sales_order_id   uuid references public.sales_orders(id),
  set_warehouse_id uuid references public.warehouses(id),
  vehicle_no       text,
  driver_name      text,
  company_id       uuid not null default public.default_company() references public.companies(id),
  ppn_percent      numeric(5,2) not null default 11,
  total_qty        numeric(18,3) not null default 0,
  net_total        numeric(18,2) not null default 0,
  tax_amount       numeric(18,2) not null default 0,
  grand_total      numeric(18,2) not null default 0,
  remarks          text,
  docstatus        smallint not null default 0,
  status           text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.delivery_note_items (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references public.delivery_notes(id) on delete cascade,
  idx              integer not null default 1,
  item_id          uuid not null references public.items(id),
  qty              numeric(18,3) not null check (qty > 0),
  rate             numeric(18,2) not null default 0 check (rate >= 0),
  amount           numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  warehouse_id     uuid references public.warehouses(id),
  batch_no         text,                 -- kosongkan = otomatis FEFO
  batch_allocation text,                 -- diisi sistem saat submit, mis. "B001 (60), B002 (40)"
  so_item_id       uuid references public.sales_order_items(id)
);

create table public.sales_invoices (
  id                 uuid primary key default gen_random_uuid(),
  name               text unique,
  customer_id        uuid not null references public.customers(id),
  posting_date       date not null default current_date,
  due_date           date,
  faktur_pajak_no    text,
  delivery_note_id   uuid references public.delivery_notes(id),
  company_id         uuid not null default public.default_company() references public.companies(id),
  ppn_percent        numeric(5,2) not null default 11,
  total_qty          numeric(18,3) not null default 0,
  net_total          numeric(18,2) not null default 0,
  tax_amount         numeric(18,2) not null default 0,
  grand_total        numeric(18,2) not null default 0,
  outstanding_amount numeric(18,2) not null default 0,
  remarks            text,
  docstatus          smallint not null default 0,
  status             text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.sales_invoice_items (
  id        uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.sales_invoices(id) on delete cascade,
  idx       integer not null default 1,
  item_id   uuid not null references public.items(id),
  qty       numeric(18,3) not null check (qty > 0),
  rate      numeric(18,2) not null default 0 check (rate >= 0),
  amount    numeric(18,2) generated always as (round(qty * rate, 2)) stored
);

alter table public.stock_entry_items add column batch_allocation text;

-- Pendaftaran doctype (penomoran, audit, RLS, guard)
select public._setup_doc('purchase_orders',   'PO');
select public._setup_doc('purchase_receipts', 'PR');
select public._setup_doc('purchase_invoices', 'PINV');
select public._setup_doc('sales_orders',      'SO');
select public._setup_doc('delivery_notes',    'DN');
select public._setup_doc('sales_invoices',    'SINV');
select public._setup_child('purchase_order_items',   'purchase_orders');
select public._setup_child('purchase_receipt_items', 'purchase_receipts');
select public._setup_child('purchase_invoice_items', 'purchase_invoices');
select public._setup_child('sales_order_items',      'sales_orders');
select public._setup_child('delivery_note_items',    'delivery_notes');
select public._setup_child('sales_invoice_items',    'sales_invoices');

-- ---------------------------------------------------------------------
-- TOTAL OTOMATIS
-- ---------------------------------------------------------------------
-- Induk: hitung PPN & grand total dari net_total (+ outstanding & jatuh tempo untuk invoice)
create or replace function public.calc_parent_totals()
returns trigger language plpgsql as $$
declare v_terms int;
begin
  if new.docstatus = 0 then
    new.tax_amount  := round(new.net_total * new.ppn_percent / 100, 2);
    new.grand_total := new.net_total + new.tax_amount;
    if tg_table_name in ('purchase_invoices','sales_invoices') then
      new.outstanding_amount := new.grand_total;
      if new.due_date is null then
        if tg_table_name = 'sales_invoices' then
          select payment_terms_days into v_terms from public.customers where id = new.customer_id;
        else
          select payment_terms_days into v_terms from public.suppliers where id = new.supplier_id;
        end if;
        new.due_date := new.posting_date + coalesce(v_terms, 30);
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_receipts','purchase_invoices',
                           'sales_orders','delivery_notes','sales_invoices'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.calc_parent_totals()',
                   t || '_totals', t);
  end loop;
end $$;

-- Anak: jumlahkan qty & amount ke induk
create or replace function public.rollup_child()
returns trigger language plpgsql as $$
declare
  v_parent uuid := coalesce(new.parent_id, old.parent_id);
  v_child  text := tg_table_name;
  v_ptable text := tg_argv[0];
begin
  if v_ptable = 'stock_entries' then
    execute format('update public.stock_entries set total_amount =
                     (select coalesce(sum(amount),0) from public.%I where parent_id = $1)
                   where id = $1 and docstatus = 0', v_child) using v_parent;
  else
    execute format('update public.%I set
                      total_qty = (select coalesce(sum(qty),0)    from public.%I where parent_id = $1),
                      net_total = (select coalesce(sum(amount),0) from public.%I where parent_id = $1)
                    where id = $1 and docstatus = 0', v_ptable, v_child, v_child) using v_parent;
  end if;
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('stock_entry_items','stock_entries'),
      ('purchase_order_items','purchase_orders'), ('purchase_receipt_items','purchase_receipts'),
      ('purchase_invoice_items','purchase_invoices'), ('sales_order_items','sales_orders'),
      ('delivery_note_items','delivery_notes'), ('sales_invoice_items','sales_invoices')) v(child, parent)
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.rollup_child(%L)',
                   r.child || '_rollup', r.child, r.parent);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- STATUS PO / SO
-- ---------------------------------------------------------------------
create or replace function public._update_po_status(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_per numeric;
begin
  select coalesce(round(100 * sum(least(received_qty, qty)) / nullif(sum(qty),0), 2), 0)
    into v_per from public.purchase_order_items where parent_id = p_po;
  update public.purchase_orders
     set per_received = v_per,
         status = case when v_per >= 100 then 'Selesai'
                       when v_per > 0   then 'Diterima Sebagian'
                       else 'Menunggu Penerimaan' end
   where id = p_po and docstatus = 1;
end $$;

create or replace function public._update_so_status(p_so uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_per numeric;
begin
  select coalesce(round(100 * sum(least(delivered_qty, qty)) / nullif(sum(qty),0), 2), 0)
    into v_per from public.sales_order_items where parent_id = p_so;
  update public.sales_orders
     set per_delivered = v_per,
         status = case when v_per >= 100 then 'Selesai'
                       when v_per > 0   then 'Terkirim Sebagian'
                       else 'Menunggu Pengiriman' end
   where id = p_so and docstatus = 1;
end $$;

-- ---------------------------------------------------------------------
-- LOGIKA SUBMIT PER DOCTYPE
-- ---------------------------------------------------------------------
create or replace function public._submit_stock_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  d public.stock_entries;
  r public.stock_entry_items;
  a record;
  v_s uuid; v_t uuid; v_batch uuid; v_alloc text; v_val numeric; v_allow_exp boolean;
begin
  select * into d from public.stock_entries where id = p_id;
  for r in select * from public.stock_entry_items where parent_id = p_id order by idx loop
    v_s := coalesce(r.s_warehouse_id, d.from_warehouse_id);
    v_t := coalesce(r.t_warehouse_id, d.to_warehouse_id);

    if d.purpose = 'Penerimaan Material' then
      if v_t is null then raise exception 'Baris %: Gudang tujuan wajib diisi', r.idx; end if;
      v_batch := public._ensure_batch(r.item_id, r.batch_no, r.mfg_date, r.expiry_date);
      perform public._post_sle(r.item_id, v_t, v_batch, r.qty, nullif(r.basic_rate, 0),
                               d.posting_date, 'stock_entries', d.id, d.name);
    else
      if v_s is null then raise exception 'Baris %: Gudang asal wajib diisi', r.idx; end if;
      if d.purpose = 'Transfer Material' then
        if v_t is null then raise exception 'Baris %: Gudang tujuan wajib diisi', r.idx; end if;
        if v_t = v_s then raise exception 'Baris %: Gudang asal dan tujuan sama', r.idx; end if;
        select warehouse_type in ('Reject','Karantina') into v_allow_exp from public.warehouses where id = v_t;
      else
        v_allow_exp := true;   -- pengeluaran (mis. pemusnahan) boleh untuk batch kedaluwarsa
      end if;

      v_alloc := null; v_val := 0;
      for a in select * from public._issue_stock(r.item_id, v_s, r.qty, r.batch_no, d.posting_date,
                                                  'stock_entries', d.id, d.name, v_allow_exp) loop
        v_val := v_val + a.qty * a.rate;
        if a.batch_id is not null then
          v_alloc := concat_ws(', ', v_alloc,
                     (select batch_no from public.batches where id = a.batch_id) || ' (' || trim_scale(a.qty) || ')');
        end if;
        if d.purpose = 'Transfer Material' then
          perform public._post_sle(r.item_id, v_t, a.batch_id, a.qty, a.rate,
                                   d.posting_date, 'stock_entries', d.id, d.name);
        end if;
      end loop;
      update public.stock_entry_items
         set basic_rate = round(v_val / r.qty, 4), batch_allocation = v_alloc
       where id = r.id;
    end if;
  end loop;
  update public.stock_entries set total_amount =
    (select coalesce(sum(amount),0) from public.stock_entry_items where parent_id = p_id) where id = p_id;
end $$;

create or replace function public._check_approved_vendor(p_supplier uuid, p_child text, p_parent uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_bad text;
begin
  if exists (select 1 from public.suppliers where id = p_supplier and is_approved) then return; end if;
  execute format('select string_agg(i.code, '', '') from public.%I c join public.items i on i.id = c.item_id
                  where c.parent_id = $1 and i.item_type in (''Bahan Baku'',''Bahan Kemas'')', p_child)
    into v_bad using p_parent;
  if v_bad is not null then
    raise exception 'Supplier belum berstatus Approved Vendor (CPOHB). Tidak boleh membeli bahan: %', v_bad;
  end if;
end $$;

create or replace function public._submit_purchase_receipt(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.purchase_receipts;
  r public.purchase_receipt_items;
  v_wh uuid; v_batch uuid; v_over boolean;
begin
  select * into d from public.purchase_receipts where id = p_id;
  perform public._check_approved_vendor(d.supplier_id, 'purchase_receipt_items', p_id);
  for r in select * from public.purchase_receipt_items where parent_id = p_id order by idx loop
    v_wh := coalesce(r.warehouse_id, d.set_warehouse_id);
    if v_wh is null and exists (select 1 from public.items where id = r.item_id and is_stock_item) then
      raise exception 'Baris %: Gudang penerimaan wajib diisi', r.idx;
    end if;
    v_batch := public._ensure_batch(r.item_id, r.batch_no, r.mfg_date, r.expiry_date);
    if v_wh is not null then
      perform public._post_sle(r.item_id, v_wh, v_batch, r.qty, r.rate,
                               d.posting_date, 'purchase_receipts', d.id, d.name);
    end if;
    if r.po_item_id is not null then
      update public.purchase_order_items set received_qty = received_qty + r.qty
       where id = r.po_item_id returning received_qty > qty into v_over;
      if v_over then raise exception 'Baris %: Qty diterima melebihi qty di Purchase Order', r.idx; end if;
    end if;
  end loop;
  if d.purchase_order_id is not null then perform public._update_po_status(d.purchase_order_id); end if;
end $$;

create or replace function public._submit_delivery_note(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.delivery_notes;
  r public.delivery_note_items;
  a record;
  v_wh uuid; v_alloc text; v_over boolean;
begin
  select * into d from public.delivery_notes where id = p_id;
  for r in select * from public.delivery_note_items where parent_id = p_id order by idx loop
    v_wh := coalesce(r.warehouse_id, d.set_warehouse_id);
    if v_wh is null and exists (select 1 from public.items where id = r.item_id and is_stock_item) then
      raise exception 'Baris %: Gudang pengiriman wajib diisi', r.idx;
    end if;
    v_alloc := null;
    if v_wh is not null then
      for a in select * from public._issue_stock(r.item_id, v_wh, r.qty, r.batch_no, d.posting_date,
                                                  'delivery_notes', d.id, d.name, false) loop
        if a.batch_id is not null then
          v_alloc := concat_ws(', ', v_alloc,
                     (select batch_no from public.batches where id = a.batch_id) || ' (' || trim_scale(a.qty) || ')');
        end if;
      end loop;
      update public.delivery_note_items set batch_allocation = v_alloc where id = r.id;
    end if;
    if r.so_item_id is not null then
      update public.sales_order_items set delivered_qty = delivered_qty + r.qty
       where id = r.so_item_id returning delivered_qty > qty into v_over;
      if v_over then raise exception 'Baris %: Qty kirim melebihi qty di Sales Order', r.idx; end if;
    end if;
  end loop;
  if d.sales_order_id is not null then perform public._update_so_status(d.sales_order_id); end if;
end $$;

create or replace function public._check_credit_limit(p_so uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cust public.customers; v_total numeric; v_new numeric;
begin
  select c.* into v_cust from public.customers c join public.sales_orders s on s.customer_id = c.id where s.id = p_so;
  if v_cust.credit_limit <= 0 then return; end if;
  select grand_total into v_new from public.sales_orders where id = p_so;
  select coalesce(sum(outstanding_amount), 0) into v_total
    from public.sales_invoices where customer_id = v_cust.id and docstatus = 1;
  if v_total + v_new > v_cust.credit_limit then
    raise exception 'Melebihi plafon kredit customer %: piutang % + SO % > limit %',
      v_cust.name, v_total, v_new, v_cust.credit_limit;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- SUBMIT / CANCEL (dipanggil UI lewat supabase.rpc)
-- ---------------------------------------------------------------------
create or replace function public._child_of(p_doctype text) returns text
language sql immutable as $$
  select case p_doctype
    when 'stock_entries'     then 'stock_entry_items'
    when 'purchase_orders'   then 'purchase_order_items'
    when 'purchase_receipts' then 'purchase_receipt_items'
    when 'purchase_invoices' then 'purchase_invoice_items'
    when 'sales_orders'      then 'sales_order_items'
    when 'delivery_notes'    then 'delivery_note_items'
    when 'sales_invoices'    then 'sales_invoice_items'
  end
$$;

create or replace function public.submit_doc(p_doctype text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ds int; v_name text; v_status text; v_child text := public._child_of(p_doctype); v_n int;
        v_link uuid;
begin
  if v_child is null then raise exception 'Doctype % tidak bisa disubmit', p_doctype; end if;
  perform public.require_perm(p_doctype, 'submit');
  execute format('select docstatus, name from public.%I where id = $1 for update', p_doctype)
    into v_ds, v_name using p_id;
  if v_ds is null then raise exception 'Dokumen tidak ditemukan'; end if;
  if v_ds <> 0 then raise exception 'Dokumen % bukan Draft', v_name; end if;
  execute format('select count(*) from public.%I where parent_id = $1', v_child) into v_n using p_id;
  if v_n = 0 then raise exception 'Dokumen % belum punya baris item', v_name; end if;

  perform set_config('app.bypass', 'on', true);

  v_status := 'Submitted';
  case p_doctype
    when 'stock_entries'     then perform public._submit_stock_entry(p_id);
    when 'purchase_receipts' then perform public._submit_purchase_receipt(p_id);
    when 'delivery_notes'    then perform public._submit_delivery_note(p_id);
    when 'purchase_orders'   then
      perform public._check_approved_vendor((select supplier_id from public.purchase_orders where id = p_id),
                                            'purchase_order_items', p_id);
      v_status := 'Menunggu Penerimaan';
    when 'sales_orders'      then
      perform public._check_credit_limit(p_id);
      v_status := 'Menunggu Pengiriman';
    when 'sales_invoices'    then
      select delivery_note_id into v_link from public.sales_invoices where id = p_id;
      if v_link is not null and exists (select 1 from public.sales_invoices
           where delivery_note_id = v_link and docstatus = 1 and id <> p_id) then
        raise exception 'Delivery Note ini sudah ditagih di invoice lain';
      end if;
      v_status := 'Belum Dibayar';
    when 'purchase_invoices' then
      select purchase_receipt_id into v_link from public.purchase_invoices where id = p_id;
      if v_link is not null and exists (select 1 from public.purchase_invoices
           where purchase_receipt_id = v_link and docstatus = 1 and id <> p_id) then
        raise exception 'Purchase Receipt ini sudah ditagih di invoice lain';
      end if;
      v_status := 'Belum Dibayar';
    else null;
  end case;

  execute format('update public.%I set docstatus = 1, status = $2 where id = $1', p_doctype)
    using p_id, v_status;
  if p_doctype = 'purchase_orders' then perform public._update_po_status(p_id); end if;
  if p_doctype = 'sales_orders'    then perform public._update_so_status(p_id); end if;

  perform set_config('app.bypass', 'off', true);
  return v_name;
end $$;

create or replace function public.cancel_doc(p_doctype text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ds int; v_name text; v_dep text; r record; v_link uuid;
begin
  if public._child_of(p_doctype) is null then raise exception 'Doctype % tidak bisa dibatalkan', p_doctype; end if;
  perform public.require_perm(p_doctype, 'cancel');
  execute format('select docstatus, name from public.%I where id = $1 for update', p_doctype)
    into v_ds, v_name using p_id;
  if v_ds is distinct from 1 then raise exception 'Hanya dokumen yang sudah Submit yang bisa dibatalkan'; end if;

  -- Cek dokumen turunan yang masih aktif (harus dibatalkan dulu, seperti ERPNext)
  v_dep := case p_doctype
    when 'purchase_orders'   then (select string_agg(name, ', ') from public.purchase_receipts where purchase_order_id = p_id and docstatus = 1)
    when 'purchase_receipts' then (select string_agg(name, ', ') from public.purchase_invoices where purchase_receipt_id = p_id and docstatus = 1)
    when 'sales_orders'      then (select string_agg(name, ', ') from public.delivery_notes where sales_order_id = p_id and docstatus = 1)
    when 'delivery_notes'    then (select string_agg(name, ', ') from public.sales_invoices where delivery_note_id = p_id and docstatus = 1)
  end;
  if v_dep is not null then
    raise exception 'Tidak bisa membatalkan %: masih dipakai oleh %. Batalkan dokumen tersebut dulu.', v_name, v_dep;
  end if;

  perform set_config('app.bypass', 'on', true);

  if p_doctype in ('stock_entries','purchase_receipts','delivery_notes') then
    perform public._reverse_sle(p_doctype, p_id);
  end if;

  if p_doctype = 'purchase_receipts' then
    for r in select po_item_id, qty from public.purchase_receipt_items where parent_id = p_id and po_item_id is not null loop
      update public.purchase_order_items set received_qty = received_qty - r.qty where id = r.po_item_id;
    end loop;
    select purchase_order_id into v_link from public.purchase_receipts where id = p_id;
    if v_link is not null then perform public._update_po_status(v_link); end if;
  elsif p_doctype = 'delivery_notes' then
    for r in select so_item_id, qty from public.delivery_note_items where parent_id = p_id and so_item_id is not null loop
      update public.sales_order_items set delivered_qty = delivered_qty - r.qty where id = r.so_item_id;
    end loop;
    select sales_order_id into v_link from public.delivery_notes where id = p_id;
    if v_link is not null then perform public._update_so_status(v_link); end if;
  end if;

  execute format('update public.%I set docstatus = 2, status = ''Dibatalkan'' where id = $1', p_doctype) using p_id;
  perform set_config('app.bypass', 'off', true);
  return v_name;
end $$;

-- Salin dokumen batal/selesai menjadi Draft baru (Amend / Duplikat)
create or replace function public.duplicate_doc(p_doctype text, p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_child text := public._child_of(p_doctype); v_new uuid := gen_random_uuid(); v_cols text; v_ccols text;
begin
  if v_child is null then raise exception 'Doctype tidak dikenal'; end if;
  perform public.require_perm(p_doctype, 'write');
  select string_agg(quote_ident(column_name), ', ') into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_doctype and is_generated = 'NEVER'
     and column_name not in ('id','name','docstatus','status','created_at','created_by','updated_at','updated_by',
                             'per_received','per_delivered','outstanding_amount');
  execute format('insert into public.%I (id, %s) select $2, %s from public.%I where id = $1',
                 p_doctype, v_cols, v_cols, p_doctype) using p_id, v_new;
  select string_agg(quote_ident(column_name), ', ') into v_ccols
    from information_schema.columns
   where table_schema = 'public' and table_name = v_child and is_generated = 'NEVER'
     and column_name not in ('id','parent_id','received_qty','delivered_qty','batch_allocation');
  execute format('insert into public.%I (parent_id, %s) select $2, %s from public.%I where parent_id = $1',
                 v_child, v_ccols, v_ccols, v_child) using p_id, v_new;
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- "BUAT →" : mapping dokumen hulu ke hilir (seperti tombol Create di ERPNext)
-- ---------------------------------------------------------------------
create or replace function public.make_purchase_receipt(p_po uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; v_id uuid;
begin
  perform public.require_perm('purchase_receipts', 'write');
  select * into po from public.purchase_orders where id = p_po;
  if po.docstatus is distinct from 1 then raise exception 'Purchase Order harus sudah disubmit'; end if;
  if po.per_received >= 100 then raise exception 'Purchase Order sudah diterima penuh'; end if;
  insert into public.purchase_receipts (supplier_id, purchase_order_id, set_warehouse_id, ppn_percent, company_id)
  values (po.supplier_id, po.id, po.set_warehouse_id, po.ppn_percent, po.company_id) returning id into v_id;
  insert into public.purchase_receipt_items (parent_id, idx, item_id, qty, rate, warehouse_id, po_item_id)
  select v_id, row_number() over (order by idx), item_id, qty - received_qty, rate,
         coalesce(warehouse_id, po.set_warehouse_id), id
    from public.purchase_order_items where parent_id = p_po and qty > received_qty;
  return v_id;
end $$;

create or replace function public.make_purchase_invoice(p_pr uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.purchase_receipts; v_id uuid;
begin
  perform public.require_perm('purchase_invoices', 'write');
  select * into pr from public.purchase_receipts where id = p_pr;
  if pr.docstatus is distinct from 1 then raise exception 'Purchase Receipt harus sudah disubmit'; end if;
  insert into public.purchase_invoices (supplier_id, purchase_receipt_id, ppn_percent, company_id)
  values (pr.supplier_id, pr.id, pr.ppn_percent, pr.company_id) returning id into v_id;
  insert into public.purchase_invoice_items (parent_id, idx, item_id, qty, rate)
  select v_id, idx, item_id, qty, rate from public.purchase_receipt_items where parent_id = p_pr;
  return v_id;
end $$;

create or replace function public.make_delivery_note(p_so uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare so public.sales_orders; v_id uuid;
begin
  perform public.require_perm('delivery_notes', 'write');
  select * into so from public.sales_orders where id = p_so;
  if so.docstatus is distinct from 1 then raise exception 'Sales Order harus sudah disubmit'; end if;
  if so.per_delivered >= 100 then raise exception 'Sales Order sudah terkirim penuh'; end if;
  insert into public.delivery_notes (customer_id, sales_order_id, set_warehouse_id, ppn_percent, company_id)
  values (so.customer_id, so.id, so.set_warehouse_id, so.ppn_percent, so.company_id) returning id into v_id;
  insert into public.delivery_note_items (parent_id, idx, item_id, qty, rate, warehouse_id, so_item_id)
  select v_id, row_number() over (order by idx), item_id, qty - delivered_qty, rate,
         coalesce(warehouse_id, so.set_warehouse_id), id
    from public.sales_order_items where parent_id = p_so and qty > delivered_qty;
  return v_id;
end $$;

create or replace function public.make_sales_invoice(p_dn uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare dn public.delivery_notes; v_id uuid;
begin
  perform public.require_perm('sales_invoices', 'write');
  select * into dn from public.delivery_notes where id = p_dn;
  if dn.docstatus is distinct from 1 then raise exception 'Delivery Note harus sudah disubmit'; end if;
  insert into public.sales_invoices (customer_id, delivery_note_id, ppn_percent, company_id)
  values (dn.customer_id, dn.id, dn.ppn_percent, dn.company_id) returning id into v_id;
  insert into public.sales_invoice_items (parent_id, idx, item_id, qty, rate)
  select v_id, idx, item_id, qty, rate from public.delivery_note_items where parent_id = p_dn;
  return v_id;
end $$;

-- Fungsi internal tidak boleh dipanggil langsung dari API
do $$
declare f text;
begin
  foreach f in array array[
    '_post_sle(uuid,uuid,uuid,numeric,numeric,date,text,uuid,text,boolean)',
    '_ensure_batch(uuid,text,date,date,text)',
    '_issue_stock(uuid,uuid,numeric,text,date,text,uuid,text,boolean)',
    '_reverse_sle(text,uuid)',
    '_submit_stock_entry(uuid)', '_submit_purchase_receipt(uuid)', '_submit_delivery_note(uuid)',
    '_check_approved_vendor(uuid,text,uuid)', '_check_credit_limit(uuid)',
    '_update_po_status(uuid)', '_update_so_status(uuid)',
    '_setup_master(text)', '_setup_doc(text,text)', '_setup_child(text,text)', '_rls(text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================= supabase/migrations/0005_reports_roles.sql =================
-- =====================================================================
-- 0005 LAPORAN, DASHBOARD, ROLE BAWAAN
-- Semua view memakai security_invoker -> tetap tunduk pada RLS.
-- =====================================================================

create view public.v_stock_balance with (security_invoker = true) as
select b.item_id, i.code item_code, i.name item_name, i.item_type, i.stock_uom,
       b.warehouse_id, w.code warehouse_code, w.name warehouse_name,
       b.actual_qty, b.valuation_rate, b.stock_value, i.min_qty
  from public.bins b
  join public.items i on i.id = b.item_id
  join public.warehouses w on w.id = b.warehouse_id;

create view public.v_batch_stock with (security_invoker = true) as
select sl.item_id, i.code item_code, i.name item_name, i.stock_uom,
       sl.warehouse_id, w.code warehouse_code,
       sl.batch_id, bt.batch_no, bt.mfg_date, bt.expiry_date,
       (bt.expiry_date - current_date) days_to_expiry,
       sum(sl.qty) qty
  from public.stock_ledger sl
  join public.items i on i.id = sl.item_id
  join public.warehouses w on w.id = sl.warehouse_id
  join public.batches bt on bt.id = sl.batch_id
 group by sl.item_id, i.code, i.name, i.stock_uom, sl.warehouse_id, w.code,
          sl.batch_id, bt.batch_no, bt.mfg_date, bt.expiry_date
having sum(sl.qty) <> 0;

create view public.v_stock_ledger with (security_invoker = true) as
select sl.id, sl.posting_date, sl.created_at, sl.item_id, i.code item_code, i.name item_name,
       sl.warehouse_id, w.code warehouse_code, bt.batch_no,
       sl.qty, sl.qty_after, sl.valuation_rate, sl.stock_value_difference,
       sl.voucher_type, sl.voucher_id, sl.voucher_no, sl.is_cancelled
  from public.stock_ledger sl
  join public.items i on i.id = sl.item_id
  join public.warehouses w on w.id = sl.warehouse_id
  left join public.batches bt on bt.id = sl.batch_id;

-- Item di bawah titik reorder (total semua gudang)
create view public.v_reorder with (security_invoker = true) as
select i.id item_id, i.code item_code, i.name item_name, i.stock_uom, i.min_qty,
       coalesce(sum(b.actual_qty), 0) actual_qty
  from public.items i
  left join public.bins b on b.item_id = i.id
 where i.is_stock_item and not i.disabled and i.min_qty > 0
 group by i.id
having coalesce(sum(b.actual_qty), 0) < i.min_qty;

-- Ringkasan dashboard
create or replace function public.dashboard_summary()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'stock_value',      (select coalesce(sum(stock_value),0) from public.bins),
    'item_count',       (select count(*) from public.items where not disabled),
    'reorder_count',    (select count(*) from public.v_reorder),
    'expiring_90',      (select count(*) from public.v_batch_stock where qty > 0 and days_to_expiry between 0 and 90),
    'expired',          (select count(*) from public.v_batch_stock where qty > 0 and days_to_expiry < 0),
    'po_open',          (select count(*) from public.purchase_orders where docstatus = 1 and per_received < 100),
    'so_open',          (select count(*) from public.sales_orders where docstatus = 1 and per_delivered < 100),
    'sales_month',      (select coalesce(sum(grand_total),0) from public.sales_invoices
                          where docstatus = 1 and date_trunc('month', posting_date) = date_trunc('month', current_date)),
    'purchase_month',   (select coalesce(sum(grand_total),0) from public.purchase_invoices
                          where docstatus = 1 and date_trunc('month', posting_date) = date_trunc('month', current_date)),
    'receivable',       (select coalesce(sum(outstanding_amount),0) from public.sales_invoices where docstatus = 1),
    'payable',          (select coalesce(sum(outstanding_amount),0) from public.purchase_invoices where docstatus = 1),
    'sales_by_month',   (select coalesce(jsonb_agg(x order by m), '[]'::jsonb) from (
                           select to_char(date_trunc('month', posting_date), 'YYYY-MM') m,
                                  jsonb_build_object('month', to_char(date_trunc('month', posting_date), 'YYYY-MM'),
                                                     'total', sum(grand_total)) x
                             from public.sales_invoices
                            where docstatus = 1 and posting_date >= date_trunc('month', current_date) - interval '5 months'
                            group by 1, date_trunc('month', posting_date)) t)
  )
$$;

-- ---------------------------------------------------------------------
-- ROLE BAWAAN
-- ---------------------------------------------------------------------
insert into public.roles (id, name, description) values
  ('admin',     'Administrator',   'Akses penuh termasuk pengguna & audit log'),
  ('pembelian', 'Staf Pembelian',  'Supplier, Purchase Order, Purchase Invoice'),
  ('penjualan', 'Staf Penjualan',  'Customer, Sales Order, Sales Invoice'),
  ('gudang',    'Staf Gudang',     'Penerimaan barang, pengiriman, stock entry'),
  ('manajer',   'Manajer',         'Lihat semua, submit & cancel dokumen'),
  ('viewer',    'Hanya Lihat',     'Hanya bisa melihat data (default user baru)');

insert into public.permissions (role_id, doctype, can_read, can_write, can_submit, can_cancel) values
  ('admin', '*', true, true, true, true),
  ('manajer', '*', true, false, true, true),
  ('viewer', 'uoms', true,false,false,false), ('viewer', 'item_groups', true,false,false,false),
  ('viewer', 'items', true,false,false,false), ('viewer', 'warehouses', true,false,false,false),
  ('viewer', 'suppliers', true,false,false,false), ('viewer', 'customers', true,false,false,false),
  ('viewer', 'stock_ledger', true,false,false,false),
  -- pembelian
  ('pembelian', 'suppliers', true,true,false,false), ('pembelian', 'items', true,true,false,false),
  ('pembelian', 'uoms', true,false,false,false), ('pembelian', 'item_groups', true,false,false,false),
  ('pembelian', 'warehouses', true,false,false,false), ('pembelian', 'stock_ledger', true,false,false,false),
  ('pembelian', 'purchase_orders', true,true,true,true), ('pembelian', 'purchase_receipts', true,false,false,false),
  ('pembelian', 'purchase_invoices', true,true,true,false),
  -- penjualan
  ('penjualan', 'customers', true,true,false,false), ('penjualan', 'items', true,false,false,false),
  ('penjualan', 'uoms', true,false,false,false), ('penjualan', 'item_groups', true,false,false,false),
  ('penjualan', 'warehouses', true,false,false,false), ('penjualan', 'stock_ledger', true,false,false,false),
  ('penjualan', 'sales_orders', true,true,true,true), ('penjualan', 'delivery_notes', true,false,false,false),
  ('penjualan', 'sales_invoices', true,true,true,false),
  -- gudang
  ('gudang', 'items', true,false,false,false), ('gudang', 'uoms', true,false,false,false),
  ('gudang', 'item_groups', true,false,false,false), ('gudang', 'warehouses', true,true,false,false),
  ('gudang', 'suppliers', true,false,false,false), ('gudang', 'customers', true,false,false,false),
  ('gudang', 'stock_ledger', true,false,false,false),
  ('gudang', 'stock_entries', true,true,true,false),
  ('gudang', 'purchase_orders', true,false,false,false), ('gudang', 'purchase_receipts', true,true,true,false),
  ('gudang', 'sales_orders', true,false,false,false), ('gudang', 'delivery_notes', true,true,true,false);

-- ================= supabase/migrations/0006_accounting.sql =================
-- =====================================================================
-- 0006 AKUNTANSI
--   accounts          : Bagan Akun (COA) bertingkat
--   gl_entries        : buku besar (append-only), diisi otomatis saat submit
--   payment_entries   : penerimaan piutang / pembayaran hutang / transfer kas-bank
--   journal_entries   : jurnal umum, kas/bank, penyesuaian, saldo awal
-- Persediaan perpetual ala ERPNext:
--   Purchase Receipt : Dr Persediaan            / Cr Barang Diterima Belum Ditagih
--   Purchase Invoice : Dr BDBT + PPN Masukan    / Cr Hutang Usaha
--   Delivery Note    : Dr HPP                   / Cr Persediaan
--   Sales Invoice    : Dr Piutang Usaha         / Cr Penjualan + PPN Keluaran
--   Stock Entry      : Persediaan vs Penyesuaian Persediaan (atau Ekuitas Saldo Awal)
-- =====================================================================

-- --------------------------- BAGAN AKUN ------------------------------
create table public.accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  parent_id    uuid references public.accounts(id),
  root_type    text not null check (root_type in ('Aset','Kewajiban','Ekuitas','Pendapatan','Beban')),
  account_type text check (account_type in (
                 'Kas','Bank','Piutang','Persediaan','PPN Masukan','Aset Tetap','Akumulasi Penyusutan',
                 'Hutang','Barang Diterima Belum Ditagih','PPN Keluaran','Pajak',
                 'Ekuitas','Ekuitas Saldo Awal','Pendapatan','HPP','Penyesuaian Persediaan','Beban')),
  is_group     boolean not null default false,
  is_default   boolean not null default false,   -- akun default untuk tipe-nya
  disabled     boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
select public._setup_master('accounts');

-- Akun default per tipe: yang ditandai is_default, kalau tidak ada -> kode terkecil
create or replace function public._acc(p_type text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.accounts
   where account_type = p_type and not is_group and not disabled
   order by is_default desc, code limit 1;
  if v is null then
    raise exception 'Akun default bertipe "%" belum ada di Bagan Akun', p_type;
  end if;
  return v;
end $$;

-- COA standar (bisa diubah/ditambah dari menu Bagan Akun)
insert into public.accounts (code, name, root_type, account_type, is_group) values
  ('1',    'ASET',                               'Aset',       null, true),
  ('11',   'Aset Lancar',                        'Aset',       null, true),
  ('1101', 'Kas',                                'Aset',       'Kas', false),
  ('1102', 'Kas Kecil',                          'Aset',       'Kas', false),
  ('1111', 'Bank BCA',                           'Aset',       'Bank', false),
  ('1112', 'Bank Mandiri',                       'Aset',       'Bank', false),
  ('1201', 'Piutang Usaha',                      'Aset',       'Piutang', false),
  ('1301', 'Persediaan',                         'Aset',       'Persediaan', false),
  ('1401', 'PPN Masukan',                        'Aset',       'PPN Masukan', false),
  ('1402', 'Uang Muka Pembelian',                'Aset',       null, false),
  ('1403', 'PPh 23 Dibayar Dimuka',              'Aset',       'Pajak', false),
  ('15',   'Aset Tetap',                         'Aset',       null, true),
  ('1501', 'Tanah & Bangunan',                   'Aset',       'Aset Tetap', false),
  ('1502', 'Mesin & Peralatan Produksi',         'Aset',       'Aset Tetap', false),
  ('1503', 'Kendaraan',                          'Aset',       'Aset Tetap', false),
  ('1509', 'Akumulasi Penyusutan',               'Aset',       'Akumulasi Penyusutan', false),
  ('2',    'KEWAJIBAN',                          'Kewajiban',  null, true),
  ('21',   'Kewajiban Lancar',                   'Kewajiban',  null, true),
  ('2101', 'Hutang Usaha',                       'Kewajiban',  'Hutang', false),
  ('2102', 'Barang Diterima Belum Ditagih',      'Kewajiban',  'Barang Diterima Belum Ditagih', false),
  ('2103', 'PPN Keluaran',                       'Kewajiban',  'PPN Keluaran', false),
  ('2104', 'Hutang PPh 21',                      'Kewajiban',  'Pajak', false),
  ('2105', 'Hutang PPh 23',                      'Kewajiban',  'Pajak', false),
  ('2106', 'Uang Muka Penjualan',                'Kewajiban',  null, false),
  ('2107', 'Hutang Gaji',                        'Kewajiban',  null, false),
  ('22',   'Kewajiban Jangka Panjang',           'Kewajiban',  null, true),
  ('2201', 'Hutang Bank',                        'Kewajiban',  null, false),
  ('3',    'EKUITAS',                            'Ekuitas',    null, true),
  ('3101', 'Modal Disetor',                      'Ekuitas',    'Ekuitas', false),
  ('3201', 'Laba Ditahan',                       'Ekuitas',    'Ekuitas', false),
  ('3301', 'Prive',                              'Ekuitas',    'Ekuitas', false),
  ('3901', 'Ekuitas Saldo Awal',                 'Ekuitas',    'Ekuitas Saldo Awal', false),
  ('4',    'PENDAPATAN',                         'Pendapatan', null, true),
  ('4101', 'Penjualan',                          'Pendapatan', 'Pendapatan', false),
  ('4102', 'Retur & Potongan Penjualan',         'Pendapatan', null, false),
  ('4201', 'Pendapatan Lain-lain',               'Pendapatan', null, false),
  ('4202', 'Pendapatan Bunga Bank',              'Pendapatan', null, false),
  ('5',    'HARGA POKOK PENJUALAN',              'Beban',      null, true),
  ('5101', 'Harga Pokok Penjualan',              'Beban',      'HPP', false),
  ('5201', 'Selisih / Penyesuaian Persediaan',   'Beban',      'Penyesuaian Persediaan', false),
  ('5202', 'Beban Pemusnahan Barang',            'Beban',      null, false),
  ('6',    'BEBAN OPERASIONAL',                  'Beban',      null, true),
  ('6101', 'Beban Gaji & Tunjangan',             'Beban',      null, false),
  ('6102', 'Beban Listrik, Air & Telepon',       'Beban',      null, false),
  ('6103', 'Beban Pengiriman & Transportasi',    'Beban',      null, false),
  ('6104', 'Beban Sewa',                         'Beban',      null, false),
  ('6105', 'Beban Perizinan & Registrasi',       'Beban',      null, false),
  ('6106', 'Beban Pemeliharaan',                 'Beban',      null, false),
  ('6107', 'Beban Penyusutan',                   'Beban',      null, false),
  ('6108', 'Beban Administrasi Bank',            'Beban',      null, false),
  ('6199', 'Beban Lain-lain',                    'Beban',      'Beban', false);
update public.accounts a set parent_id = p.id
  from public.accounts p
 where p.code = case when a.code ~ '^1[1-4]\d\d$' then '11'
                     when a.code ~ '^15\d\d$'     then '15'
                     when a.code ~ '^21\d\d$'     then '21'
                     when a.code ~ '^22\d\d$'     then '22'
                     when length(a.code) = 4      then left(a.code, 1)
                     when length(a.code) = 2      then left(a.code, 1) end;

-- --------------------- PENGATURAN & KOLOM TAMBAHAN ----------------------
alter table public.companies
  add column books_start_date date,   -- tanggal mulai pembukuan (transaksi sebelum ini ditolak, kecuali saldo awal)
  add column frozen_until     date;   -- kunci periode: tidak boleh posting s/d tanggal ini

alter table public.items
  add column income_account_id  uuid references public.accounts(id),   -- default: akun Pendapatan
  add column expense_account_id uuid references public.accounts(id);   -- untuk item non-stok di Purchase Invoice

alter table public.sales_invoices    add column is_opening boolean not null default false;
alter table public.purchase_invoices add column is_opening boolean not null default false;
alter table public.stock_entries
  add column is_opening boolean not null default false,
  add column difference_account_id uuid references public.accounts(id);

-- ----------------------------- BUKU BESAR ------------------------------
create table public.gl_entries (
  id                   bigserial primary key,
  posting_date         date not null,
  created_at           timestamptz not null default now(),
  account_id           uuid not null references public.accounts(id),
  debit                numeric(18,2) not null default 0,
  credit               numeric(18,2) not null default 0,
  party_type           text check (party_type in ('Customer','Supplier')),
  party_id             uuid,
  against_voucher_type text,
  against_voucher_id   uuid,
  voucher_type         text not null,
  voucher_id           uuid not null,
  voucher_no           text not null,
  remarks              text,
  is_cancelled         boolean not null default false,
  created_by           uuid default auth.uid()
);
create index on public.gl_entries (account_id, posting_date);
create index on public.gl_entries (voucher_type, voucher_id);
create index on public.gl_entries (party_type, party_id);
alter table public.gl_entries enable row level security;
create policy gl_read on public.gl_entries for select to authenticated using (public.has_perm('gl_entries','read'));
revoke insert, update, delete, truncate on public.gl_entries from anon, authenticated;

create or replace function public._gl(
  p_acc uuid, p_dr numeric, p_cr numeric, p_date date, p_vtype text, p_vid uuid, p_vno text,
  p_party_type text default null, p_party uuid default null,
  p_against_type text default null, p_against uuid default null, p_remarks text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.accounts;
begin
  p_dr := round(coalesce(p_dr, 0), 2); p_cr := round(coalesce(p_cr, 0), 2);
  if p_dr = 0 and p_cr = 0 then return; end if;
  if p_dr < 0 or p_cr < 0 then  -- nilai negatif dibalik sisinya
    select greatest(p_dr,0) + greatest(-p_cr,0), greatest(p_cr,0) + greatest(-p_dr,0) into p_dr, p_cr;
  end if;
  select * into a from public.accounts where id = p_acc;
  if a.is_group then raise exception 'Akun % adalah akun grup, tidak bisa dipakai untuk posting', a.code; end if;
  if a.disabled then raise exception 'Akun % nonaktif', a.code; end if;
  if a.account_type in ('Piutang','Hutang') and p_party is null then
    raise exception 'Akun % (%) wajib diisi Customer/Supplier', a.code, a.name;
  end if;
  insert into public.gl_entries (posting_date, account_id, debit, credit, party_type, party_id,
                                 against_voucher_type, against_voucher_id, voucher_type, voucher_id, voucher_no, remarks)
  values (p_date, p_acc, p_dr, p_cr, p_party_type, p_party, p_against_type, p_against, p_vtype, p_vid, p_vno, p_remarks);
end $$;

create or replace function public._reverse_gl(p_vtype text, p_vid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.gl_entries (posting_date, account_id, debit, credit, party_type, party_id,
                                 against_voucher_type, against_voucher_id, voucher_type, voucher_id, voucher_no, remarks, is_cancelled)
  select posting_date, account_id, credit, debit, party_type, party_id,
         against_voucher_type, against_voucher_id, voucher_type, voucher_id, voucher_no, 'Pembatalan', true
    from public.gl_entries where voucher_type = p_vtype and voucher_id = p_vid and not is_cancelled;
  update public.gl_entries set is_cancelled = true where voucher_type = p_vtype and voucher_id = p_vid;
end $$;

-- ---------------------------- PAYMENT ENTRY ----------------------------
create table public.payment_entries (
  id                   uuid primary key default gen_random_uuid(),
  name                 text unique,
  payment_type         text not null default 'Terima' check (payment_type in ('Terima','Bayar','Transfer Internal')),
  posting_date         date not null default current_date,
  customer_id          uuid references public.customers(id),
  supplier_id          uuid references public.suppliers(id),
  paid_from_account_id uuid references public.accounts(id),
  paid_to_account_id   uuid references public.accounts(id),
  paid_amount          numeric(18,2) not null default 0 check (paid_amount >= 0),
  total_allocated      numeric(18,2) not null default 0,
  unallocated_amount   numeric(18,2) not null default 0,
  reference_no         text,          -- no. bukti transfer / giro
  reference_date       date,
  company_id           uuid not null default public.default_company() references public.companies(id),
  remarks              text,
  docstatus            smallint not null default 0,
  status               text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.payment_entry_references (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid not null references public.payment_entries(id) on delete cascade,
  idx                 integer not null default 1,
  sales_invoice_id    uuid references public.sales_invoices(id),
  purchase_invoice_id uuid references public.purchase_invoices(id),
  outstanding_amount  numeric(18,2) not null default 0,   -- snapshot, diisi otomatis
  allocated_amount    numeric(18,2) not null default 0 check (allocated_amount >= 0),
  constraint one_invoice check ((sales_invoice_id is null) <> (purchase_invoice_id is null))
);
select public._setup_doc('payment_entries', 'PAY');
select public._setup_child('payment_entry_references', 'payment_entries');

-- Akun default & sisa belum dialokasikan
create or replace function public.calc_payment_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.docstatus = 0 then
    if tg_op = 'UPDATE' and new.payment_type <> old.payment_type then
      new.paid_from_account_id := null; new.paid_to_account_id := null;   -- isi ulang default
    end if;
    if new.payment_type = 'Terima' then
      new.supplier_id := null;
      new.paid_from_account_id := coalesce(new.paid_from_account_id, public._acc('Piutang'));
      new.paid_to_account_id   := coalesce(new.paid_to_account_id,   public._acc('Kas'));
    elsif new.payment_type = 'Bayar' then
      new.customer_id := null;
      new.paid_from_account_id := coalesce(new.paid_from_account_id, public._acc('Kas'));
      new.paid_to_account_id   := coalesce(new.paid_to_account_id,   public._acc('Hutang'));
    else
      new.customer_id := null; new.supplier_id := null;
    end if;
    new.unallocated_amount := new.paid_amount - new.total_allocated;
  end if;
  return new;
end $$;
create trigger payment_entries_calc before insert or update on public.payment_entries
  for each row execute function public.calc_payment_entry();

create or replace function public.fill_ref_outstanding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sales_invoice_id is not null then
    select outstanding_amount into new.outstanding_amount from public.sales_invoices where id = new.sales_invoice_id;
  else
    select outstanding_amount into new.outstanding_amount from public.purchase_invoices where id = new.purchase_invoice_id;
  end if;
  new.outstanding_amount := coalesce(new.outstanding_amount, 0);
  return new;
end $$;
create trigger payment_refs_outstanding before insert or update of sales_invoice_id, purchase_invoice_id
  on public.payment_entry_references for each row execute function public.fill_ref_outstanding();

create or replace function public.rollup_payment()
returns trigger language plpgsql as $$
declare v_parent uuid := coalesce(new.parent_id, old.parent_id);
begin
  update public.payment_entries set total_allocated =
    (select coalesce(sum(allocated_amount), 0) from public.payment_entry_references where parent_id = v_parent)
   where id = v_parent and docstatus = 0;
  return null;
end $$;
create trigger payment_refs_rollup after insert or update or delete on public.payment_entry_references
  for each row execute function public.rollup_payment();

-- ---------------------------- JOURNAL ENTRY ----------------------------
create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  name         text unique,
  voucher_type text not null default 'Jurnal Umum'
               check (voucher_type in ('Jurnal Umum','Kas Masuk','Kas Keluar','Bank Masuk','Bank Keluar','Penyesuaian','Saldo Awal')),
  posting_date date not null default current_date,
  cheque_no    text,
  remarks      text,
  total_debit  numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0,
  company_id   uuid not null default public.default_company() references public.companies(id),
  docstatus    smallint not null default 0,
  status       text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.journal_entry_accounts (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references public.journal_entries(id) on delete cascade,
  idx         integer not null default 1,
  account_id  uuid not null references public.accounts(id),
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  debit       numeric(18,2) not null default 0 check (debit >= 0),
  credit      numeric(18,2) not null default 0 check (credit >= 0),
  user_remark text,
  constraint one_side check (not (debit > 0 and credit > 0)),
  constraint one_party check (customer_id is null or supplier_id is null)
);
select public._setup_doc('journal_entries', 'JV');
select public._setup_child('journal_entry_accounts', 'journal_entries');

create or replace function public.rollup_journal()
returns trigger language plpgsql as $$
declare v_parent uuid := coalesce(new.parent_id, old.parent_id);
begin
  update public.journal_entries j set
    total_debit  = (select coalesce(sum(debit), 0)  from public.journal_entry_accounts where parent_id = v_parent),
    total_credit = (select coalesce(sum(credit), 0) from public.journal_entry_accounts where parent_id = v_parent)
   where j.id = v_parent and j.docstatus = 0;
  return null;
end $$;
create trigger journal_accounts_rollup after insert or update or delete on public.journal_entry_accounts
  for each row execute function public.rollup_journal();

-- ----------------------- STATUS INVOICE -------------------------------
create or replace function public._update_invoice_status(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  execute format($f$
    update public.%I set status = case
        when outstanding_amount <= 0 then 'Lunas'
        when outstanding_amount < grand_total then 'Dibayar Sebagian'
        else 'Belum Dibayar' end
     where id = $1 and docstatus = 1$f$, p_table) using p_id;
end $$;

-- ----------------------- VALIDASI TANGGAL -----------------------------
create or replace function public._check_posting_date(p_date date, p_opening boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare c public.companies;
begin
  select * into c from public.companies where id = public.default_company();
  if c.frozen_until is not null and p_date <= c.frozen_until then
    raise exception 'Periode sampai % sudah dikunci. Tanggal dokumen: %', c.frozen_until, p_date;
  end if;
  if not p_opening and c.books_start_date is not null and p_date < c.books_start_date then
    raise exception 'Tanggal % sebelum tanggal mulai pembukuan (%). Untuk saldo lama gunakan dokumen Saldo Awal.',
      p_date, c.books_start_date;
  end if;
end $$;

-- ----------------------- POSTING JURNAL OTOMATIS ----------------------
create or replace function public._post_gl(p_doctype text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  v_date date; v_no text; v numeric; r record;
  v_dr numeric; v_cr numeric;
begin
  execute format('select to_jsonb(t) from public.%I t where id = $1', p_doctype) into d using p_id;
  v_date := coalesce((d->>'posting_date')::date, (d->>'transaction_date')::date);
  v_no := d->>'name';

  if p_doctype = 'purchase_receipts' then
    select coalesce(sum(stock_value_difference), 0) into v from public.stock_ledger
     where voucher_type = p_doctype and voucher_id = p_id;
    perform public._gl(public._acc('Persediaan'), v, 0, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('Barang Diterima Belum Ditagih'), 0, v, v_date, p_doctype, p_id, v_no);

  elsif p_doctype = 'delivery_notes' then
    select -coalesce(sum(stock_value_difference), 0) into v from public.stock_ledger
     where voucher_type = p_doctype and voucher_id = p_id;
    perform public._gl(public._acc('HPP'), v, 0, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('Persediaan'), 0, v, v_date, p_doctype, p_id, v_no);

  elsif p_doctype = 'stock_entries' then
    select coalesce(sum(stock_value_difference), 0) into v from public.stock_ledger
     where voucher_type = p_doctype and voucher_id = p_id;   -- transfer = 0
    if v <> 0 then
      perform public._gl(public._acc('Persediaan'), v, 0, v_date, p_doctype, p_id, v_no);
      perform public._gl(coalesce((d->>'difference_account_id')::uuid,
                                  case when (d->>'is_opening')::boolean then public._acc('Ekuitas Saldo Awal')
                                       else public._acc('Penyesuaian Persediaan') end),
                         0, v, v_date, p_doctype, p_id, v_no);
    end if;

  elsif p_doctype = 'sales_invoices' then
    perform public._gl(public._acc('Piutang'), (d->>'grand_total')::numeric, 0, v_date, p_doctype, p_id, v_no,
                       'Customer', (d->>'customer_id')::uuid, p_doctype, p_id);
    if (d->>'is_opening')::boolean then
      perform public._gl(public._acc('Ekuitas Saldo Awal'), 0, (d->>'grand_total')::numeric, v_date, p_doctype, p_id, v_no);
    else
      for r in select coalesce(i.income_account_id, public._acc('Pendapatan')) acc, sum(c.amount) amt
                 from public.sales_invoice_items c join public.items i on i.id = c.item_id
                where c.parent_id = p_id group by 1 loop
        perform public._gl(r.acc, 0, r.amt, v_date, p_doctype, p_id, v_no);
      end loop;
      perform public._gl(public._acc('PPN Keluaran'), 0, (d->>'tax_amount')::numeric, v_date, p_doctype, p_id, v_no);
    end if;

  elsif p_doctype = 'purchase_invoices' then
    perform public._gl(public._acc('Hutang'), 0, (d->>'grand_total')::numeric, v_date, p_doctype, p_id, v_no,
                       'Supplier', (d->>'supplier_id')::uuid, p_doctype, p_id);
    if (d->>'is_opening')::boolean then
      perform public._gl(public._acc('Ekuitas Saldo Awal'), (d->>'grand_total')::numeric, 0, v_date, p_doctype, p_id, v_no);
    else
      if d->>'purchase_receipt_id' is null and exists (
           select 1 from public.purchase_invoice_items c join public.items i on i.id = c.item_id
            where c.parent_id = p_id and i.is_stock_item) then
        raise exception 'Invoice berisi item stok: buat dari Purchase Receipt (tombol "Buat Purchase Invoice" di Purchase Receipt)';
      end if;
      for r in select case when i.is_stock_item then public._acc('Barang Diterima Belum Ditagih')
                           else coalesce(i.expense_account_id, public._acc('Beban')) end acc,
                      sum(c.amount) amt
                 from public.purchase_invoice_items c join public.items i on i.id = c.item_id
                where c.parent_id = p_id group by 1 loop
        perform public._gl(r.acc, r.amt, 0, v_date, p_doctype, p_id, v_no);
      end loop;
      perform public._gl(public._acc('PPN Masukan'), (d->>'tax_amount')::numeric, 0, v_date, p_doctype, p_id, v_no);
    end if;

  elsif p_doctype = 'payment_entries' then
    if d->>'payment_type' = 'Terima' then
      perform public._gl((d->>'paid_to_account_id')::uuid, (d->>'paid_amount')::numeric, 0, v_date, p_doctype, p_id, v_no,
                         null, null, null, null, d->>'reference_no');
      for r in select sales_invoice_id inv, allocated_amount amt from public.payment_entry_references
                where parent_id = p_id and allocated_amount > 0 loop
        perform public._gl((d->>'paid_from_account_id')::uuid, 0, r.amt, v_date, p_doctype, p_id, v_no,
                           'Customer', (d->>'customer_id')::uuid, 'sales_invoices', r.inv);
      end loop;
      perform public._gl((d->>'paid_from_account_id')::uuid, 0, (d->>'unallocated_amount')::numeric, v_date, p_doctype, p_id, v_no,
                         'Customer', (d->>'customer_id')::uuid, null, null, 'Uang muka / belum dialokasikan');
    elsif d->>'payment_type' = 'Bayar' then
      perform public._gl((d->>'paid_from_account_id')::uuid, 0, (d->>'paid_amount')::numeric, v_date, p_doctype, p_id, v_no,
                         null, null, null, null, d->>'reference_no');
      for r in select purchase_invoice_id inv, allocated_amount amt from public.payment_entry_references
                where parent_id = p_id and allocated_amount > 0 loop
        perform public._gl((d->>'paid_to_account_id')::uuid, r.amt, 0, v_date, p_doctype, p_id, v_no,
                           'Supplier', (d->>'supplier_id')::uuid, 'purchase_invoices', r.inv);
      end loop;
      perform public._gl((d->>'paid_to_account_id')::uuid, (d->>'unallocated_amount')::numeric, 0, v_date, p_doctype, p_id, v_no,
                         'Supplier', (d->>'supplier_id')::uuid, null, null, 'Uang muka / belum dialokasikan');
    else
      perform public._gl((d->>'paid_to_account_id')::uuid,   (d->>'paid_amount')::numeric, 0, v_date, p_doctype, p_id, v_no);
      perform public._gl((d->>'paid_from_account_id')::uuid, 0, (d->>'paid_amount')::numeric, v_date, p_doctype, p_id, v_no);
    end if;

  elsif p_doctype = 'journal_entries' then
    for r in select * from public.journal_entry_accounts where parent_id = p_id order by idx loop
      perform public._gl(r.account_id, r.debit, r.credit, v_date, p_doctype, p_id, v_no,
                         case when r.customer_id is not null then 'Customer' when r.supplier_id is not null then 'Supplier' end,
                         coalesce(r.customer_id, r.supplier_id), null, null, coalesce(r.user_remark, d->>'remarks'));
    end loop;
  end if;

  -- Wajib seimbang
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_dr, v_cr
    from public.gl_entries where voucher_type = p_doctype and voucher_id = p_id and not is_cancelled;
  if v_dr <> v_cr then
    raise exception 'Jurnal tidak seimbang: debit % vs kredit %', v_dr, v_cr;
  end if;
end $$;

-- ------------------------- VALIDASI PEMBAYARAN -------------------------
create or replace function public._submit_payment_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.payment_entries; r record; v_out numeric; v_party uuid; v_from text; v_to text;
begin
  select * into p from public.payment_entries where id = p_id;
  if p.paid_amount <= 0 then raise exception 'Jumlah pembayaran harus lebih dari 0'; end if;
  if p.paid_from_account_id is null or p.paid_to_account_id is null then raise exception 'Akun asal dan tujuan wajib diisi'; end if;
  select account_type into v_from from public.accounts where id = p.paid_from_account_id;
  select account_type into v_to   from public.accounts where id = p.paid_to_account_id;

  if p.payment_type = 'Terima' then
    if p.customer_id is null then raise exception 'Customer wajib diisi'; end if;
    if v_to not in ('Kas','Bank') then raise exception 'Akun "Diterima ke" harus akun Kas/Bank'; end if;
    if v_from <> 'Piutang' then raise exception 'Akun "Dari" harus akun Piutang'; end if;
  elsif p.payment_type = 'Bayar' then
    if p.supplier_id is null then raise exception 'Supplier wajib diisi'; end if;
    if v_from not in ('Kas','Bank') then raise exception 'Akun "Dibayar dari" harus akun Kas/Bank'; end if;
    if v_to <> 'Hutang' then raise exception 'Akun "Ke" harus akun Hutang'; end if;
  else
    if v_from not in ('Kas','Bank') or v_to not in ('Kas','Bank') then raise exception 'Transfer internal hanya antar akun Kas/Bank'; end if;
    if p.paid_from_account_id = p.paid_to_account_id then raise exception 'Akun asal dan tujuan sama'; end if;
    if exists (select 1 from public.payment_entry_references where parent_id = p_id) then
      raise exception 'Transfer internal tidak boleh berisi referensi invoice';
    end if;
  end if;
  if p.total_allocated > p.paid_amount then
    raise exception 'Total alokasi (%) melebihi jumlah dibayar (%)', p.total_allocated, p.paid_amount;
  end if;

  for r in select * from public.payment_entry_references where parent_id = p_id and allocated_amount > 0 order by idx loop
    if p.payment_type = 'Terima' then
      if r.sales_invoice_id is null then raise exception 'Baris %: penerimaan hanya untuk Sales Invoice', r.idx; end if;
      select outstanding_amount, customer_id into v_out, v_party from public.sales_invoices
       where id = r.sales_invoice_id and docstatus = 1 for update;
      if v_party is distinct from p.customer_id then raise exception 'Baris %: invoice bukan milik customer ini / belum submit', r.idx; end if;
      if r.allocated_amount > v_out then raise exception 'Baris %: alokasi % melebihi sisa tagihan %', r.idx, r.allocated_amount, v_out; end if;
      update public.sales_invoices set outstanding_amount = outstanding_amount - r.allocated_amount where id = r.sales_invoice_id;
      perform public._update_invoice_status('sales_invoices', r.sales_invoice_id);
    else
      if r.purchase_invoice_id is null then raise exception 'Baris %: pembayaran hanya untuk Purchase Invoice', r.idx; end if;
      select outstanding_amount, supplier_id into v_out, v_party from public.purchase_invoices
       where id = r.purchase_invoice_id and docstatus = 1 for update;
      if v_party is distinct from p.supplier_id then raise exception 'Baris %: invoice bukan milik supplier ini / belum submit', r.idx; end if;
      if r.allocated_amount > v_out then raise exception 'Baris %: alokasi % melebihi sisa tagihan %', r.idx, r.allocated_amount, v_out; end if;
      update public.purchase_invoices set outstanding_amount = outstanding_amount - r.allocated_amount where id = r.purchase_invoice_id;
      perform public._update_invoice_status('purchase_invoices', r.purchase_invoice_id);
    end if;
  end loop;
end $$;

create or replace function public._cancel_payment_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from public.payment_entry_references where parent_id = p_id and allocated_amount > 0 loop
    if r.sales_invoice_id is not null then
      update public.sales_invoices set outstanding_amount = outstanding_amount + r.allocated_amount where id = r.sales_invoice_id;
      perform public._update_invoice_status('sales_invoices', r.sales_invoice_id);
    else
      update public.purchase_invoices set outstanding_amount = outstanding_amount + r.allocated_amount where id = r.purchase_invoice_id;
      perform public._update_invoice_status('purchase_invoices', r.purchase_invoice_id);
    end if;
  end loop;
end $$;

create or replace function public._submit_journal_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j public.journal_entries; r record;
begin
  select * into j from public.journal_entries where id = p_id;
  if j.total_debit <> j.total_credit then
    raise exception 'Jurnal tidak seimbang: debit % vs kredit % (selisih %)', j.total_debit, j.total_credit, j.total_debit - j.total_credit;
  end if;
  if j.total_debit = 0 then raise exception 'Jurnal masih kosong'; end if;
  for r in select * from public.journal_entry_accounts where parent_id = p_id loop
    if r.debit = 0 and r.credit = 0 then raise exception 'Baris %: isi debit atau kredit', r.idx; end if;
  end loop;
end $$;

-- ----------------------- SUBMIT / CANCEL (versi lengkap) ---------------
create or replace function public._child_of(p_doctype text) returns text
language sql immutable as $$
  select case p_doctype
    when 'stock_entries'     then 'stock_entry_items'
    when 'purchase_orders'   then 'purchase_order_items'
    when 'purchase_receipts' then 'purchase_receipt_items'
    when 'purchase_invoices' then 'purchase_invoice_items'
    when 'sales_orders'      then 'sales_order_items'
    when 'delivery_notes'    then 'delivery_note_items'
    when 'sales_invoices'    then 'sales_invoice_items'
    when 'payment_entries'   then 'payment_entry_references'
    when 'journal_entries'   then 'journal_entry_accounts'
  end
$$;

create or replace function public.submit_doc(p_doctype text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ds int; v_name text; v_status text; v_child text := public._child_of(p_doctype); v_n int;
        v_link uuid; d jsonb;
begin
  if v_child is null then raise exception 'Doctype % tidak bisa disubmit', p_doctype; end if;
  perform public.require_perm(p_doctype, 'submit');
  execute format('select docstatus, name, to_jsonb(t) from public.%I t where id = $1 for update', p_doctype)
    into v_ds, v_name, d using p_id;
  if v_ds is null then raise exception 'Dokumen tidak ditemukan'; end if;
  if v_ds <> 0 then raise exception 'Dokumen % bukan Draft', v_name; end if;
  if p_doctype <> 'payment_entries' then
    execute format('select count(*) from public.%I where parent_id = $1', v_child) into v_n using p_id;
    if v_n = 0 then raise exception 'Dokumen % belum punya baris', v_name; end if;
  end if;

  perform public._check_posting_date(
    coalesce((d->>'posting_date')::date, (d->>'transaction_date')::date),
    coalesce((d->>'is_opening')::boolean, false) or d->>'voucher_type' = 'Saldo Awal');

  perform set_config('app.bypass', 'on', true);

  v_status := 'Submitted';
  case p_doctype
    when 'stock_entries'     then perform public._submit_stock_entry(p_id);
    when 'purchase_receipts' then perform public._submit_purchase_receipt(p_id);
    when 'delivery_notes'    then perform public._submit_delivery_note(p_id);
    when 'payment_entries'   then perform public._submit_payment_entry(p_id);
    when 'journal_entries'   then perform public._submit_journal_entry(p_id);
    when 'purchase_orders'   then
      perform public._check_approved_vendor((d->>'supplier_id')::uuid, 'purchase_order_items', p_id);
      v_status := 'Menunggu Penerimaan';
    when 'sales_orders'      then
      perform public._check_credit_limit(p_id);
      v_status := 'Menunggu Pengiriman';
    when 'sales_invoices'    then
      v_link := (d->>'delivery_note_id')::uuid;
      if v_link is not null and exists (select 1 from public.sales_invoices
           where delivery_note_id = v_link and docstatus = 1 and id <> p_id) then
        raise exception 'Delivery Note ini sudah ditagih di invoice lain';
      end if;
      v_status := 'Belum Dibayar';
    when 'purchase_invoices' then
      v_link := (d->>'purchase_receipt_id')::uuid;
      if v_link is not null and exists (select 1 from public.purchase_invoices
           where purchase_receipt_id = v_link and docstatus = 1 and id <> p_id) then
        raise exception 'Purchase Receipt ini sudah ditagih di invoice lain';
      end if;
      v_status := 'Belum Dibayar';
    else null;
  end case;

  execute format('update public.%I set docstatus = 1, status = $2 where id = $1', p_doctype) using p_id, v_status;
  if p_doctype = 'purchase_orders' then perform public._update_po_status(p_id); end if;
  if p_doctype = 'sales_orders'    then perform public._update_so_status(p_id); end if;
  if p_doctype not in ('purchase_orders','sales_orders') then perform public._post_gl(p_doctype, p_id); end if;

  perform set_config('app.bypass', 'off', true);
  return v_name;
end $$;

create or replace function public.cancel_doc(p_doctype text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ds int; v_name text; v_dep text; r record; v_link uuid; d jsonb;
begin
  if public._child_of(p_doctype) is null then raise exception 'Doctype % tidak bisa dibatalkan', p_doctype; end if;
  perform public.require_perm(p_doctype, 'cancel');
  execute format('select docstatus, name, to_jsonb(t) from public.%I t where id = $1 for update', p_doctype)
    into v_ds, v_name, d using p_id;
  if v_ds is distinct from 1 then raise exception 'Hanya dokumen yang sudah Submit yang bisa dibatalkan'; end if;
  perform public._check_posting_date(coalesce((d->>'posting_date')::date, (d->>'transaction_date')::date), true);

  v_dep := case p_doctype
    when 'purchase_orders'   then (select string_agg(name, ', ') from public.purchase_receipts where purchase_order_id = p_id and docstatus = 1)
    when 'purchase_receipts' then (select string_agg(name, ', ') from public.purchase_invoices where purchase_receipt_id = p_id and docstatus = 1)
    when 'sales_orders'      then (select string_agg(name, ', ') from public.delivery_notes where sales_order_id = p_id and docstatus = 1)
    when 'delivery_notes'    then (select string_agg(name, ', ') from public.sales_invoices where delivery_note_id = p_id and docstatus = 1)
    when 'sales_invoices'    then (select string_agg(distinct pe.name, ', ') from public.payment_entries pe
                                     join public.payment_entry_references x on x.parent_id = pe.id
                                    where x.sales_invoice_id = p_id and pe.docstatus = 1)
    when 'purchase_invoices' then (select string_agg(distinct pe.name, ', ') from public.payment_entries pe
                                     join public.payment_entry_references x on x.parent_id = pe.id
                                    where x.purchase_invoice_id = p_id and pe.docstatus = 1)
  end;
  if v_dep is not null then
    raise exception 'Tidak bisa membatalkan %: masih dipakai oleh %. Batalkan dokumen tersebut dulu.', v_name, v_dep;
  end if;

  perform set_config('app.bypass', 'on', true);

  if p_doctype in ('stock_entries','purchase_receipts','delivery_notes') then
    perform public._reverse_sle(p_doctype, p_id);
  end if;
  perform public._reverse_gl(p_doctype, p_id);

  if p_doctype = 'purchase_receipts' then
    for r in select po_item_id, qty from public.purchase_receipt_items where parent_id = p_id and po_item_id is not null loop
      update public.purchase_order_items set received_qty = received_qty - r.qty where id = r.po_item_id;
    end loop;
    v_link := (d->>'purchase_order_id')::uuid;
    if v_link is not null then perform public._update_po_status(v_link); end if;
  elsif p_doctype = 'delivery_notes' then
    for r in select so_item_id, qty from public.delivery_note_items where parent_id = p_id and so_item_id is not null loop
      update public.sales_order_items set delivered_qty = delivered_qty - r.qty where id = r.so_item_id;
    end loop;
    v_link := (d->>'sales_order_id')::uuid;
    if v_link is not null then perform public._update_so_status(v_link); end if;
  elsif p_doctype = 'payment_entries' then
    perform public._cancel_payment_entry(p_id);
  end if;

  execute format('update public.%I set docstatus = 2, status = ''Dibatalkan'' where id = $1', p_doctype) using p_id;
  perform set_config('app.bypass', 'off', true);
  return v_name;
end $$;

-- ------------------------- "BUAT PEMBAYARAN" ---------------------------
create or replace function public.make_payment_from_sales_invoice(p_si uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.sales_invoices; v_id uuid;
begin
  perform public.require_perm('payment_entries', 'write');
  select * into s from public.sales_invoices where id = p_si;
  if s.docstatus is distinct from 1 then raise exception 'Invoice harus sudah disubmit'; end if;
  if s.outstanding_amount <= 0 then raise exception 'Invoice sudah lunas'; end if;
  insert into public.payment_entries (payment_type, customer_id, paid_amount, company_id, remarks)
  values ('Terima', s.customer_id, s.outstanding_amount, s.company_id, 'Pelunasan ' || s.name) returning id into v_id;
  insert into public.payment_entry_references (parent_id, idx, sales_invoice_id, allocated_amount)
  values (v_id, 1, p_si, s.outstanding_amount);
  return v_id;
end $$;

create or replace function public.make_payment_from_purchase_invoice(p_pi uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.purchase_invoices; v_id uuid;
begin
  perform public.require_perm('payment_entries', 'write');
  select * into s from public.purchase_invoices where id = p_pi;
  if s.docstatus is distinct from 1 then raise exception 'Invoice harus sudah disubmit'; end if;
  if s.outstanding_amount <= 0 then raise exception 'Invoice sudah lunas'; end if;
  insert into public.payment_entries (payment_type, supplier_id, paid_amount, company_id, remarks)
  values ('Bayar', s.supplier_id, s.outstanding_amount, s.company_id, 'Pembayaran ' || s.name) returning id into v_id;
  insert into public.payment_entry_references (parent_id, idx, purchase_invoice_id, allocated_amount)
  values (v_id, 1, p_pi, s.outstanding_amount);
  return v_id;
end $$;

-- Ambil semua invoice belum lunas milik customer/supplier di Payment Entry (draft).
-- Alokasi berdasarkan jatuh tempo terdekat; jika jumlah dibayar 0 -> diisi total sisa tagihan.
create or replace function public.get_outstanding_invoices(p_pe uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare p public.payment_entries; r record; v_left numeric; v_n int := 0; v_auto boolean;
begin
  perform public.require_perm('payment_entries', 'write');
  select * into p from public.payment_entries where id = p_pe;
  if p.docstatus <> 0 then raise exception 'Hanya untuk dokumen Draft'; end if;
  if p.payment_type = 'Transfer Internal' then raise exception 'Tidak berlaku untuk transfer internal'; end if;
  if coalesce(p.customer_id, p.supplier_id) is null then raise exception 'Isi Customer/Supplier lalu simpan dulu'; end if;
  delete from public.payment_entry_references where parent_id = p_pe;
  v_auto := p.paid_amount = 0;
  v_left := p.paid_amount;
  for r in
    select id, outstanding_amount, due_date, posting_date from public.sales_invoices
     where p.payment_type = 'Terima' and customer_id = p.customer_id and docstatus = 1 and outstanding_amount > 0
    union all
    select id, outstanding_amount, due_date, posting_date from public.purchase_invoices
     where p.payment_type = 'Bayar' and supplier_id = p.supplier_id and docstatus = 1 and outstanding_amount > 0
    order by 3 nulls last, 4
  loop
    exit when not v_auto and v_left <= 0;
    v_n := v_n + 1;
    insert into public.payment_entry_references (parent_id, idx, sales_invoice_id, purchase_invoice_id, allocated_amount)
    values (p_pe, v_n,
            case when p.payment_type = 'Terima' then r.id end,
            case when p.payment_type = 'Bayar'  then r.id end,
            case when v_auto then r.outstanding_amount else least(v_left, r.outstanding_amount) end);
    v_left := v_left - r.outstanding_amount;
  end loop;
  if v_auto then
    update public.payment_entries set paid_amount = total_allocated where id = p_pe;
  end if;
  if v_n = 0 then raise exception 'Tidak ada invoice yang belum lunas'; end if;
  return v_n;
end $$;

-- --------------------------- LAPORAN ----------------------------------
create view public.v_general_ledger with (security_invoker = true) as
select g.id, g.posting_date, g.account_id, a.code account_code, a.name account_name, a.root_type,
       g.debit, g.credit, g.party_type, g.party_id,
       coalesce(c.name, s.name) party_name,
       g.voucher_type, g.voucher_id, g.voucher_no, g.against_voucher_type, g.against_voucher_id,
       g.remarks, g.is_cancelled, g.created_at
  from public.gl_entries g
  join public.accounts a on a.id = g.account_id
  left join public.customers c on g.party_type = 'Customer' and c.id = g.party_id
  left join public.suppliers s on g.party_type = 'Supplier' and s.id = g.party_id;

-- Neraca saldo: saldo awal (sebelum p_from), mutasi periode, saldo akhir. (+ = posisi debit)
create or replace function public.trial_balance(p_from date, p_to date)
returns table (account_id uuid, code text, name text, parent_code text, parent_name text,
               root_type text, account_type text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security invoker set search_path = public as $$
  select a.id, a.code, a.name, p.code, p.name, a.root_type, a.account_type,
         coalesce(sum(g.debit - g.credit) filter (where g.posting_date < p_from), 0),
         coalesce(sum(g.debit)  filter (where g.posting_date between p_from and p_to), 0),
         coalesce(sum(g.credit) filter (where g.posting_date between p_from and p_to), 0),
         coalesce(sum(g.debit - g.credit) filter (where g.posting_date <= p_to), 0)
    from public.accounts a
    left join public.accounts p on p.id = a.parent_id
    left join public.gl_entries g on g.account_id = a.id and not g.is_cancelled
   where not a.is_group
   group by a.id, p.code, p.name
   order by a.code
$$;

create view public.v_receivable_aging with (security_invoker = true) as
select si.id, si.name, si.customer_id party_id, c.code party_code, c.name party_name,
       si.posting_date, si.due_date, si.grand_total, si.outstanding_amount,
       greatest(current_date - si.due_date, 0) days_overdue,
       case when current_date <= si.due_date then 'Belum jatuh tempo'
            when current_date - si.due_date <= 30 then '1-30 hari'
            when current_date - si.due_date <= 60 then '31-60 hari'
            when current_date - si.due_date <= 90 then '61-90 hari'
            else '> 90 hari' end bucket
  from public.sales_invoices si join public.customers c on c.id = si.customer_id
 where si.docstatus = 1 and si.outstanding_amount > 0;

create view public.v_payable_aging with (security_invoker = true) as
select pi.id, pi.name, pi.supplier_id party_id, s.code party_code, s.name party_name,
       pi.posting_date, pi.due_date, pi.grand_total, pi.outstanding_amount,
       greatest(current_date - pi.due_date, 0) days_overdue,
       case when current_date <= pi.due_date then 'Belum jatuh tempo'
            when current_date - pi.due_date <= 30 then '1-30 hari'
            when current_date - pi.due_date <= 60 then '31-60 hari'
            when current_date - pi.due_date <= 90 then '61-90 hari'
            else '> 90 hari' end bucket
  from public.purchase_invoices pi join public.suppliers s on s.id = pi.supplier_id
 where pi.docstatus = 1 and pi.outstanding_amount > 0;

-- Dashboard: tambah saldo kas & bank
create or replace function public.dashboard_summary()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'stock_value',      (select coalesce(sum(stock_value),0) from public.bins),
    'item_count',       (select count(*) from public.items where not disabled),
    'reorder_count',    (select count(*) from public.v_reorder),
    'expiring_90',      (select count(*) from public.v_batch_stock where qty > 0 and days_to_expiry between 0 and 90),
    'expired',          (select count(*) from public.v_batch_stock where qty > 0 and days_to_expiry < 0),
    'po_open',          (select count(*) from public.purchase_orders where docstatus = 1 and per_received < 100),
    'so_open',          (select count(*) from public.sales_orders where docstatus = 1 and per_delivered < 100),
    'sales_month',      (select coalesce(sum(grand_total),0) from public.sales_invoices
                          where docstatus = 1 and not is_opening and date_trunc('month', posting_date) = date_trunc('month', current_date)),
    'purchase_month',   (select coalesce(sum(grand_total),0) from public.purchase_invoices
                          where docstatus = 1 and not is_opening and date_trunc('month', posting_date) = date_trunc('month', current_date)),
    'receivable',       (select coalesce(sum(outstanding_amount),0) from public.sales_invoices where docstatus = 1),
    'payable',          (select coalesce(sum(outstanding_amount),0) from public.purchase_invoices where docstatus = 1),
    'overdue_receivable', (select coalesce(sum(outstanding_amount),0) from public.v_receivable_aging where days_overdue > 0),
    'cash_balance',     (select coalesce(sum(g.debit - g.credit),0) from public.gl_entries g
                           join public.accounts a on a.id = g.account_id
                          where a.account_type in ('Kas','Bank') and not g.is_cancelled),
    'sales_by_month',   (select coalesce(jsonb_agg(x order by m), '[]'::jsonb) from (
                           select to_char(date_trunc('month', posting_date), 'YYYY-MM') m,
                                  jsonb_build_object('month', to_char(date_trunc('month', posting_date), 'YYYY-MM'),
                                                     'total', sum(grand_total)) x
                             from public.sales_invoices
                            where docstatus = 1 and not is_opening
                              and posting_date >= date_trunc('month', current_date) - interval '5 months'
                            group by 1, date_trunc('month', posting_date)) t)
  )
$$;

-- --------------------------- ROLE & IZIN ------------------------------
insert into public.roles (id, name, description) values
  ('keuangan', 'Staf Keuangan / Akuntansi', 'Invoice, pembayaran, jurnal, laporan keuangan');

insert into public.permissions (role_id, doctype, can_read, can_write, can_submit, can_cancel) values
  ('keuangan', 'accounts', true, true, false, false),
  ('keuangan', 'payment_entries', true, true, true, true),
  ('keuangan', 'journal_entries', true, true, true, true),
  ('keuangan', 'gl_entries', true, false, false, false),
  ('keuangan', 'sales_invoices', true, true, true, true),
  ('keuangan', 'purchase_invoices', true, true, true, true),
  ('keuangan', 'customers', true, false, false, false),
  ('keuangan', 'suppliers', true, false, false, false),
  ('keuangan', 'items', true, false, false, false),
  ('keuangan', 'uoms', true, false, false, false),
  ('keuangan', 'item_groups', true, false, false, false),
  ('keuangan', 'warehouses', true, false, false, false),
  ('keuangan', 'stock_ledger', true, false, false, false),
  ('keuangan', 'sales_orders', true, false, false, false),
  ('keuangan', 'delivery_notes', true, false, false, false),
  ('keuangan', 'purchase_orders', true, false, false, false),
  ('keuangan', 'purchase_receipts', true, false, false, false),
  ('pembelian', 'accounts', true, false, false, false),
  ('penjualan', 'accounts', true, false, false, false),
  ('gudang', 'accounts', true, false, false, false),
  ('viewer', 'accounts', true, false, false, false);

-- Fungsi internal tidak boleh dipanggil langsung dari API
do $$
declare f text;
begin
  foreach f in array array[
    '_gl(uuid,numeric,numeric,date,text,uuid,text,text,uuid,text,uuid,text)', '_reverse_gl(text,uuid)',
    '_post_gl(text,uuid)', '_submit_payment_entry(uuid)', '_cancel_payment_entry(uuid)',
    '_submit_journal_entry(uuid)', '_update_invoice_status(text,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- Zona waktu database = WIB, supaya current_date tidak mundur sehari sebelum jam 07.00
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Jakarta');
exception when others then
  raise notice 'Tidak bisa mengubah timezone database (%). Atur manual: alter database postgres set timezone to ''Asia/Jakarta''', sqlerrm;
end $$;

-- ================= supabase/migrations/0007_hardening.sql =================
-- =====================================================================
-- 0007 PENGERASAN KEAMANAN (rekomendasi Supabase Advisor)
--   * Pengunjung tanpa login (anon) tidak bisa memanggil fungsi apa pun
--   * Fungsi trigger & internal tidak bisa dipanggil lewat API
--   * search_path dikunci pada semua fungsi
-- =====================================================================

revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Hanya untuk trigger / dipanggil dari fungsi security definer lain
revoke execute on function public.audit_trigger()                    from authenticated;
revoke execute on function public.handle_new_user()                  from authenticated;
revoke execute on function public.calc_payment_entry()               from authenticated;
revoke execute on function public.fill_ref_outstanding()             from authenticated;
revoke execute on function public._acc(text)                         from authenticated;
revoke execute on function public._check_posting_date(date, boolean) from authenticated;

-- Kunci search_path
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- ================= supabase/migrations/0008_auto_codes.sql =================
-- =====================================================================
-- 0008 KODE MASTER OTOMATIS
--   Item     : awalan menurut jenis -> RM-0001 (Bahan Baku), PM- (Bahan Kemas),
--              FG- (Produk Jadi), TG- (Barang Dagang), SV- (Jasa), OT- (Lainnya)
--   Supplier : SUP-0001     Customer : CUS-0001     Gudang : WH-001
-- Kode dibuat saat data pertama kali disimpan dan tidak bisa diubah.
-- Kode lama yang sudah ada tetap dipakai. (NOT NULL tetap berlaku: dicek setelah trigger mengisi kode.)
-- =====================================================================

create or replace function public.next_code(p_prefix text, p_digits int, p_table text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; v_code text; v_exists boolean;
begin
  loop
    insert into public.naming_series (key, current) values ('CODE:' || p_prefix, 1)
    on conflict (key) do update set current = naming_series.current + 1
    returning current into v_n;
    v_code := p_prefix || '-' || lpad(v_n::text, p_digits, '0');
    execute format('select exists (select 1 from public.%I where code = $1)', p_table) into v_exists using v_code;
    exit when not v_exists;   -- lewati nomor yang kebetulan sudah dipakai
  end loop;
  return v_code;
end $$;
revoke execute on function public.next_code(text, int, text) from public, anon, authenticated;

create or replace function public.set_master_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_digits int := 4;
begin
  if tg_op = 'UPDATE' then
    new.code := old.code;          -- kode tidak bisa diubah
    return new;
  end if;
  if coalesce(trim(new.code), '') <> '' then return new; end if;   -- impor data lama boleh membawa kode sendiri
  v_prefix := case tg_table_name
    when 'suppliers'  then 'SUP'
    when 'customers'  then 'CUS'
    when 'warehouses' then 'WH'
    when 'items' then case to_jsonb(new)->>'item_type'
        when 'Bahan Baku'    then 'RM'
        when 'Bahan Kemas'   then 'PM'
        when 'Produk Jadi'   then 'FG'
        when 'Barang Dagang' then 'TG'
        when 'Jasa'          then 'SV'
        else 'OT' end
  end;
  if tg_table_name = 'warehouses' then v_digits := 3; end if;
  new.code := public.next_code(v_prefix, v_digits, tg_table_name);
  return new;
end $$;
revoke execute on function public.set_master_code() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['items','suppliers','customers','warehouses'] loop
    execute format('create trigger %I before insert or update of code on public.%I for each row execute function public.set_master_code()',
                   t || '_code', t);
  end loop;
end $$;

-- ================= supabase/migrations/0009_where_used.sql =================
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

-- ================= supabase/seed.sql =================
-- Data awal contoh. Silakan ubah sesuai kondisi riil sebelum go-live.
insert into public.companies (name, abbr, address, city, default_ppn)
values ('CV. Sekar Jaya Abadi', 'SJA', null, 'Gresik', 11)
on conflict do nothing;

insert into public.uoms (code, name, whole_number) values
  ('Kg','Kilogram',false), ('g','Gram',false), ('L','Liter',false), ('mL','Mililiter',false),
  ('Pcs','Pieces',true), ('Botol','Botol',true), ('Jerigen','Jerigen',true), ('Sak','Sak',true),
  ('Dus','Dus/Karton',true), ('Roll','Roll',true)
on conflict do nothing;

insert into public.item_groups (name) values
  ('Bahan Aktif'), ('Bahan Tambahan'), ('Kemasan'), ('Obat Hewan'), ('Disinfektan'), ('Pakan & Suplemen')
on conflict do nothing;

insert into public.warehouses (code, name, warehouse_type) values
  ('WH-KAR', 'Gudang Karantina',       'Karantina'),
  ('WH-BB',  'Gudang Bahan Baku',      'Bahan Baku'),
  ('WH-BK',  'Gudang Bahan Kemas',     'Bahan Kemas'),
  ('WH-FG',  'Gudang Produk Jadi',     'Produk Jadi'),
  ('WH-REJ', 'Gudang Reject',          'Reject')
on conflict do nothing;

insert into public.items (code, name, item_group_id, item_type, stock_uom, has_batch, has_expiry,
                          shelf_life_days, standard_buying_rate, standard_selling_rate, min_qty) values
  ('RM-BKC80',  'Benzalkonium Chloride 80%', (select id from public.item_groups where name='Bahan Aktif'),
                'Bahan Baku', 'Kg', true, true, 730, 85000, 0, 50),
  ('RM-PVI10',  'Povidone Iodine',           (select id from public.item_groups where name='Bahan Aktif'),
                'Bahan Baku', 'Kg', true, true, 730, 210000, 0, 20),
  ('RM-AQ',     'Aquadest',                  (select id from public.item_groups where name='Bahan Tambahan'),
                'Bahan Baku', 'L', false, false, null, 1500, 0, 200),
  ('PM-BTL1L',  'Botol HDPE 1 L + Tutup',    (select id from public.item_groups where name='Kemasan'),
                'Bahan Kemas', 'Pcs', false, false, null, 3500, 0, 1000),
  ('PM-JRG5L',  'Jerigen HDPE 5 L',          (select id from public.item_groups where name='Kemasan'),
                'Bahan Kemas', 'Pcs', false, false, null, 9000, 0, 300),
  ('FG-DSF1L',  'Disinfektan BKC 1 L',       (select id from public.item_groups where name='Disinfektan'),
                'Produk Jadi', 'Botol', true, true, 730, 0, 65000, 200),
  ('FG-DSF5L',  'Disinfektan BKC 5 L',       (select id from public.item_groups where name='Disinfektan'),
                'Produk Jadi', 'Jerigen', true, true, 730, 0, 290000, 50),
  ('FG-IOD1L',  'Iodine Tambak 1 L',         (select id from public.item_groups where name='Disinfektan'),
                'Produk Jadi', 'Botol', true, true, 730, 0, 95000, 100)
on conflict do nothing;

insert into public.suppliers (code, name, supplier_group, city, payment_terms_days, is_approved) values
  ('SUP-001', 'PT Kimia Contoh Sejahtera', 'Lokal', 'Surabaya', 30, true),
  ('SUP-002', 'CV Plastik Contoh Jaya',    'Lokal', 'Sidoarjo', 14, true),
  ('SUP-003', 'PT Supplier Baru (belum approved)', 'Lokal', 'Gresik', 30, false)
on conflict do nothing;

insert into public.customers (code, name, customer_group, city, payment_terms_days, credit_limit) values
  ('CUS-001', 'Distributor Contoh Jatim', 'Distributor', 'Surabaya', 30, 100000000),
  ('CUS-002', 'Tambak Udang Contoh',      'Tambak',      'Banyuwangi', 14, 0),
  ('CUS-003', 'Poultry Shop Contoh',      'Poultry Shop','Lamongan', 7, 0)
on conflict do nothing;

-- Tanggal mulai pembukuan: 29 Oktober 2026 (ubah di menu Perusahaan bila perlu)
update public.companies set books_start_date = '2026-10-29' where abbr = 'SJA';

-- Item bantu untuk invoice saldo awal (piutang/hutang lama)
insert into public.items (code, name, item_type, stock_uom, is_stock_item)
values ('SALDO-AWAL', 'Saldo Awal Piutang/Hutang', 'Jasa', 'Pcs', false)
on conflict do nothing;
