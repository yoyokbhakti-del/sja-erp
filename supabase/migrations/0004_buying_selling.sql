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
