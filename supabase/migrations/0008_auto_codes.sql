-- =====================================================================
-- 0008 KODE MASTER OTOMATIS
--   Item     : awalan menurut jenis -> RM-0001 (Bahan Baku), PM- (Bahan Kemas),
--              FG- (Produk Jadi), TG- (Barang Dagang), SV- (Jasa), OT- (Lainnya)
--   Supplier : SUP-0001     Customer : CUS-0001     Gudang : WH-001
-- Kode dibuat saat data pertama kali disimpan dan tidak bisa diubah.
-- Kode lama yang sudah ada tetap dipakai. (NOT NULL tetap berlaku: dicek setelah trigger mengisi kode.)
-- =====================================================================

create or replace function public.next_code(p_prefix text, p_digits int, p_table text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; v_code text; v_exists boolean;
begin
  loop
    insert into public.naming_series (key, current) values ('CODE:' || p_prefix, 1)
    on conflict (key) do update set current = naming_series.current + 1
    returning current into v_n;
    v_code := p_prefix || '-' || lpad(v_n::text, p_digits, '0');
    execute format('select exists (select 1 from public.%I where code = $1)', p_table) into v_exists using v_code;
    exit when not v_exists;   -- lewati nomor yang kebetulan sudah dipakai
  end loop;
  return v_code;
end $$;
revoke execute on function public.next_code(text, int, text) from public, anon, authenticated;

create or replace function public.set_master_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_digits int := 4;
begin
  if tg_op = 'UPDATE' then
    new.code := old.code;          -- kode tidak bisa diubah
    return new;
  end if;
  if coalesce(trim(new.code), '') <> '' then return new; end if;   -- impor data lama boleh membawa kode sendiri
  v_prefix := case tg_table_name
    when 'suppliers'  then 'SUP'
    when 'customers'  then 'CUS'
    when 'warehouses' then 'WH'
    when 'items' then case to_jsonb(new)->>'item_type'
        when 'Bahan Baku'    then 'RM'
        when 'Bahan Kemas'   then 'PM'
        when 'Produk Jadi'   then 'FG'
        when 'Barang Dagang' then 'TG'
        when 'Jasa'          then 'SV'
        else 'OT' end
  end;
  if tg_table_name = 'warehouses' then v_digits := 3; end if;
  new.code := public.next_code(v_prefix, v_digits, tg_table_name);
  return new;
end $$;
revoke execute on function public.set_master_code() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['items','suppliers','customers','warehouses'] loop
    execute format('create trigger %I before insert or update of code on public.%I for each row execute function public.set_master_code()',
                   t || '_code', t);
  end loop;
end $$;
