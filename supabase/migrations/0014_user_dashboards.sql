-- =====================================================================
-- 0014 DASBOR PER PENGGUNA: susunan widget di halaman Beranda.
--   Setiap pengguna menyimpan susunannya sendiri (daftar widget + ukuran
--   + urutan) sehingga sama di semua perangkat.
-- =====================================================================

create table if not exists public.user_dashboards (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  widgets    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_dashboards enable row level security;

drop policy if exists user_dashboards_own on public.user_dashboards;
create policy user_dashboards_own on public.user_dashboards
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_dashboards to authenticated;
