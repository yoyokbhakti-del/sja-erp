-- =====================================================================
-- 0011 DESAIN CETAKAN: tata letak cetak grafis yang bisa diatur pengguna
--   (menu Pengaturan > Desain Cetakan). Satu dokumen boleh punya banyak
--   desain; satu di antaranya bisa dijadikan default per jenis dokumen.
--   Tanpa desain, cetak memakai tata letak bawaan aplikasi.
-- =====================================================================

create table public.print_designs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  doctype    text not null
             check (doctype in ('sales_invoices','delivery_notes','sales_orders','purchase_orders',
                                'purchase_receipts','purchase_invoices','stock_entries')),
  is_default boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

-- maksimal satu desain default untuk setiap jenis dokumen
create unique index print_designs_one_default on public.print_designs (doctype) where is_default;
create index print_designs_doctype_idx on public.print_designs (doctype);

select public._setup_master('print_designs');

-- Semua role boleh MELIHAT desain (perlu agar bisa mencetak). Mengubah desain
-- butuh izin tulis: admin sudah punya lewat '*'; role lain diatur di Pengguna & Role.
insert into public.permissions (role_id, doctype, can_read, can_write, can_submit, can_cancel)
select id, 'print_designs', true, false, false, false
  from public.roles
 where id not in ('admin', 'manajer')
on conflict (role_id, doctype) do nothing;
