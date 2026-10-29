-- Uji modul akuntansi. Jalankan di DB baru: stub -> migrasi -> seed -> file ini.
\set QUIET on
\pset footer off
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'admin@sja.test');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

\echo '=== 1. SALDO AWAL (tanggal sebelum mulai pembukuan) ==='
-- stok awal
insert into stock_entries (id, purpose, posting_date, to_warehouse_id, is_opening)
select '10000000-0000-0000-0000-000000000001', 'Penerimaan Material', '2026-10-28', id, true from warehouses where code = 'WH-FG';
insert into stock_entry_items (parent_id, item_id, qty, batch_no, expiry_date, basic_rate)
values ('10000000-0000-0000-0000-000000000001', (select id from items where code='FG-DSF1L'), 100, 'OPN-01', '2028-06-30', 30000);
select submit_doc('stock_entries', '10000000-0000-0000-0000-000000000001');
-- piutang lama (sudah jatuh tempo)
insert into sales_invoices (id, customer_id, posting_date, due_date, ppn_percent, is_opening)
select '20000000-0000-0000-0000-000000000001', id, '2026-09-15', '2026-10-15', 0, true from customers where code = 'CUS-001';
insert into sales_invoice_items (parent_id, item_id, qty, rate)
values ('20000000-0000-0000-0000-000000000001', (select id from items where code='SALDO-AWAL'), 1, 5000000);
select submit_doc('sales_invoices', '20000000-0000-0000-0000-000000000001');
-- hutang lama
insert into purchase_invoices (id, supplier_id, posting_date, ppn_percent, is_opening)
select '30000000-0000-0000-0000-000000000001', id, '2026-10-20', 0, true from suppliers where code = 'SUP-002';
insert into purchase_invoice_items (parent_id, item_id, qty, rate)
values ('30000000-0000-0000-0000-000000000001', (select id from items where code='SALDO-AWAL'), 1, 3000000);
select submit_doc('purchase_invoices', '30000000-0000-0000-0000-000000000001');
-- kas & bank awal
insert into journal_entries (id, voucher_type, posting_date, remarks)
values ('40000000-0000-0000-0000-000000000001', 'Saldo Awal', '2026-10-28', 'Saldo awal kas & bank');
insert into journal_entry_accounts (parent_id, idx, account_id, debit, credit) values
 ('40000000-0000-0000-0000-000000000001', 1, (select id from accounts where code='1101'), 50000000, 0),
 ('40000000-0000-0000-0000-000000000001', 2, (select id from accounts where code='1111'), 200000000, 0),
 ('40000000-0000-0000-0000-000000000001', 3, (select id from accounts where code='3901'), 0, 250000000);
select submit_doc('journal_entries', '40000000-0000-0000-0000-000000000001');

\echo '--- 1b. Transaksi biasa bertanggal sebelum mulai pembukuan (harus GAGAL)'
insert into journal_entries (id, posting_date) values ('40000000-0000-0000-0000-000000000002', '2026-10-28');
insert into journal_entry_accounts (parent_id, idx, account_id, debit, credit) values
 ('40000000-0000-0000-0000-000000000002', 1, (select id from accounts where code='6102'), 100000, 0),
 ('40000000-0000-0000-0000-000000000002', 2, (select id from accounts where code='1101'), 0, 100000);
select submit_doc('journal_entries', '40000000-0000-0000-0000-000000000002');

\echo '=== 2. PEMBELIAN: PO -> PR -> PI ==='
insert into purchase_orders (id, supplier_id, set_warehouse_id)
select '50000000-0000-0000-0000-000000000001', (select id from suppliers where code='SUP-001'), (select id from warehouses where code='WH-BB');
insert into purchase_order_items (parent_id, item_id, qty, rate) values
 ('50000000-0000-0000-0000-000000000001', (select id from items where code='RM-BKC80'), 100, 85000);
