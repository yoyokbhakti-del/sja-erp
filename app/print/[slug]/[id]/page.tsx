"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bySlug, type DocType } from "@/lib/doctypes";
import { number, rupiah, tanggal, terbilang, waktu } from "@/lib/format";
import { FORM_DOCS, FormPrint } from "@/components/print-form";
import { DotMatrixPrint } from "@/components/dotmatrix-print";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Pengaturan per jenis dokumen
// ---------------------------------------------------------------------------
type Cfg = {
  party?: string;                       // judul kotak pihak lawan
  priced: boolean;                      // tampilkan harga & total
  batch: boolean;                       // tampilkan kolom batch / exp
  note?: string;                        // catatan standar di bawah tabel
  signs: string[];
  words?: boolean;                      // tampilkan terbilang
};
const CFG: Record<string, Cfg> = {
  purchase_orders:   { party: "Kepada Yth. Supplier", priced: true, batch: false, words: true,
                       note: "Mohon cantumkan nomor PO ini pada surat jalan dan invoice. Barang yang tidak sesuai spesifikasi atau tanpa CoA dapat ditolak.",
                       signs: ["Dibuat oleh", "Disetujui oleh", "Supplier"] },
  purchase_receipts: { party: "Diterima dari", priced: false, batch: true,
                       note: "Barang telah diterima dan diperiksa jumlahnya. Bahan baku/kemas tetap berstatus karantina sampai dinyatakan lulus QC.",
                       signs: ["Pengirim", "Penerima Gudang", "QC"] },
  purchase_invoices: { party: "Supplier", priced: true, batch: false, words: true, signs: ["Diperiksa", "Disetujui"] },
  sales_orders:      { party: "Pemesan", priced: true, batch: false, words: true,
                       note: "Harga sudah termasuk PPN sesuai tarif yang tercantum. Pengiriman mengikuti ketersediaan stok.",
                       signs: ["Dibuat oleh", "Disetujui oleh", "Customer"] },
  delivery_notes:    { party: "Dikirim kepada", priced: false, batch: true,
                       note: "Barang telah diterima dalam keadaan baik dan jumlah yang benar. Simpan obat hewan sesuai petunjuk pada label.",
                       signs: ["Penerima", "Sopir", "Kepala Gudang"] },
  sales_invoices:    { party: "Ditagihkan kepada", priced: true, batch: false, words: true,
                       note: "Pembayaran dianggap sah setelah dana diterima di rekening perusahaan. Mohon cantumkan nomor invoice pada keterangan transfer.",
                       signs: ["Hormat kami"] },
  stock_entries:     { priced: true, batch: true, signs: ["Dibuat oleh", "Diperiksa", "Disetujui"] },
};

// Ukuran kertas per dokumen. Continuous form 9,5 x 11 inci = 241,3 x 279,4 mm (printer dot-matrix).
type Paper = { name: string; w: number; h: number; mx: number; my: number };
const A4: Paper = { name: "A4 (210 × 297 mm)", w: 210, h: 297, mx: 12, my: 12 };
// Invoice, SJ, Bukti Kas/Bank, BPB, PO memakai format ½ continuous form (components/print-form.tsx)
const paperFor = (_key: string): Paper => A4;

function pageCss(p: Paper) {
  return `
@page { size: ${p.w}mm ${p.h}mm; margin: ${p.my}mm ${p.mx}mm; }
.pf-toolbar, .pf-sheet { width: ${p.w}mm; }
.pf-sheet { min-height: ${p.h}mm; padding: ${p.my + 4}mm ${p.mx + 2}mm; }
@media print { .pf-sheet { width: auto; min-height: ${p.h - 2 * p.my - 2}mm; padding: 0; } }`;
}

