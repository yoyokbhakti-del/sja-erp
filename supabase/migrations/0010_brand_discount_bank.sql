-- =====================================================================
-- 0010 MERK, DISKON PER BARIS, REKENING BANK & NAMA KOP CETAK
-- =====================================================================

-- Merk item
alter table public.items add column if not exists brand text;

-- Data kop & rekening di cetakan
alter table public.companies
  add column if not exists print_name        text,   -- nama di kop cetak, mis. "SEKAR JAYA ABADI GROUP"
  add column if not exists bank_name         text,   -- mis. "BCA"
  add column if not exists bank_account_name text,   -- atas nama
  add column if not exists bank_account_no   text;

-- Diskon (%) per baris. amount = qty x harga x (1 - diskon%)
do $$
declare t text;
begin
  foreach t in array array['sales_order_items','delivery_note_items','sales_invoice_items',
                           'purchase_order_items','purchase_invoice_items'] loop
    execute format('alter table public.%I add column discount_percent numeric(5,2) not null default 0
                    check (discount_percent >= 0 and discount_percent <= 100)', t);
    execute format('alter table public.%I drop column amount', t);
    execute format('alter table public.%I add column amount numeric(18,2)
                    generated always as (round(qty * rate * (1 - discount_percent / 100), 2)) stored', t);
  end loop;
end $$;

-- Dokumen turunan ikut membawa diskon
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
  insert into public.delivery_note_items (parent_id, idx, item_id, qty, rate, discount_percent, warehouse_id, so_item_id)
  select v_id, row_number() over (order by idx), item_id, qty - delivered_qty, rate, discount_percent,
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
  insert into public.sales_invoice_items (parent_id, idx, item_id, qty, rate, discount_percent)
  select v_id, idx, item_id, qty, rate, discount_percent from public.delivery_note_items where parent_id = p_dn;
  return v_id;
end $$;

-- Penerimaan barang memakai harga bersih setelah diskon PO (untuk nilai persediaan)
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
  select v_id, row_number() over (order by idx), item_id, qty - received_qty,
         round(rate * (1 - discount_percent / 100), 2),
         coalesce(warehouse_id, po.set_warehouse_id), id
    from public.purchase_order_items where parent_id = p_po and qty > received_qty;
  return v_id;
end $$;
