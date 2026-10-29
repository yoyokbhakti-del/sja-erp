-- Uji alur end-to-end. Jalankan setelah migrasi + seed di database uji.
\set QUIET on
\pset footer off
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@sja.test'),
  ('00000000-0000-0000-0000-000000000002', 'viewer@sja.test');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

\echo '--- 1. PO ke supplier approved, lalu submit'
insert into purchase_orders (id, supplier_id, set_warehouse_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', (select id from suppliers where code='SUP-001'), (select id from warehouses where code='WH-BB');
insert into purchase_order_items (parent_id, idx, item_id, qty, rate) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 1, (select id from items where code='RM-BKC80'), 100, 85000),
 ('aaaaaaaa-0000-0000-0000-000000000001', 2, (select id from items where code='RM-AQ'), 500, 1500);
select submit_doc('purchase_orders', 'aaaaaaaa-0000-0000-0000-000000000001') po;
select name, status, net_total, tax_amount, grand_total, per_received from purchase_orders;

\echo '--- 2. Edit PO yang sudah submit (harus GAGAL)'
update purchase_orders set remarks = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '--- 3. PR dari PO, terima sebagian (60 kg) dengan batch'
select make_purchase_receipt('aaaaaaaa-0000-0000-0000-000000000001') as pr1 \gset
update purchase_receipt_items set qty = 60, batch_no = 'BKC-2610A', expiry_date = '2028-10-01'
 where parent_id = :'pr1' and item_id = (select id from items where code='RM-BKC80');
select submit_doc('purchase_receipts', :'pr1');
select name, status, per_received from purchase_orders;

\echo '--- 4. PR kedua: sisa 40 kg tanpa batch (harus GAGAL), lalu dengan batch'
select make_purchase_receipt('aaaaaaaa-0000-0000-0000-000000000001') as pr2 \gset
select submit_doc('purchase_receipts', :'pr2');
update purchase_receipt_items set batch_no = 'BKC-2610B', mfg_date = '2026-10-01', rate = 90000 where parent_id = :'pr2';
select submit_doc('purchase_receipts', :'pr2');
select name, status, per_received from purchase_orders;
select item_code, warehouse_code, actual_qty, valuation_rate, stock_value from v_stock_balance order by 1;
select item_code, batch_no, expiry_date, qty from v_batch_stock order by 1, 2;

\echo '--- 5. Stock Entry penerimaan produk jadi 3 batch (salah satunya kedaluwarsa)'
insert into stock_entries (id, purpose, to_warehouse_id)
select 'bbbbbbbb-0000-0000-0000-000000000001', 'Penerimaan Material', id from warehouses where code='WH-FG';
insert into stock_entry_items (parent_id, idx, item_id, qty, batch_no, expiry_date, basic_rate)
select 'bbbbbbbb-0000-0000-0000-000000000001', v.idx, (select id from items where code='FG-DSF1L'), v.qty, v.b, v.e::date, v.r
from (values (1,100,'DSF-A','2027-06-01',30000),(2,50,'DSF-B','2027-01-15',32000),(3,10,'DSF-OLD','2026-01-01',28000)) v(idx,qty,b,e,r);
select submit_doc('stock_entries', 'bbbbbbbb-0000-0000-0000-000000000001');

\echo '--- 6. SO melebihi plafon kredit (harus GAGAL)'
insert into sales_orders (id, customer_id, set_warehouse_id)
select 'cccccccc-0000-0000-0000-000000000001', (select id from customers where code='CUS-001'), (select id from warehouses where code='WH-FG');
insert into sales_order_items (parent_id, item_id, qty, rate)
values ('cccccccc-0000-0000-0000-000000000001', (select id from items where code='FG-DSF1L'), 2000, 65000);
select submit_doc('sales_orders', 'cccccccc-0000-0000-0000-000000000001');

\echo '--- 7. SO 120 botol -> DN (FEFO: DSF-B 50 dulu, lalu DSF-A 70, lewati yg kedaluwarsa)'
update sales_order_items set qty = 120 where parent_id = 'cccccccc-0000-0000-0000-000000000001';
select submit_doc('sales_orders', 'cccccccc-0000-0000-0000-000000000001');
select make_delivery_note('cccccccc-0000-0000-0000-000000000001') as dn \gset
select submit_doc('delivery_notes', :'dn');
select qty, batch_allocation from delivery_note_items where parent_id = :'dn';
select name, status, per_delivered from sales_orders;
select item_code, batch_no, qty from v_batch_stock where item_code = 'FG-DSF1L' order by 2;

\echo '--- 8. Invoice dari DN'
select make_sales_invoice(:'dn') as si \gset
select submit_doc('sales_invoices', :'si');
select name, status, grand_total, outstanding_amount, due_date - posting_date as terms from sales_invoices;

\echo '--- 9. Cancel DN saat invoice masih aktif (harus GAGAL), lalu cancel SI -> DN'
select cancel_doc('delivery_notes', :'dn');
select cancel_doc('sales_invoices', :'si');
select cancel_doc('delivery_notes', :'dn');
select name, status, per_delivered from sales_orders;
select item_code, batch_no, qty from v_batch_stock where item_code = 'FG-DSF1L' order by 2;

\echo '--- 10. PO ke supplier BELUM approved untuk bahan baku (harus GAGAL)'
insert into purchase_orders (id, supplier_id) select 'aaaaaaaa-0000-0000-0000-000000000009', id from suppliers where code='SUP-003';
insert into purchase_order_items (parent_id, item_id, qty, rate)
values ('aaaaaaaa-0000-0000-0000-000000000009', (select id from items where code='RM-PVI10'), 10, 1);
select submit_doc('purchase_orders', 'aaaaaaaa-0000-0000-0000-000000000009');

\echo '--- 11. Transfer stok melebihi saldo (harus GAGAL)'
insert into stock_entries (id, purpose, from_warehouse_id, to_warehouse_id)
select 'bbbbbbbb-0000-0000-0000-000000000002', 'Transfer Material',
       (select id from warehouses where code='WH-BB'), (select id from warehouses where code='WH-KAR');
insert into stock_entry_items (parent_id, item_id, qty) values
 ('bbbbbbbb-0000-0000-0000-000000000002', (select id from items where code='RM-BKC80'), 1000);
select submit_doc('stock_entries', 'bbbbbbbb-0000-0000-0000-000000000002');
update stock_entry_items set qty = 70 where parent_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select submit_doc('stock_entries', 'bbbbbbbb-0000-0000-0000-000000000002');
select qty, basic_rate, amount, batch_allocation from stock_entry_items where parent_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select item_code, warehouse_code, batch_no, qty from v_batch_stock where item_code='RM-BKC80' order by 2,3;

\echo '--- 12. Dashboard'
select jsonb_pretty(dashboard_summary());

\echo '--- 13. Viewer: baca boleh, tulis/submit ditolak'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select count(*) as items_visible from items;
insert into customers (code, name) values ('X', 'X');
select submit_doc('purchase_orders', 'aaaaaaaa-0000-0000-0000-000000000009');
select count(*) as audit_visible_to_viewer from audit_log;

\echo '--- 14. Audit log (admin)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select action, table_name, count(*) from audit_log group by 1,2 order by 2,1;
reset role;
