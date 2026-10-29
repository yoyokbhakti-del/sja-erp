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
