-- =====================================================================
-- 0007 PENGERASAN KEAMANAN (rekomendasi Supabase Advisor)
--   * Pengunjung tanpa login (anon) tidak bisa memanggil fungsi apa pun
--   * Fungsi trigger & internal tidak bisa dipanggil lewat API
--   * search_path dikunci pada semua fungsi
-- =====================================================================

revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Hanya untuk trigger / dipanggil dari fungsi security definer lain
revoke execute on function public.audit_trigger()                    from authenticated;
revoke execute on function public.handle_new_user()                  from authenticated;
revoke execute on function public.calc_payment_entry()               from authenticated;
revoke execute on function public.fill_ref_outstanding()             from authenticated;
revoke execute on function public._acc(text)                         from authenticated;
revoke execute on function public._check_posting_date(date, boolean) from authenticated;

-- Kunci search_path
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