function partyEmbed(dt: DocType) {
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

export default function PrintPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const dt = bySlug[slug];
  const [doc, setDoc] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [company, setCompany] = useState<Row | null>(null);
  const [maker, setMaker] = useState<string>("");
  const [printedBy, setPrintedBy] = useState<string>("");
  const [graphic, setGraphic] = useState(false);

  // Dokumen cetak selalu tampil terang
  useEffect(() => { document.documentElement.classList.remove("dark"); }, []);

  useEffect(() => {
    if (!dt) return;
    const sb = supabaseBrowser();
    (async () => {
      let head;
      if (dt.key === "payment_entries") {
        head = await sb.from(dt.key).select("*, cust:customers!customer_id(name,address,city,npwp), supp:suppliers!supplier_id(name,address,city,npwp), af:accounts!paid_from_account_id(code,name), at:accounts!paid_to_account_id(code,name)").eq("id", id).single();
        const ch = await sb.from(dt.child!.table).select("*, si:sales_invoices!sales_invoice_id(name,posting_date,due_date,grand_total), pi:purchase_invoices!purchase_invoice_id(name,posting_date,due_date,grand_total,bill_no)").eq("parent_id", id).order("idx");
        setRows((ch.data as Row[]) ?? []);
      } else if (dt.key === "journal_entries") {
        head = await sb.from(dt.key).select("*").eq("id", id).single();
        const ch = await sb.from(dt.child!.table).select("*, acc:accounts!account_id(code,name), cust:customers!customer_id(name), supp:suppliers!supplier_id(name)").eq("parent_id", id).order("idx");
        setRows((ch.data as Row[]) ?? []);
      } else {
        head = await sb.from(dt.key).select(partyEmbed(dt)).eq("id", id).single();
        const whEmbed = dt.key === "stock_entries" ? ", sw:warehouses!s_warehouse_id(code), tw:warehouses!t_warehouse_id(code)" : "";
        const ch = await sb.from(dt.child!.table).select(`*, item:items!item_id(code,name,brand,stock_uom,reg_number)${whEmbed}`).eq("parent_id", id).order("idx");
        setRows((ch.data as Row[]) ?? []);
      }
      const d = head.data as Row | null;
      setDoc(d);
      if (d?.created_by) {
        const p = await sb.from("profiles").select("full_name").eq("id", d.created_by).maybeSingle();
        setMaker((p.data as Row | null)?.full_name ?? "");
      }
      const me = await sb.auth.getUser();
      setPrintedBy(me.data.user?.email ?? "");
    })();
    sb.from("companies").select("*").order("created_at").limit(1).single().then(({ data }) => setCompany(data as Row));
  }, [dt, id]);

  if (!dt) return <div style={{ padding: 40 }}>Dokumen tidak dikenal</div>;
  if (!doc || !company) return <div style={{ padding: 40, color: "#71717a", fontFamily: "system-ui" }}>Memuat dokumen…</div>;

  if (FORM_DOCS.has(dt.key)) {
    if (!graphic) return <DotMatrixPrint dtKey={dt.key} doc={doc} rows={rows} company={company} onGraphic={() => setGraphic(true)} />;
    return <FormPrint dt={dt} doc={doc} rows={rows} company={company} maker={maker} />;
  }

  const title = typeof dt.printTitle === "function" ? dt.printTitle(doc) : (dt.printTitle ?? dt.label.toUpperCase());
  const date = doc.posting_date ?? doc.transaction_date;
  const watermark = doc.docstatus === 0 ? "DRAFT" : doc.docstatus === 2 ? "DIBATALKAN" : "";
  const addr = [company.address, company.city].filter(Boolean).join(", ");

  return (
    <div className="pf-root">
      <style>{CSS + pageCss(paperFor(dt.key))}</style>

      <div className="pf-toolbar no-print">
        <button className="pf-btn pf-primary" onClick={() => window.print()}><Printer size={15} /> Cetak / Simpan PDF</button>
        <button className="pf-btn" onClick={() => window.close()}><X size={15} /> Tutup</button>
        <span className="pf-hint">Kertas: <b>{paperFor(dt.key).name}</b>. Di jendela cetak pilih ukuran kertas yang sama, Margins: <i>Default</i>, Scale: <i>100</i>, dan matikan &ldquo;Headers and footers&rdquo;.</span>
      </div>

      <div className="pf-sheet">
        {watermark && <div className="pf-watermark">{watermark}</div>}

        {/* ---------- KOP ---------- */}
        <header className="pf-head">
          <div className="pf-brand">
            <div>
              <div className="pf-company">{company.name}</div>
              {addr && <div className="pf-small">{addr}</div>}
              <div className="pf-small">
                {[company.phone && `Telp. ${company.phone}`, company.npwp && `NPWP ${company.npwp}`].filter(Boolean).join("  ·  ")}
              </div>
            </div>
          </div>
          <div className="pf-titlebox">
            <div className="pf-title" style={title.length > 16 ? { fontSize: "11.5pt" } : undefined}>{title}</div>
            <div className="pf-docno">{doc.name}</div>
            {watermark && <div className="pf-chip">{watermark === "DRAFT" ? "Draft – belum sah" : "Dibatalkan"}</div>}
          </div>
        </header>
        <div className="pf-rule" />

        {dt.key === "payment_entries" ? <PaymentBody doc={doc} rows={rows} />
          : dt.key === "journal_entries" ? <JournalBody doc={doc} rows={rows} />
          : <TradeBody dt={dt} doc={doc} rows={rows} date={date} />}

        {/* ---------- TANDA TANGAN ---------- */}
        <section className="pf-signs" style={{ gridTemplateColumns: `repeat(${signsFor(dt, doc).length}, 52mm)` }}>
          {signsFor(dt, doc).map((s, i) => (
            <div key={s} className="pf-sign">
              <div className="pf-sign-label">{s}</div>
              <div className="pf-sign-space" />
              <div className="pf-sign-line">{i === 0 && maker && ["Dibuat oleh", "Hormat kami"].includes(s) ? maker : " "}</div>
              <div className="pf-sign-date">Tgl. ____________</div>
            </div>
          ))}
        </section>

        <footer className="pf-foot">
          <span>Dicetak dari SJA ERP · {waktu(new Date().toISOString())}{printedBy ? ` · ${printedBy}` : ""}</span>
          <span>{doc.name}</span>
        </footer>
      </div>
    </div>
  );
}

