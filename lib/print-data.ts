// Pengambilan data dokumen untuk cetak (dipakai halaman cetak & pratinjau Desain Cetakan)
import type { DocType } from "@/lib/doctypes";
import type { supabaseBrowser } from "@/lib/supabase/client";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Sb = ReturnType<typeof supabaseBrowser>;

export function partyEmbed(dt: DocType) {
  const parts: string[] = [];
  const has = (n: string) => dt.fields.some((f) => f.name === n);
  if (has("supplier_id")) parts.push("party:suppliers!supplier_id(code,name,address,city,npwp,phone,contact_person,payment_terms_days)");
  if (has("customer_id")) parts.push("party:customers!customer_id(code,name,address,city,npwp,phone,contact_person,payment_terms_days)");
  for (const [col, tbl] of [["purchase_order_id", "purchase_orders"], ["purchase_receipt_id", "purchase_receipts"],
                            ["sales_order_id", "sales_orders"], ["delivery_note_id", "delivery_notes"]]) {
    if (!has(col)) continue;
    if (col === "sales_order_id") parts.push(`${col}__l:${tbl}!${col}(name,po_no)`);
    else if (col === "delivery_note_id") parts.push(`${col}__l:${tbl}!${col}(name,sales_order_id__l:sales_orders!sales_order_id(name,po_no))`);
    else parts.push(`${col}__l:${tbl}!${col}(name)`);
  }
  for (const col of ["set_warehouse_id", "from_warehouse_id", "to_warehouse_id"]) {
    if (has(col)) parts.push(`${col}__l:warehouses!${col}(code,name)`);
  }
  return parts.length ? "*," + parts.join(",") : "*";
}

export async function loadPrintData(sb: Sb, dt: DocType, id: string) {
  let head;
  let rows: Row[] = [];
  if (dt.key === "payment_entries") {
    head = await sb.from(dt.key).select("*, cust:customers!customer_id(name,address,city,npwp), supp:suppliers!supplier_id(name,address,city,npwp), af:accounts!paid_from_account_id(code,name), at:accounts!paid_to_account_id(code,name)").eq("id", id).single();
    const ch = await sb.from(dt.child!.table).select("*, si:sales_invoices!sales_invoice_id(name,posting_date,due_date,grand_total), pi:purchase_invoices!purchase_invoice_id(name,posting_date,due_date,grand_total,bill_no)").eq("parent_id", id).order("idx");
    rows = (ch.data as Row[]) ?? [];
  } else if (dt.key === "journal_entries") {
    head = await sb.from(dt.key).select("*").eq("id", id).single();
    const ch = await sb.from(dt.child!.table).select("*, acc:accounts!account_id(code,name), cust:customers!customer_id(name), supp:suppliers!supplier_id(name)").eq("parent_id", id).order("idx");
    rows = (ch.data as Row[]) ?? [];
  } else {
    head = await sb.from(dt.key).select(partyEmbed(dt)).eq("id", id).single();
    const whEmbed = dt.key === "stock_entries" ? ", sw:warehouses!s_warehouse_id(code), tw:warehouses!t_warehouse_id(code)" : "";
    const ch = await sb.from(dt.child!.table).select(`*, item:items!item_id(code,name,brand,stock_uom,reg_number)${whEmbed}`).eq("parent_id", id).order("idx");
    rows = (ch.data as Row[]) ?? [];
  }
  const doc = (head.data as Row | null) ?? null;
  let maker = "";
  if (doc?.created_by) {
    const p = await sb.from("profiles").select("full_name").eq("id", doc.created_by).maybeSingle();
    maker = (p.data as Row | null)?.full_name ?? "";
  }
  const me = await sb.auth.getUser();
  return { doc, rows, maker, printedBy: me.data.user?.email ?? "" };
}
