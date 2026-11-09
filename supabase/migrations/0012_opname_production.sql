-- =====================================================================
-- 0012 STOK OPNAME & MANUFAKTUR (retur sudah ada di 0011a_returns_prices)
--   stock_reconciliations : Stok Opname (hitung fisik -> selisih jadi penyesuaian stok + jurnal)
--   boms / bom_items      : Formula (BOM) produk jadi, disetujui lewat Submit
--   work_orders           : Perintah Produksi (pakai bahan FEFO -> hasil produksi ber-batch)
-- Mengikuti pola dokumen yang sudah ada: Draft -> Submit -> Cancel, stok & jurnal otomatis.
-- =====================================================================

-- ----------------------------- STOK OPNAME -----------------------------
create table public.stock_reconciliations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text unique,
  posting_date          date not null default current_date,
  warehouse_id          uuid references public.warehouses(id),
  difference_account_id uuid references public.accounts(id),
  company_id            uuid not null default public.default_company() references public.companies(id),
  difference_amount     numeric(18,2) not null default 0,
  remarks               text,
  docstatus             smallint not null default 0,
  status                text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.stock_reconciliation_items (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references public.stock_reconciliations(id) on delete cascade,
  idx              integer not null default 1,
  item_id          uuid not null references public.items(id),
  warehouse_id     uuid references public.warehouses(id),
  batch_no         text,
  expiry_date      date,                       -- hanya untuk batch baru yang ditemukan saat opname
  system_qty       numeric(18,3) not null default 0,   -- diisi sistem saat submit
  counted_qty      numeric(18,3) not null check (counted_qty >= 0),
  difference_qty   numeric(18,3) not null default 0,
  rate             numeric(18,4) not null default 0,   -- harga untuk selisih lebih (kosong = harga rata-rata)
  difference_amount numeric(18,2) not null default 0,
  batch_allocation text
);
select public._setup_doc('stock_reconciliations', 'OPN');
select public._setup_child('stock_reconciliation_items', 'stock_reconciliations');

