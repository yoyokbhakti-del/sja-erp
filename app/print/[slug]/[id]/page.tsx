"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bySlug } from "@/lib/doctypes";
import { number, rupiah, tanggal, terbilang } from "@/lib/format";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function PrintPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const dt = bySlug[slug];
  const [doc, setDoc] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [company, setCompany] = useState<Row | null>(null);

  // Dokumen cetak selalu tampil terang
  useEffect(() => { document.documentElement.classList.remove("dark"); }, []);

  useEffect(() => {
    if (!dt) return;
    const sb = supabaseBrowser();
    if (dt.key === "payment_entries") {
      sb.from(dt.key).select("*, cust:customers!customer_id(name,address,city), supp:suppliers!supplier_id(name,address,city), af:accounts!paid_from_account_id(code,name), at:accounts!paid_to_account_id(code,name)")
        .eq("id", id).single().then(({ data }) => setDoc(data as Row));
      sb.from(dt.child!.table).select("*, si:sales_invoices!sales_invoice_id(name,posting_date,grand_total), pi:purchase_invoices!purchase_invoice_id(name,posting_date,grand_total,bill_no)")
        .eq("parent_id", id).order("idx").then(({ data }) => setRows((data as Row[]) ?? []));
    } else if (dt.key === "journal_entries") {
      sb.from(dt.key).select("*").eq("id", id).single().then(({ data }) => setDoc(data as Row));
      sb.from(dt.child!.table).select("*, acc:accounts!account_id(code,name), cust:customers!customer_id(name), supp:suppliers!supplier_id(name)")
        .eq("parent_id", id).order("idx").then(({ data }) => setRows((data as Row[]) ?? []));
    } else {
      const party = dt.fields.find((f) => f.name === "supplier_id" || f.name === "customer_id");
      const partyEmbed = party ? `,party:${party.link}!${party.name}(code,name,address,city,npwp,phone)` : "";
      sb.from(dt.key).select(`*${partyEmbed}`).eq("id", id).single().then(({ data }) => setDoc(data as Row));
      sb.from(dt.child!.table).select("*, item:items!item_id(code,name,stock_uom,reg_number)").eq("parent_id", id).order("idx")
        .then(({ data }) => setRows((data as Row[]) ?? []));
    }
    sb.from("companies").select("*").order("created_at").limit(1).single().then(({ data }) => setCompany(data as Row));
  }, [dt, id]);

  if (!dt || !doc) return <div className="p-10 text-sm text-zinc-400">Memuat…</div>;
  const date = doc.posting_date ?? doc.transaction_date;
  const priced = dt.key !== "stock_entries" && dt.key !== "delivery_notes";
  const isSale = !!doc.customer_id;
  const title = typeof dt.printTitle === "function" ? dt.printTitle(doc) : dt.printTitle;
  const signatures = (labels: string[]) => (
    <div className="mt-12 grid grid-cols-3 gap-6 text-center">
      {labels.map((s) => (
        <div key={s}><div>{s}</div><div className="mt-16 border-t border-black pt-1">(.................................)</div></div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-10 text-[12px] leading-snug text-black print:p-0">
      <div className="no-print mb-6 flex gap-2">
        <button onClick={() => window.print()} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">Cetak</button>
        <button onClick={() => window.close()} className="rounded bg-zinc-100 px-3 py-1.5 text-sm">Tutup</button>
      </div>
      {doc.docstatus !== 1 && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-center font-semibold text-red-700">
          {doc.docstatus === 0 ? "DRAFT — BELUM SAH" : "DIBATALKAN"}
        </div>
      )}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-base font-bold">{company?.name}</div>
          <div>{[company?.address, company?.city].filter(Boolean).join(", ")}</div>
          {company?.phone && <div>Telp. {company.phone}</div>}
          {company?.npwp && <div>NPWP: {company.npwp}</div>}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{title}</div>
          <div className="font-mono">{doc.name}</div>
          <div>Tanggal: {tanggal(date)}</div>
          {doc.due_date && <div>Jatuh Tempo: {tanggal(doc.due_date)}</div>}
        </div>
      </div>

      {dt.key === "payment_entries" ? (
        <div className="mt-4 space-y-3">
          <table className="w-full"><tbody>
            {doc.payment_type !== "Transfer Internal" && (
              <tr><td className="w-48 py-1">{doc.payment_type === "Terima" ? "Telah terima dari" : "Dibayarkan kepada"}</td>
                <td className="font-semibold">: {doc.cust?.name ?? doc.supp?.name}</td></tr>
            )}
            <tr><td className="py-1">Uang sejumlah</td><td className="font-semibold">: {rupiah(doc.paid_amount)}</td></tr>
            <tr><td className="py-1">Terbilang</td><td className="italic">: {terbilang(Number(doc.paid_amount))}</td></tr>
            <tr><td className="py-1">Dari akun</td><td>: {doc.af?.code} {doc.af?.name}</td></tr>
            <tr><td className="py-1">Ke akun</td><td>: {doc.at?.code} {doc.at?.name}</td></tr>
            {doc.reference_no && <tr><td className="py-1">No. Referensi</td><td>: {doc.reference_no} {doc.reference_date ? `(${tanggal(doc.reference_date)})` : ""}</td></tr>}
            {doc.remarks && <tr><td className="py-1">Keterangan</td><td>: {doc.remarks}</td></tr>}
          </tbody></table>
          {rows.length > 0 && (
            <table className="w-full border-collapse">
              <thead><tr className="border-y border-black text-left"><th className="py-1">Untuk Pembayaran Invoice</th><th>Tanggal</th><th className="text-right">Nilai Invoice</th><th className="text-right">Dibayar</th></tr></thead>
              <tbody>{rows.map((r) => { const inv = r.si ?? r.pi; return (
                <tr key={r.id} className="border-b border-zinc-300"><td className="py-1">{inv?.name}{r.pi?.bill_no ? ` (${r.pi.bill_no})` : ""}</td><td>{tanggal(inv?.posting_date)}</td>
                  <td className="text-right">{rupiah(inv?.grand_total)}</td><td className="text-right">{rupiah(r.allocated_amount)}</td></tr>); })}
                {Number(doc.unallocated_amount) > 0 && <tr><td className="py-1" colSpan={3}>Uang muka / belum dialokasikan</td><td className="text-right">{rupiah(doc.unallocated_amount)}</td></tr>}
              </tbody>
            </table>
          )}
          {signatures(doc.payment_type === "Terima" ? ["Penyetor", "Kasir", "Disetujui"] : ["Penerima", "Kasir", "Disetujui"])}
        </div>
      ) : dt.key === "journal_entries" ? (
        <div className="mt-4">
          <div className="mb-2">Jenis: {doc.voucher_type}{doc.cheque_no ? ` — No. Bukti: ${doc.cheque_no}` : ""}</div>
          <table className="w-full border-collapse">
            <thead><tr className="border-y border-black text-left"><th className="py-1">Kode</th><th>Akun</th><th>Customer/Supplier</th><th>Keterangan</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-300"><td className="py-1 font-mono">{r.acc?.code}</td><td>{r.acc?.name}</td>
                <td>{r.cust?.name ?? r.supp?.name ?? ""}</td><td>{r.user_remark}</td>
                <td className="text-right">{Number(r.debit) ? rupiah(r.debit) : ""}</td><td className="text-right">{Number(r.credit) ? rupiah(r.credit) : ""}</td></tr>
            ))}
              <tr className="font-bold"><td colSpan={4} className="py-1 text-right">Total</td><td className="text-right">{rupiah(doc.total_debit)}</td><td className="text-right">{rupiah(doc.total_credit)}</td></tr>
            </tbody>
          </table>
          {doc.remarks && <div className="mt-3"><b>Keterangan:</b> {doc.remarks}</div>}
          {signatures(["Dibuat", "Diperiksa", "Disetujui"])}
        </div>
      ) : (<>
      <div className="mt-3 grid grid-cols-2 gap-6">
        {doc.party && (
          <div>
            <div className="text-[10px] uppercase text-zinc-500">{isSale ? "Kepada" : "Supplier"}</div>
            <div className="font-semibold">{doc.party.name}</div>
            <div>{doc.party.address}</div>
            <div>{doc.party.city}</div>
            {doc.party.npwp && <div>NPWP: {doc.party.npwp}</div>}
          </div>
        )}
        <div className="space-y-0.5">
          {doc.purpose && <div>Tujuan: {doc.purpose}</div>}
          {doc.po_no && <div>No. PO Customer: {doc.po_no}</div>}
          {doc.supplier_delivery_note && <div>No. SJ Supplier: {doc.supplier_delivery_note}</div>}
          {doc.bill_no && <div>No. Invoice Supplier: {doc.bill_no}</div>}
          {doc.faktur_pajak_no && <div>No. Faktur Pajak: {doc.faktur_pajak_no}</div>}
          {doc.vehicle_no && <div>No. Kendaraan: {doc.vehicle_no}</div>}
          {doc.driver_name && <div>Sopir: {doc.driver_name}</div>}
          {doc.schedule_date && <div>Tgl. Dibutuhkan: {tanggal(doc.schedule_date)}</div>}
          {doc.delivery_date && <div>Tgl. Kirim: {tanggal(doc.delivery_date)}</div>}
        </div>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1 pr-2">No</th><th className="pr-2">Kode</th><th className="pr-2">Nama Barang</th>
            <th className="pr-2">Batch / Exp.</th>
            <th className="pr-2 text-right">Qty</th><th className="pr-2">Sat.</th>
            {priced && <><th className="pr-2 text-right">Harga</th><th className="text-right">Jumlah</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-zinc-300 align-top">
              <td className="py-1 pr-2">{i + 1}</td>
              <td className="pr-2 font-mono">{r.item?.code}</td>
              <td className="pr-2">{r.item?.name}{r.item?.reg_number ? <div className="text-[10px] text-zinc-500">Reg. {r.item.reg_number}</div> : null}</td>
              <td className="pr-2">{r.batch_allocation ?? r.batch_no ?? ""}{r.expiry_date ? ` / ${tanggal(r.expiry_date)}` : ""}</td>
              <td className="pr-2 text-right">{number(r.qty)}</td>
              <td className="pr-2">{r.item?.stock_uom}</td>
              {priced && <><td className="pr-2 text-right">{rupiah(r.rate)}</td><td className="text-right">{rupiah(r.amount)}</td></>}
            </tr>
          ))}
        </tbody>
      </table>

      {priced && (
        <div className="mt-2 ml-auto w-72 space-y-0.5">
          <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(doc.net_total)}</span></div>
          <div className="flex justify-between"><span>PPN {number(doc.ppn_percent)}%</span><span>{rupiah(doc.tax_amount)}</span></div>
          <div className="flex justify-between border-t border-black pt-1 font-bold"><span>Total</span><span>{rupiah(doc.grand_total)}</span></div>
        </div>
      )}
      {doc.remarks && <div className="mt-4"><b>Keterangan:</b> {doc.remarks}</div>}

      <div className="mt-12 grid grid-cols-3 gap-6 text-center">
        {(dt.key === "delivery_notes" ? ["Penerima", "Sopir", "Kepala Gudang"]
          : dt.key === "purchase_receipts" ? ["Pengirim", "Penerima Gudang", "QC"]
          : dt.key === "stock_entries" ? ["Dibuat", "Diperiksa", "Disetujui"]
          : ["Dibuat", "Diperiksa", "Disetujui"]).map((s) => (
          <div key={s}><div>{s}</div><div className="mt-16 border-t border-black pt-1">(.................................)</div></div>
        ))}
      </div>
      </>)}
    </div>
  );
}