function signsFor(dt: DocType, doc: Row) {
  if (dt.key === "payment_entries") return doc.payment_type === "Terima" ? ["Penyetor", "Kasir", "Disetujui"] : ["Penerima", "Kasir", "Disetujui"];
  if (dt.key === "journal_entries") return ["Dibuat oleh", "Diperiksa", "Disetujui"];
  return CFG[dt.key]?.signs ?? ["Dibuat oleh", "Disetujui"];
}

// ---------------------------------------------------------------------------
// Dokumen jual / beli / stok
// ---------------------------------------------------------------------------
function TradeBody({ dt, doc, rows, date }: { dt: DocType; doc: Row; rows: Row[]; date: string }) {
  const cfg = CFG[dt.key] ?? { priced: true, batch: false, signs: [] };
  const p = doc.party as Row | undefined;
  const wh = (k: string) => (doc[`${k}__l`] ? `${doc[`${k}__l`].code} – ${doc[`${k}__l`].name}` : "");
  const isSte = dt.key === "stock_entries";

  const meta: [string, string][] = ([
    ["Tanggal", tanggal(date)],
    ["Jatuh Tempo", tanggal(doc.due_date)],
    ["Tgl. Dibutuhkan", tanggal(doc.schedule_date)],
    ["Tgl. Kirim", tanggal(doc.delivery_date)],
    ["Jenis", doc.purpose && `${doc.purpose}${doc.is_opening ? " (Saldo Awal)" : ""}`],
    ["No. PO Customer", doc.po_no],
    ["Ref. Purchase Order", doc.purchase_order_id__l?.name],
    ["Ref. Penerimaan", doc.purchase_receipt_id__l?.name],
    ["Ref. Sales Order", doc.sales_order_id__l?.name],
    ["Ref. Surat Jalan", doc.delivery_note_id__l?.name],
    ["No. SJ Supplier", doc.supplier_delivery_note],
    ["No. Invoice Supplier", doc.bill_no],
    ["No. Faktur Pajak", doc.faktur_pajak_no],
    ["Gudang", wh("set_warehouse_id")],
    ["Dari Gudang", wh("from_warehouse_id")],
    ["Ke Gudang", wh("to_warehouse_id")],
    ["No. Kendaraan", doc.vehicle_no],
    ["Sopir", doc.driver_name],
  ] as [string, unknown][]).filter(([, v]) => v).map(([k, v]) => [k, String(v)]);

  const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const cols = 3 + (cfg.batch ? 1 : 0) + (isSte ? 1 : 0) + (cfg.priced ? 2 : 0);

  return (
    <>
      <section className="pf-info">
        {p ? (
          <div className="pf-party">
            <div className="pf-label">{cfg.party}</div>
            <div className="pf-party-name">{p.name}</div>
            {p.contact_person && <div>u.p. {p.contact_person}</div>}
            {p.address && <div className="pf-muted">{p.address}</div>}
            {p.city && <div className="pf-muted">{p.city}</div>}
            {(p.phone || p.npwp) && <div className="pf-muted pf-small">{[p.phone && `Telp. ${p.phone}`, p.npwp && `NPWP ${p.npwp}`].filter(Boolean).join(" · ")}</div>}
          </div>
        ) : <div className="pf-party"><div className="pf-label">Keterangan</div><div>{doc.remarks || "—"}</div></div>}
        <table className="pf-meta"><tbody>
          {meta.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
      </section>

      <table className="pf-items">
        <thead>
          <tr>
            <th className="pf-c">No</th>
            <th>Barang</th>
            {isSte && <th>Gudang</th>}
            {cfg.batch && <th>Batch / Kedaluwarsa</th>}
            <th className="pf-r">Qty</th>
            {cfg.priced && <><th className="pf-r">Harga</th><th className="pf-r">Jumlah</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="pf-c pf-muted">{i + 1}</td>
              <td>
                <div className="pf-strong">{r.item?.name}</div>
                <div className="pf-tiny">{r.item?.code}{r.item?.reg_number ? ` · No. Reg. ${r.item.reg_number}` : ""}</div>
              </td>
              {isSte && <td className="pf-small">{[r.sw?.code ?? doc.from_warehouse_id__l?.code, r.tw?.code ?? doc.to_warehouse_id__l?.code].filter(Boolean).join(" → ") || "—"}</td>}
              {cfg.batch && (
                <td className="pf-small">
                  {r.batch_allocation || r.batch_no || "—"}
                  {r.expiry_date && <div className="pf-tiny">Exp. {tanggal(r.expiry_date)}</div>}
                </td>
              )}
              <td className="pf-r pf-nowrap"><span className="pf-strong">{number(r.qty)}</span> <span className="pf-tiny">{r.item?.stock_uom}</span></td>
              {cfg.priced && <>
                <td className="pf-r pf-nowrap">{rupiah(r.rate ?? r.basic_rate)}</td>
                <td className="pf-r pf-nowrap pf-strong">{rupiah(r.amount)}</td>
              </>}
            </tr>
          ))}
        </tbody>
        {!cfg.priced && (
          <tfoot><tr><td colSpan={cols - 1} className="pf-r">Total Qty</td><td className="pf-r pf-strong">{number(totalQty)}</td></tr></tfoot>
        )}
      </table>

      <section className="pf-bottom">
        <div className="pf-notes">
          {cfg.words && cfg.priced && !isSte && (
            <div className="pf-words"><div className="pf-label">Terbilang</div><i>{terbilang(Number(doc.grand_total || 0))}</i></div>
          )}
          {doc.remarks && p && <div><div className="pf-label">Keterangan</div><div>{doc.remarks}</div></div>}
          {cfg.note && <div className="pf-note">{cfg.note}</div>}
        </div>
        {cfg.priced && (
          <div className="pf-totals">
            {isSte ? (
              <div className="pf-grand"><span>Total Nilai</span><span>{rupiah(doc.total_amount)}</span></div>
            ) : (<>
              <div><span>Subtotal</span><span>{rupiah(doc.net_total)}</span></div>
              <div><span>PPN {number(doc.ppn_percent)}%</span><span>{rupiah(doc.tax_amount)}</span></div>
              <div className="pf-grand"><span>Total</span><span>{rupiah(doc.grand_total)}</span></div>
              {dt.key.endsWith("invoices") && Number(doc.outstanding_amount) !== Number(doc.grand_total) && (
                <div><span>Sisa Tagihan</span><span>{rupiah(doc.outstanding_amount)}</span></div>
              )}
            </>)}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bukti kas / bank
// ---------------------------------------------------------------------------
function PaymentBody({ doc, rows }: { doc: Row; rows: Row[] }) {
  const party = doc.cust ?? doc.supp;
  const label = doc.payment_type === "Terima" ? "Telah terima dari" : doc.payment_type === "Bayar" ? "Dibayarkan kepada" : "Transfer internal";
  return (
    <>
      <section className="pf-info">
        <div className="pf-party">
          <div className="pf-label">{label}</div>
          <div className="pf-party-name">{party?.name ?? "—"}</div>
          {party?.address && <div className="pf-muted">{party.address}</div>}
          {party?.city && <div className="pf-muted">{party.city}</div>}
        </div>
        <table className="pf-meta"><tbody>
          <tr><td>Tanggal</td><td>{tanggal(doc.posting_date)}</td></tr>
          <tr><td>Dari akun</td><td>{doc.af?.code} {doc.af?.name}</td></tr>
          <tr><td>Ke akun</td><td>{doc.at?.code} {doc.at?.name}</td></tr>
          {doc.reference_no && <tr><td>No. Referensi</td><td>{doc.reference_no}</td></tr>}
          {doc.reference_date && <tr><td>Tgl. Referensi</td><td>{tanggal(doc.reference_date)}</td></tr>}
        </tbody></table>
      </section>

      <section className="pf-amount">
        <div>
          <div className="pf-label">Jumlah</div>
          <div className="pf-amount-value">{rupiah(doc.paid_amount)}</div>
        </div>
        <div className="pf-amount-words"><div className="pf-label">Terbilang</div><i>{terbilang(Number(doc.paid_amount || 0))}</i></div>
      </section>

      {rows.length > 0 && (
        <table className="pf-items">
          <thead><tr><th className="pf-c">No</th><th>Untuk pembayaran invoice</th><th>Tanggal</th><th>Jatuh Tempo</th><th className="pf-r">Nilai Invoice</th><th className="pf-r">Dibayar</th></tr></thead>
          <tbody>
            {rows.map((r, i) => { const inv = r.si ?? r.pi; return (
              <tr key={r.id}>
                <td className="pf-c pf-muted">{i + 1}</td>
                <td><span className="pf-strong">{inv?.name}</span>{r.pi?.bill_no && <span className="pf-tiny"> · Inv. supplier {r.pi.bill_no}</span>}</td>
                <td>{tanggal(inv?.posting_date)}</td>
                <td>{tanggal(inv?.due_date)}</td>
                <td className="pf-r">{rupiah(inv?.grand_total)}</td>
                <td className="pf-r pf-strong">{rupiah(r.allocated_amount)}</td>
              </tr>); })}
            {Number(doc.unallocated_amount) > 0 && (
              <tr><td /><td colSpan={4}>Uang muka / belum dialokasikan</td><td className="pf-r pf-strong">{rupiah(doc.unallocated_amount)}</td></tr>
            )}
          </tbody>
        </table>
      )}
      {doc.remarks && <div className="pf-note" style={{ marginTop: "4mm" }}><b>Keterangan:</b> {doc.remarks}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bukti jurnal
// ---------------------------------------------------------------------------
function JournalBody({ doc, rows }: { doc: Row; rows: Row[] }) {
  return (
    <>
      <section className="pf-info">
        <div className="pf-party">
          <div className="pf-label">Keterangan</div>
          <div>{doc.remarks || "—"}</div>
        </div>
        <table className="pf-meta"><tbody>
          <tr><td>Tanggal</td><td>{tanggal(doc.posting_date)}</td></tr>
          <tr><td>Jenis</td><td>{doc.voucher_type}</td></tr>
          {doc.cheque_no && <tr><td>No. Bukti / Cek</td><td>{doc.cheque_no}</td></tr>}
        </tbody></table>
      </section>
      <table className="pf-items">
        <thead><tr><th>Kode</th><th>Akun</th><th>Customer / Supplier</th><th>Keterangan</th><th className="pf-r">Debit</th><th className="pf-r">Kredit</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="pf-mono">{r.acc?.code}</td>
              <td className="pf-strong">{r.acc?.name}</td>
              <td>{r.cust?.name ?? r.supp?.name ?? ""}</td>
              <td className="pf-small">{r.user_remark}</td>
              <td className="pf-r">{Number(r.debit) ? rupiah(r.debit) : ""}</td>
              <td className="pf-r">{Number(r.credit) ? rupiah(r.credit) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4} className="pf-r">Total</td><td className="pf-r pf-strong">{rupiah(doc.total_debit)}</td><td className="pf-r pf-strong">{rupiah(doc.total_credit)}</td></tr></tfoot>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
const CSS = `
.pf-root { color: #000; min-height: 100vh; background: #e5e5e5; padding: 18px 0 40px;
  font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.4; }
.pf-toolbar { margin: 0 auto 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pf-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #000; background: #fff; color: #000;
  padding: 6px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; font-family: system-ui, sans-serif; }
.pf-primary { background: #000; color: #fff; }
.pf-hint { font-size: 11.5px; color: #555; font-family: system-ui, sans-serif; }
.pf-sheet { position: relative; margin: 0 auto; background: #fff;
  box-shadow: 0 1px 10px rgba(0,0,0,.15); display: flex; flex-direction: column; overflow: hidden; }
.pf-watermark { position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 90pt; font-weight: 700;
  letter-spacing: .08em; color: transparent; -webkit-text-stroke: 1.5px rgba(0,0,0,.12); pointer-events: none; white-space: nowrap; z-index: 0; }
.pf-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; position: relative; z-index: 1; }
.pf-brand { flex: 1; min-width: 0; }
.pf-company { font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
.pf-titlebox { text-align: right; flex-shrink: 0; white-space: nowrap; }
.pf-title { font-size: 14pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.pf-docno { font-size: 10pt; margin-top: 1mm; }
.pf-chip { display: inline-block; margin-top: 1.5mm; padding: 0 2mm; border: 1px solid #000; font-size: 8pt; font-weight: 700; text-transform: uppercase; }
.pf-rule { border-top: 2px solid #000; border-bottom: 0.5px solid #000; height: 1.2mm; margin: 3mm 0 5mm; }
.pf-info { display: grid; grid-template-columns: 1.1fr 1fr; gap: 8mm; margin-bottom: 5mm; position: relative; z-index: 1; }
.pf-party { }
.pf-party-name { font-size: 10.5pt; font-weight: 700; }
.pf-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin-bottom: .8mm; }
.pf-meta { width: 100%; border-collapse: collapse; align-self: start; }
.pf-meta td { padding: .6mm 0; vertical-align: top; }
.pf-meta td:first-child { width: 40%; padding-right: 2mm; }
.pf-meta td:first-child::after { content: ":"; float: right; }
.pf-meta td:last-child { padding-left: 2mm; }
.pf-items { width: 100%; border-collapse: collapse; position: relative; z-index: 1; }
.pf-items th, .pf-items td { border: 0.6pt solid #000; padding: 1.5mm 2mm; vertical-align: top; text-align: left; }
.pf-items thead th { font-weight: 700; font-size: 8.5pt; text-transform: uppercase; background: none; }
.pf-items tfoot td { font-weight: 700; }
.pf-items tr { break-inside: avoid; }
.pf-r { text-align: right !important; } .pf-c { text-align: center !important; width: 8mm; }
.pf-nowrap { white-space: nowrap; }
.pf-strong { font-weight: 700; } .pf-muted { } .pf-small { font-size: 9pt; } .pf-tiny { font-size: 7.8pt; }
.pf-mono { font-family: "Courier New", monospace; }
.pf-bottom { display: grid; grid-template-columns: 1fr 68mm; gap: 8mm; margin-top: 4mm; break-inside: avoid; position: relative; z-index: 1; }
.pf-notes { display: flex; flex-direction: column; gap: 3mm; font-size: 9pt; }
.pf-words { }
.pf-note { font-size: 8.5pt; }
.pf-totals { align-self: start; border-collapse: collapse; }
.pf-totals > div { display: flex; justify-content: space-between; padding: 1mm 0; }
.pf-grand { border-top: 1px solid #000; border-bottom: 3px double #000; font-weight: 700; font-size: 10.5pt; padding: 1.5mm 0 !important; }
.pf-amount { display: grid; grid-template-columns: auto 1fr; gap: 8mm; align-items: center; border: 1px solid #000; padding: 3mm 5mm; margin-bottom: 5mm; }
.pf-amount-value { font-size: 16pt; font-weight: 700; white-space: nowrap; }
.pf-amount-words { border-left: 1px solid #000; padding-left: 5mm; }
.pf-signs { display: grid; gap: 8mm; justify-content: space-between; margin-top: auto; padding-top: 12mm; break-inside: avoid; }
.pf-signs:has(> .pf-sign:only-child) { justify-content: end; }
.pf-sign { text-align: center; font-size: 9pt; }
.pf-sign-space { height: 20mm; }
.pf-sign-line { border-top: 1px solid #000; padding-top: 1mm; min-height: 5mm; }
.pf-sign-date { font-size: 8pt; margin-top: 1mm; }
.pf-foot { display: flex; justify-content: space-between; margin-top: 6mm; padding-top: 1.5mm; border-top: 0.5px solid #000; font-size: 7.5pt; }
@media print {
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .pf-root { background: #fff; padding: 0; min-height: 0; }
  .pf-sheet { box-shadow: none; margin: 0; }
}
`;