select submit_doc('purchase_orders', '50000000-0000-0000-0000-000000000001');
select make_purchase_receipt('50000000-0000-0000-0000-000000000001') pr \gset
update purchase_receipt_items set batch_no = 'BKC-A', expiry_date = '2028-10-01' where parent_id = :'pr';
select submit_doc('purchase_receipts', :'pr');
select make_purchase_invoice(:'pr') pinv \gset
update purchase_invoices set bill_no = 'INV-SUP-778', faktur_pajak_no = '010.000-26.00000001' where id = :'pinv';
select submit_doc('purchase_invoices', :'pinv');
select voucher_no, account_code, account_name, debit, credit, party_name from v_general_ledger
 where voucher_id in (:'pr', :'pinv') order by id;

\echo '--- 2b. PI langsung berisi item stok tanpa PR (harus GAGAL)'
insert into purchase_invoices (id, supplier_id) select '30000000-0000-0000-0000-000000000009', id from suppliers where code='SUP-001';
insert into purchase_invoice_items (parent_id, item_id, qty, rate)
values ('30000000-0000-0000-0000-000000000009', (select id from items where code='RM-AQ'), 10, 1500);
select submit_doc('purchase_invoices', '30000000-0000-0000-0000-000000000009');

\echo '=== 3. PENJUALAN: SO -> DN -> SI ==='
insert into sales_orders (id, customer_id, set_warehouse_id)
select '60000000-0000-0000-0000-000000000001', (select id from customers where code='CUS-002'), (select id from warehouses where code='WH-FG');
insert into sales_order_items (parent_id, item_id, qty, rate) values
 ('60000000-0000-0000-0000-000000000001', (select id from items where code='FG-DSF1L'), 40, 65000);
select submit_doc('sales_orders', '60000000-0000-0000-0000-000000000001');
select make_delivery_note('60000000-0000-0000-0000-000000000001') dn \gset
select submit_doc('delivery_notes', :'dn');
select make_sales_invoice(:'dn') sinv \gset
select submit_doc('sales_invoices', :'sinv');
select voucher_no, account_code, account_name, debit, credit, party_name from v_general_ledger
 where voucher_id in (:'dn', :'sinv') order by id;

\echo '=== 4. PENERIMAAN PIUTANG: sebagian lalu sisanya ==='
select make_payment_from_sales_invoice(:'sinv') pay1 \gset
update payment_entries set paid_amount = 1000000, paid_to_account_id = (select id from accounts where code='1111'),
       reference_no = 'TRF-BCA-001' where id = :'pay1';
update payment_entry_references set allocated_amount = 1000000 where parent_id = :'pay1';
select submit_doc('payment_entries', :'pay1');
select name, status, grand_total, outstanding_amount from sales_invoices where id = :'sinv';

\echo '--- 4b. Cancel SI yang sudah ada pembayaran (harus GAGAL)'
select cancel_doc('sales_invoices', :'sinv');

\echo '--- 4c. Pembayaran kedua: ambil semua invoice terbuka CUS-002 otomatis'
insert into payment_entries (id, payment_type, customer_id) select '70000000-0000-0000-0000-000000000002', 'Terima', id from customers where code='CUS-002';
select get_outstanding_invoices('70000000-0000-0000-0000-000000000002') n_invoice;
select paid_amount, total_allocated, unallocated_amount from payment_entries where id = '70000000-0000-0000-0000-000000000002';
select submit_doc('payment_entries', '70000000-0000-0000-0000-000000000002');
select name, status, outstanding_amount from sales_invoices where id = :'sinv';

\echo '--- 4d. Alokasi melebihi sisa tagihan (harus GAGAL)'
insert into payment_entries (id, payment_type, customer_id, paid_amount) select '70000000-0000-0000-0000-000000000003', 'Terima', id, 9999999 from customers where code='CUS-001';
insert into payment_entry_references (parent_id, sales_invoice_id, allocated_amount) values ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 9999999);
select submit_doc('payment_entries', '70000000-0000-0000-0000-000000000003');