-- ----------------------------- MANUFAKTUR ------------------------------
create table public.boms (
  id         uuid primary key default gen_random_uuid(),
  name       text unique,
  item_id    uuid not null references public.items(id),       -- produk jadi
  qty        numeric(18,3) not null default 1 check (qty > 0), -- ukuran batch standar formula ini
  remarks    text,
  docstatus  smallint not null default 0,
  status     text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.bom_items (
  id        uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.boms(id) on delete cascade,
  idx       integer not null default 1,
  item_id   uuid not null references public.items(id),        -- bahan baku / kemas
  qty       numeric(18,3) not null check (qty > 0)             -- per ukuran batch di atas
);
select public._setup_doc('boms', 'BOM');
select public._setup_child('bom_items', 'boms');

create table public.work_orders (
  id                  uuid primary key default gen_random_uuid(),
  name                text unique,
  bom_id              uuid not null references public.boms(id),
  item_id             uuid not null references public.items(id),   -- diisi otomatis dari BOM
  qty                 numeric(18,3) not null check (qty > 0),       -- jumlah produk jadi yang diproduksi
  posting_date        date not null default current_date,
  source_warehouse_id uuid references public.warehouses(id),         -- gudang bahan
  target_warehouse_id uuid references public.warehouses(id),         -- gudang hasil produksi
  batch_no            text,                                          -- batch produk jadi
  mfg_date            date,
  expiry_date         date,
  company_id          uuid not null default public.default_company() references public.companies(id),
  total_cost          numeric(18,2) not null default 0,
  unit_cost           numeric(18,4) not null default 0,
  remarks             text,
  docstatus           smallint not null default 0,
  status              text not null default 'Draft',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
create table public.work_order_items (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references public.work_orders(id) on delete cascade,
  idx              integer not null default 1,
  item_id          uuid not null references public.items(id),
  qty              numeric(18,3) not null check (qty > 0),           -- yang dipakai
  warehouse_id     uuid references public.warehouses(id),
  batch_no         text,                                              -- kosong = FEFO
  rate             numeric(18,4) not null default 0,                  -- diisi sistem saat submit
  amount           numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  batch_allocation text
);
select public._setup_doc('work_orders', 'WO');
select public._setup_child('work_order_items', 'work_orders');

create or replace function public.wo_set_item() returns trigger language plpgsql as $$
begin
  if new.docstatus = 0 then
    select item_id into new.item_id from public.boms where id = new.bom_id;
  end if;
  return new;
end $$;
create trigger work_orders_item before insert or update on public.work_orders
  for each row execute function public.wo_set_item();

-- ----------------------------- POSTING STOK ----------------------------
-- Stok Opname
create or replace function public._submit_stock_reconciliation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  d public.stock_reconciliations; r public.stock_reconciliation_items; it public.items; a record;
  v_wh uuid; v_batch uuid; v_sys numeric; v_diff numeric; v_rate numeric; v_amt numeric; v_tot numeric := 0;
begin
  select * into d from public.stock_reconciliations where id = p_id;
  for r in select * from public.stock_reconciliation_items where parent_id = p_id order by idx loop
    v_wh := coalesce(r.warehouse_id, d.warehouse_id);
    if v_wh is null then raise exception 'Baris %: Gudang wajib diisi', r.idx; end if;
    select * into it from public.items where id = r.item_id;
    if not it.is_stock_item then raise exception 'Baris %: % bukan item stok', r.idx, it.code; end if;

    v_batch := null;
    if it.has_batch then
      if coalesce(r.batch_no, '') = '' then
        raise exception 'Baris %: item % memakai batch, isi No. Batch yang dihitung', r.idx, it.code;
      end if;
      select id into v_batch from public.batches where item_id = r.item_id and batch_no = r.batch_no;
      v_sys := case when v_batch is null then 0 else
        coalesce((select sum(qty) from public.stock_ledger
                   where item_id = r.item_id and warehouse_id = v_wh and batch_id = v_batch), 0) end;
    else
      v_sys := coalesce((select actual_qty from public.bins where item_id = r.item_id and warehouse_id = v_wh), 0);
    end if;

    v_diff := r.counted_qty - v_sys;
    v_amt := 0;
    if v_diff > 0 then
      v_batch := public._ensure_batch(r.item_id, r.batch_no, null, r.expiry_date);
      v_rate := coalesce(nullif(r.rate, 0),
                         (select nullif(valuation_rate, 0) from public.bins where item_id = r.item_id and warehouse_id = v_wh),
                         nullif(it.standard_buying_rate, 0));
      v_rate := public._post_sle(r.item_id, v_wh, v_batch, v_diff, v_rate, d.posting_date,
                                 'stock_reconciliations', d.id, d.name);
      v_amt := round(v_diff * v_rate, 2);
    elsif v_diff < 0 then
      for a in select * from public._issue_stock(r.item_id, v_wh, -v_diff, r.batch_no, d.posting_date,
                                                  'stock_reconciliations', d.id, d.name, true) loop
        v_amt := v_amt - round(a.qty * a.rate, 2);
      end loop;
    end if;

    update public.stock_reconciliation_items
       set system_qty = v_sys, difference_qty = v_diff, difference_amount = v_amt where id = r.id;
    v_tot := v_tot + v_amt;
  end loop;
  update public.stock_reconciliations set difference_amount = v_tot where id = p_id;
end $$;

-- Isi baris opname dari stok sistem di gudang (per item / per batch)
create or replace function public.load_stock_reconciliation(p_sr uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.stock_reconciliations;
begin
  perform public.require_perm('stock_reconciliations', 'write');
  select * into d from public.stock_reconciliations where id = p_sr;
  if d.id is null then raise exception 'Dokumen tidak ditemukan'; end if;
  if d.docstatus <> 0 then raise exception 'Hanya dokumen Draft yang bisa diisi ulang'; end if;
  if d.warehouse_id is null then raise exception 'Isi Gudang lebih dulu'; end if;
  delete from public.stock_reconciliation_items where parent_id = p_sr;
  insert into public.stock_reconciliation_items (parent_id, idx, item_id, batch_no, expiry_date, system_qty, counted_qty, rate)
  select p_sr, row_number() over (order by x.code, x.batch_no), x.item_id, x.batch_no, x.expiry_date, x.qty, x.qty, x.rate
    from (
      select i.id item_id, i.code, null::text batch_no, null::date expiry_date, b.actual_qty qty, b.valuation_rate rate
        from public.bins b join public.items i on i.id = b.item_id
       where b.warehouse_id = d.warehouse_id and b.actual_qty > 0 and i.is_stock_item and not i.has_batch
      union all
      select i.id, i.code, bt.batch_no, bt.expiry_date, s.q, coalesce(nullif(bn.valuation_rate, 0), 0)
        from (select sl.item_id, sl.batch_id, sum(sl.qty) q from public.stock_ledger sl
               where sl.warehouse_id = d.warehouse_id and sl.batch_id is not null group by 1, 2 having sum(sl.qty) > 0) s
        join public.items i on i.id = s.item_id
        join public.batches bt on bt.id = s.batch_id
        left join public.bins bn on bn.item_id = s.item_id and bn.warehouse_id = d.warehouse_id
    ) x;
end $$;
grant execute on function public.load_stock_reconciliation(uuid) to authenticated;

-- BOM
create or replace function public._submit_bom(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.boms;
begin
  select * into d from public.boms where id = p_id;
  if exists (select 1 from public.bom_items where parent_id = p_id and item_id = d.item_id) then
    raise exception 'Bahan tidak boleh sama dengan produk jadi';
  end if;
  if exists (select 1 from public.bom_items where parent_id = p_id group by item_id having count(*) > 1) then
    raise exception 'Ada bahan yang dobel di formula. Gabungkan jumlahnya dalam satu baris.';
  end if;
end $$;

-- Isi bahan Perintah Produksi dari BOM (diskalakan sesuai qty produksi)
create or replace function public._fill_work_order_items(p_wo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare wo public.work_orders; b public.boms;
begin
  select * into wo from public.work_orders where id = p_wo;
  select * into b from public.boms where id = wo.bom_id;
  delete from public.work_order_items where parent_id = p_wo;
  insert into public.work_order_items (parent_id, idx, item_id, qty, warehouse_id)
  select p_wo, bi.idx, bi.item_id, greatest(round(bi.qty * wo.qty / b.qty, 3), 0.001), wo.source_warehouse_id
    from public.bom_items bi where bi.parent_id = b.id order by bi.idx;
end $$;

create or replace function public.load_work_order_items(p_wo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare wo public.work_orders;
begin
  perform public.require_perm('work_orders', 'write');
  select * into wo from public.work_orders where id = p_wo;
  if wo.id is null then raise exception 'Dokumen tidak ditemukan'; end if;
  if wo.docstatus <> 0 then raise exception 'Hanya Perintah Produksi Draft yang bisa dihitung ulang'; end if;
  perform public._fill_work_order_items(p_wo);
end $$;
grant execute on function public.load_work_order_items(uuid) to authenticated;

create or replace function public.make_work_order(p_bom uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.boms; v_id uuid;
begin
  perform public.require_perm('work_orders', 'write');
  select * into b from public.boms where id = p_bom;
  if b.docstatus is distinct from 1 then raise exception 'Formula (BOM) harus sudah disubmit'; end if;
  insert into public.work_orders (bom_id, item_id, qty) values (b.id, b.item_id, b.qty) returning id into v_id;
  perform public._fill_work_order_items(v_id);
  return v_id;
end $$;
grant execute on function public.make_work_order(uuid) to authenticated;

-- Perintah Produksi: pakai bahan (FEFO) lalu terima produk jadi ber-batch
create or replace function public._submit_work_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  d public.work_orders; r public.work_order_items; a record; b public.boms; it public.items;
  v_wh uuid; v_alloc text; v_val numeric; v_total numeric := 0; v_batch uuid; v_unit numeric;
begin
  select * into d from public.work_orders where id = p_id;
  select * into b from public.boms where id = d.bom_id;
  if b.docstatus is distinct from 1 then raise exception 'Formula (BOM) % belum disubmit', b.name; end if;
  if d.target_warehouse_id is null then raise exception 'Gudang hasil produksi wajib diisi'; end if;
  select * into it from public.items where id = d.item_id;
  if it.has_batch and coalesce(d.batch_no, '') = '' then
    raise exception 'Item % memakai batch: isi No. Batch produk jadi', it.code;
  end if;

  for r in select * from public.work_order_items where parent_id = p_id order by idx loop
    v_wh := coalesce(r.warehouse_id, d.source_warehouse_id);
    if v_wh is null and exists (select 1 from public.items where id = r.item_id and is_stock_item) then
      raise exception 'Baris %: Gudang bahan wajib diisi', r.idx;
    end if;
    v_val := 0; v_alloc := null;
    if v_wh is not null then
      for a in select * from public._issue_stock(r.item_id, v_wh, r.qty, r.batch_no, d.posting_date,
                                                  'work_orders', d.id, d.name, false) loop
        v_val := v_val + a.qty * a.rate;
        if a.batch_id is not null then
          v_alloc := concat_ws(', ', v_alloc,
                     (select batch_no from public.batches where id = a.batch_id) || ' (' || trim_scale(a.qty) || ')');
        end if;
      end loop;
    end if;
    update public.work_order_items set rate = round(v_val / r.qty, 4), batch_allocation = v_alloc where id = r.id;
    v_total := v_total + v_val;
  end loop;

  v_unit := round(v_total / d.qty, 4);
  v_batch := public._ensure_batch(d.item_id, d.batch_no, d.mfg_date, d.expiry_date);
  perform public._post_sle(d.item_id, d.target_warehouse_id, v_batch, d.qty, v_unit, d.posting_date,
                           'work_orders', d.id, d.name);
  update public.work_orders set total_cost = round(v_total, 2), unit_cost = v_unit where id = p_id;
end $$;

-- fungsi internal tidak boleh dipanggil langsung dari API
do $$
declare f text;
begin
  foreach f in array array['_submit_stock_reconciliation(uuid)', '_submit_bom(uuid)', '_fill_work_order_items(uuid)', '_submit_work_order(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ------------------------------ ROLE & IZIN ----------------------------
insert into public.roles (id, name, description) values
  ('produksi', 'Staf Produksi', 'Formula (BOM) dan Perintah Produksi');

insert into public.permissions (role_id, doctype, can_read, can_write, can_submit, can_cancel) values
  ('gudang', 'stock_reconciliations', true, true, true, false),
  ('gudang', 'boms', true, false, false, false),
  ('gudang', 'work_orders', true, true, true, false),
  ('gudang', 'accounts', true, false, false, false),
  ('keuangan', 'stock_reconciliations', true, false, false, false),
  ('produksi', 'boms', true, true, false, false),
  ('produksi', 'work_orders', true, true, true, false),
  ('produksi', 'items', true, false, false, false), ('produksi', 'uoms', true, false, false, false),
  ('produksi', 'item_groups', true, false, false, false), ('produksi', 'warehouses', true, false, false, false),
  ('produksi', 'stock_ledger', true, false, false, false), ('produksi', 'accounts', true, false, false, false)
on conflict (role_id, doctype) do nothing;


-- ---------------- FUNGSI INDUK DIPERBARUI (submit/cancel/jurnal/duplikat) ----------------
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
    when 'stock_reconciliations' then 'stock_reconciliation_items'
    when 'boms'              then 'bom_items'
    when 'work_orders'       then 'work_order_items'
  end
$$;

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

  elsif p_doctype in ('stock_entries','stock_reconciliations') then
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
    when 'stock_reconciliations' then perform public._submit_stock_reconciliation(p_id);
    when 'boms'              then perform public._submit_bom(p_id); v_status := 'Disetujui';
    when 'work_orders'       then perform public._submit_work_order(p_id); v_status := 'Selesai';
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
  if p_doctype not in ('purchase_orders','sales_orders','boms') then perform public._post_gl(p_doctype, p_id); end if;

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
  if p_doctype = 'boms' then
    v_dep := (select string_agg(name, ', ') from public.work_orders where bom_id = p_id and docstatus = 1);
  end if;
  if v_dep is not null then
    raise exception 'Tidak bisa membatalkan %: masih dipakai oleh %. Batalkan dokumen tersebut dulu.', v_name, v_dep;
  end if;

  perform set_config('app.bypass', 'on', true);

  if p_doctype in ('stock_entries','purchase_receipts','delivery_notes','stock_reconciliations','work_orders') then
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
                             'per_received','per_delivered','outstanding_amount',
                             'applied_amount','difference_amount','total_cost','unit_cost');
  execute format('insert into public.%I (id, %s) select $2, %s from public.%I where id = $1',
                 p_doctype, v_cols, v_cols, p_doctype) using p_id, v_new;
  select string_agg(quote_ident(column_name), ', ') into v_ccols
    from information_schema.columns
   where table_schema = 'public' and table_name = v_child and is_generated = 'NEVER'
     and column_name not in ('id','parent_id','received_qty','delivered_qty','batch_allocation',
                     'system_qty','difference_qty','difference_amount');
  execute format('insert into public.%I (parent_id, %s) select $2, %s from public.%I where parent_id = $1',
                 v_child, v_ccols, v_ccols, v_child) using p_id, v_new;
  return v_new;
end $$;
