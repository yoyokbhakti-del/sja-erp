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