\echo '--- 4e. Piutang lama dicicil 2 jt + uang muka 500 rb (tidak dialokasikan)'
update payment_entry_references set allocated_amount = 2000000 where parent_id = '70000000-0000-0000-0000-000000000003';
update payment_entries set paid_amount = 2500000 where id = '70000000-0000-0000-0000-000000000003';
select submit_doc('payment_entries', '70000000-0000-0000-0000-000000000003');
select account_code, debit, credit, party_name, against_voucher_type, remarks from v_general_ledger
 where voucher_id = '70000000-0000-0000-0000-000000000003' order by id;

\echo '=== 5. BAYAR HUTANG (semua invoice SUP-001 & SUP-002) ==='
insert into payment_entries (id, payment_type, supplier_id, paid_from_account_id)
select '80000000-0000-0000-0000-000000000001', 'Bayar', id, (select id from accounts where code='1111') from suppliers where code='SUP-001';
select get_outstanding_invoices('80000000-0000-0000-0000-000000000001');
select submit_doc('payment_entries', '80000000-0000-0000-0000-000000000001');
select name, status, outstanding_amount from purchase_invoices order by name;

\echo '--- 5b. Cancel pembayaran -> outstanding kembali'
select cancel_doc('payment_entries', '80000000-0000-0000-0000-000000000001');
select name, status, outstanding_amount from purchase_invoices where docstatus = 1 order by name;

\echo '=== 6. JURNAL: tidak seimbang (GAGAL) lalu beban listrik dibayar kas ==='
insert into journal_entries (id, voucher_type, remarks) values ('40000000-0000-0000-0000-000000000003', 'Kas Keluar', 'Listrik Oktober');
insert into journal_entry_accounts (parent_id, idx, account_id, debit, credit) values
 ('40000000-0000-0000-0000-000000000003', 1, (select id from accounts where code='6102'), 1250000, 0),
 ('40000000-0000-0000-0000-000000000003', 2, (select id from accounts where code='1101'), 0, 1200000);
select submit_doc('journal_entries', '40000000-0000-0000-0000-000000000003');
update journal_entry_accounts set credit = 1250000 where parent_id = '40000000-0000-0000-0000-000000000003' and idx = 2;
select submit_doc('journal_entries', '40000000-0000-0000-0000-000000000003');

\echo '--- 6b. Jurnal ke akun Piutang tanpa customer (GAGAL)'
insert into journal_entries (id) values ('40000000-0000-0000-0000-000000000004');
insert into journal_entry_accounts (parent_id, idx, account_id, debit, credit) values
 ('40000000-0000-0000-0000-000000000004', 1, (select id from accounts where code='1201'), 10, 0),
 ('40000000-0000-0000-0000-000000000004', 2, (select id from accounts where code='4201'), 0, 10);
select submit_doc('journal_entries', '40000000-0000-0000-0000-000000000004');

\echo '=== 7. NERACA SALDO (harus seimbang) ==='
select code, name, debit, credit, closing from trial_balance('2026-01-01', current_date) where debit <> 0 or credit <> 0 or closing <> 0;
select sum(closing) as total_harus_nol, sum(debit) total_debit, sum(credit) total_kredit from trial_balance('2026-01-01', current_date);
select 'Nilai persediaan (stok) = saldo akun 1301?' cek,
       (select sum(stock_value) from bins) stok, (select closing from trial_balance('2000-01-01', current_date) where code = '1301') gl;

\echo '=== 8. UMUR PIUTANG ==='
select name, party_name, due_date, outstanding_amount, days_overdue, bucket from v_receivable_aging;

\echo '=== 9. KUNCI PERIODE ==='
reset role;
update companies set frozen_until = current_date;
set role authenticated;
select cancel_doc('journal_entries', '40000000-0000-0000-0000-000000000003');
reset role;
update companies set frozen_until = null;

\echo '=== 10. Dashboard ==='
set role authenticated;
select dashboard_summary() - 'sales_by_month';
reset role;
