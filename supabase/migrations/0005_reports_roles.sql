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
