-- 0013 Melengkapi Retur Penjualan/Pembelian (tabel & fungsi dasar dari 0011a_returns_prices):
-- hubungkan ke Submit/Cancel, jurnal otomatis, blok pembatalan invoice yang sudah diretur, izin role.
do $$
declare src text;
begin
  -- _child_of
  src := pg_get_functiondef('public._child_of(text)'::regprocedure);
  if position('sales_returns' in src) = 0 then
    src := replace(src, E'    when ''journal_entries''   then ''journal_entry_accounts''\n',
      E'    when ''journal_entries''   then ''journal_entry_accounts''\n    when ''sales_returns''     then ''sales_return_items''\n    when ''purchase_returns''  then ''purchase_return_items''\n');
    if position('sales_return_items' in src) = 0 then raise exception '_child_of tidak cocok'; end if;
    execute src;
  end if;

  -- submit_doc
  src := pg_get_functiondef('public.submit_doc(text,uuid)'::regprocedure);
  if position('_submit_sales_return' in src) = 0 then
    src := replace(src, E'    when ''journal_entries''   then perform public._submit_journal_entry(p_id);\n',
      E'    when ''journal_entries''   then perform public._submit_journal_entry(p_id);\n    when ''sales_returns''     then perform public._submit_sales_return(p_id);\n    when ''purchase_returns''  then perform public._submit_purchase_return(p_id);\n');
    if position('_submit_sales_return' in src) = 0 then raise exception 'submit_doc tidak cocok'; end if;
    execute src;
  end if;

  -- cancel_doc
  src := pg_get_functiondef('public.cancel_doc(text,uuid)'::regprocedure);
  if position('sales_returns' in src) = 0 then
    src := replace(src, E'  if v_dep is not null then',
      E'  if v_dep is null and p_doctype = ''sales_invoices'' then\n    v_dep := (select string_agg(name, '', '') from public.sales_returns where sales_invoice_id = p_id and docstatus = 1);\n  elsif v_dep is null and p_doctype = ''purchase_invoices'' then\n    v_dep := (select string_agg(name, '', '') from public.purchase_returns where purchase_invoice_id = p_id and docstatus = 1);\n  end if;\n  if v_dep is not null then');
    src := replace(src, E'''delivery_notes'',''stock_reconciliations'',''work_orders'')', E'''delivery_notes'',''stock_reconciliations'',''work_orders'',''sales_returns'',''purchase_returns'')');
    src := replace(src, E'  elsif p_doctype = ''payment_entries'' then\n    perform public._cancel_payment_entry(p_id);',
      E'  elsif p_doctype in (''sales_returns'',''purchase_returns'') then\n    perform public._cancel_return(p_doctype, p_id);\n  elsif p_doctype = ''payment_entries'' then\n    perform public._cancel_payment_entry(p_id);');
    if position('_cancel_return' in src) = 0 or position('''sales_returns'',''purchase_returns'')' in src) = 0 then raise exception 'cancel_doc tidak cocok'; end if;
    execute src;
  end if;

  -- _post_gl
  src := pg_get_functiondef('public._post_gl(text,uuid)'::regprocedure);
  if position('sales_returns' in src) = 0 then
    src := replace(src, E'  elsif p_doctype = ''journal_entries'' then',
$g$  elsif p_doctype = 'sales_returns' then
    perform public._gl(coalesce((select id from public.accounts where code = '4102' and not is_group and not disabled),
                                public._acc('Pendapatan')),
                       (d->>'net_total')::numeric, 0, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('PPN Keluaran'), (d->>'tax_amount')::numeric, 0, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('Piutang'), 0, (d->>'grand_total')::numeric, v_date, p_doctype, p_id, v_no,
                       'Customer', (d->>'customer_id')::uuid, 'sales_invoices', (d->>'sales_invoice_id')::uuid);
    select coalesce(sum(stock_value_difference), 0) into v from public.stock_ledger
     where voucher_type = p_doctype and voucher_id = p_id;
    perform public._gl(public._acc('Persediaan'), v, 0, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('HPP'), 0, v, v_date, p_doctype, p_id, v_no);

  elsif p_doctype = 'purchase_returns' then
    select -coalesce(sum(stock_value_difference), 0) into v from public.stock_ledger
     where voucher_type = p_doctype and voucher_id = p_id;
    perform public._gl(public._acc('Hutang'), (d->>'grand_total')::numeric, 0, v_date, p_doctype, p_id, v_no,
                       'Supplier', (d->>'supplier_id')::uuid, 'purchase_invoices', (d->>'purchase_invoice_id')::uuid);
    perform public._gl(public._acc('PPN Masukan'), 0, (d->>'tax_amount')::numeric, v_date, p_doctype, p_id, v_no);
    perform public._gl(public._acc('Persediaan'), 0, v, v_date, p_doctype, p_id, v_no);
    -- sisa nilai: selisih terhadap harga rata-rata -> penyesuaian; tanpa barang keluar -> balik ke akun barang diterima belum ditagih
    perform public._gl(case when (d->>'update_stock')::boolean then public._acc('Penyesuaian Persediaan')
                            else public._acc('Barang Diterima Belum Ditagih') end,
                       0, (d->>'net_total')::numeric - v, v_date, p_doctype, p_id, v_no);

  elsif p_doctype = 'journal_entries' then$g$);
    if position('purchase_returns' in src) = 0 then raise exception '_post_gl tidak cocok'; end if;
    execute src;
  end if;
end $$;

insert into public.permissions (role_id, doctype, can_read, can_write, can_submit, can_cancel) values
  ('gudang', 'sales_returns', true, false, false, false),
  ('gudang', 'purchase_returns', true, false, false, false),
  ('penjualan', 'sales_returns', true, true, true, false),
  ('pembelian', 'purchase_returns', true, true, true, false),
  ('keuangan', 'sales_returns', true, true, true, true),
  ('keuangan', 'purchase_returns', true, true, true, true)
on conflict (role_id, doctype) do nothing;
