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
