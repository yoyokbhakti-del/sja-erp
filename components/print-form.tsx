"use client";
// =====================================================================
// Format cetak continuous form (9,5 x 11 inci) mengikuti contoh
// invoice SEKAR JAYA ABADI GROUP: logo + kop, data kiri/kanan, tabel
// bergaris penuh dengan baris tetap, total, terbilang, rekening, TTD.
// Dipakai untuk: Invoice, Surat Jalan, Bukti Kas/Bank, BPB, PO.
// =====================================================================
import { Printer, X } from "lucide-react";
import type { DocType } from "@/lib/doctypes";
import { tanggal, terbilang } from "@/lib/format";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FORM_DOCS = new Set(["sales_invoices", "delivery_notes", "payment_entries", "purchase_receipts", "purchase_orders"]);
export const FORM_PAPER = "continuous form 9,5 × 11 inci (241,3 × 279,4 mm)";
const ROWS_PER_PAGE = 30;

const idn = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const idn2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: unknown) => (v === null || v === undefined || v === "" ? "" : idn.format(Number(v)));
const n2 = (v: unknown) => idn2.format(Number(v || 0));

type Col = { h: React.ReactNode; w?: string; cls?: string; v: (r: Row, i: number) => React.ReactNode };

function chunk<T>(arr: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length ? out : [[]];
}

export function FormPrint({ dt, doc, rows, company, maker }: {
  dt: DocType; doc: Row; rows: Row[]; company: Row; maker: string;
}) {
  const key = dt.key;
  const head = company.print_name || company.name || "";
  const signer = head.replace(/\bgroup\b/i, "").replace(/^(cv|pt)\.?\s*/i, "").trim().toUpperCase();
  const isPay = key === "payment_entries";
  const priced = key === "sales_invoices" || key === "purchase_orders";
  const title =
    key === "sales_invoices" ? "INVOICE" :
    key === "delivery_notes" ? "SURAT JALAN" :
    key === "purchase_orders" ? "PURCHASE ORDER" :
    key === "purchase_receipts" ? "BUKTI PENERIMAAN BARANG" :
    doc.payment_type === "Terima" ? "BUKTI PENERIMAAN KAS/BANK" :
    doc.payment_type === "Bayar" ? "BUKTI PENGELUARAN KAS/BANK" : "BUKTI TRANSFER KAS/BANK";

  // ---------------- kolom tabel ----------------
  const gross = (r: Row) => Number(r.qty || 0) * Number(r.rate || 0);
  const nameCol: Col = { h: "Nama Barang", v: (r) => r.item?.name };
  const qtyCol: Col = { h: "Kuant.", w: "15mm", cls: "r", v: (r) => n0(r.qty) };
  const uomCol: Col = { h: "Sat.", w: "13mm", v: (r) => r.item?.stock_uom };
  const noCol: Col = { h: "No.", w: "8.5mm", cls: "c", v: (_r, i) => i + 1 };
  const cols: Col[] = isPay ? [
    noCol,
    { h: "Untuk Pembayaran", v: (r) => (r.si ?? r.pi)?.name + (r.pi?.bill_no ? ` (Inv. ${r.pi.bill_no})` : "") },
    { h: "Tgl. Invoice", w: "24mm", v: (r) => tanggal((r.si ?? r.pi)?.posting_date) },
    { h: "Jatuh Tempo", w: "24mm", v: (r) => tanggal((r.si ?? r.pi)?.due_date) },
    { h: "Nilai Invoice", w: "32mm", cls: "r", v: (r) => n2((r.si ?? r.pi)?.grand_total) },
    { h: "Dibayar", w: "32mm", cls: "r", v: (r) => n2(r.allocated_amount) },
  ] : priced ? [
    noCol, nameCol, qtyCol, uomCol,
    { h: "Harga", w: "24mm", cls: "r", v: (r) => n0(r.rate) },
    { h: <>Disk<br />(%)</>, w: "10mm", cls: "c", v: (r) => (Number(r.discount_percent) ? n0(r.discount_percent) : "") },
    { h: <>Diskon<br />(Rp)</>, w: "18mm", cls: "r", v: (r) => (Number(r.discount_percent) ? n0(gross(r) - Number(r.amount)) : "") },
    { h: "Jumlah", w: "30mm", cls: "r", v: (r) => n0(r.amount) },
  ] : key === "delivery_notes" ? [
    noCol, nameCol,
    { h: "No. Batch", w: "45mm", v: (r) => r.batch_allocation || r.batch_no },
    qtyCol, uomCol,
  ] : [
    noCol, nameCol,
    { h: "No. Batch", w: "32mm", v: (r) => r.batch_no },
    { h: "Tgl. Prod.", w: "23mm", v: (r) => tanggal(r.mfg_date) },
    { h: "Exp.", w: "23mm", v: (r) => tanggal(r.expiry_date) },
    qtyCol, uomCol,
  ];

  // ---------------- data kiri / kanan ----------------
  const p = (doc.party ?? doc.cust ?? doc.supp) as Row | undefined;
  const termDays = doc.due_date && doc.posting_date
    ? Math.round((new Date(doc.due_date).getTime() - new Date(doc.posting_date).getTime()) / 86400000)
    : p?.payment_terms_days;
  const partyLabel = key === "purchase_orders" || key === "purchase_receipts" ? "Supplier"
    : isPay ? (doc.payment_type === "Bayar" ? "Dibayar kepada" : "Diterima dari") : "Pelanggan";

  const left: [string, React.ReactNode][] = isPay ? [
    [partyLabel, p?.name ?? "-"],
    ["Akun Kas/Bank", doc.payment_type === "Bayar" ? `${doc.af?.code ?? ""} ${doc.af?.name ?? ""}` : `${doc.at?.code ?? ""} ${doc.at?.name ?? ""}`],
    ["Keterangan", doc.remarks],
  ] : priced ? [
    ["Mata Uang", "Rupiah"],
    ["Kredit", `${termDays ?? 0} Hari`],
    [partyLabel, p?.name],
  ] : [
    [partyLabel, p?.name],
  ];

  const so = doc.sales_order_id__l ?? doc.delivery_note_id__l?.sales_order_id__l;
  const wh = (k: string) => doc[`${k}__l`]?.name;
  const right: [string, React.ReactNode][] = ([
    ["Tanggal", tanggal(doc.posting_date ?? doc.transaction_date)],
    ["No.", doc.name],
    ...(key === "sales_invoices" ? [["No. SJ", doc.delivery_note_id__l?.name], ["No. FP", doc.faktur_pajak_no], ["No. PO", so?.po_no]] : []),
    ...(key === "delivery_notes" ? [["No. SO", so?.name], ["No. PO", so?.po_no], ["Kendaraan", doc.vehicle_no], ["Sopir", doc.driver_name]] : []),
    ...(key === "purchase_orders" ? [["Tgl. Butuh", tanggal(doc.schedule_date)], ["Gudang", wh("set_warehouse_id")]] : []),
    ...(key === "purchase_receipts" ? [["No. PO", doc.purchase_order_id__l?.name], ["No. SJ Supp.", doc.supplier_delivery_note], ["Gudang", wh("set_warehouse_id")]] : []),
    ...(isPay ? [["No. Ref.", doc.reference_no], ["Tgl. Ref.", tanggal(doc.reference_date)]] : []),
  ] as [string, React.ReactNode][]);

  // ---------------- tanda tangan ----------------
  const signs: { label: string; name?: string }[] =
    key === "sales_invoices" ? [{ label: signer }] :
    key === "purchase_orders" ? [{ label: "Supplier" }, { label: signer, name: maker }] :
    key === "delivery_notes" ? [{ label: "Penerima" }, { label: "Sopir" }, { label: signer }] :
    key === "purchase_receipts" ? [{ label: "Pengirim" }, { label: "Penerima Gudang" }, { label: "QC" }] :
    [{ label: doc.payment_type === "Bayar" ? "Penerima" : "Penyetor" }, { label: "Kasir" }, { label: signer }];

  const pages = chunk(rows, ROWS_PER_PAGE);
  const qIdx = cols.indexOf(qtyCol);
  const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const subTotal = rows.reduce((s, r) => s + gross(r), 0);
  const discTotal = subTotal - Number(doc.net_total || 0);
  const grand = isPay ? Number(doc.paid_amount || 0) : Number(doc.grand_total || 0);
  const watermark = doc.docstatus === 0 ? "DRAFT" : doc.docstatus === 2 ? "BATAL" : "";
  const addr = [company.address, company.city].filter(Boolean).join(", ");
  const bank = company.bank_account_no ? company : null;

  return (
    <div className="cf-root">
      <style>{CSS}</style>
      <div className="cf-toolbar no-print">
        <button className="cf-btn cf-primary" onClick={() => window.print()}><Printer size={15} /> Cetak</button>
        <button className="cf-btn" onClick={() => window.close()}><X size={15} /> Tutup</button>
        <span className="cf-hint">Kertas: <b>{FORM_PAPER}</b>, melintang. Di jendela cetak pilih ukuran kertas yang sama, Scale 100, matikan &ldquo;Headers and footers&rdquo;.</span>
      </div>

      {pages.map((pageRows, pi) => {
        const last = pi === pages.length - 1;
        const extraRow = isPay && last && Number(doc.unallocated_amount) > 0;
        const filler = Math.max(0, ROWS_PER_PAGE - pageRows.length - (extraRow ? 1 : 0));
        return (
          <div key={pi} className="cf-sheet">
            {watermark && <div className="cf-wm">{watermark}</div>}

            {/* KOP */}
            <div className="cf-top">
              <div className="cf-brand">
                <div>
                  <div className="cf-co">{head.toUpperCase()}</div>
                  {addr && <div className="cf-co-addr">{addr}</div>}
                  {company.phone && <div className="cf-co-addr">{company.phone}</div>}
                </div>
              </div>
              <div className="cf-title">{title}</div>
            </div>

            {/* DATA KIRI / KANAN */}
            <div className="cf-meta">
              <table className="cf-kv">
                <tbody>
                  {left.map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td>:</td><td className={k === partyLabel ? "b" : ""}>{v}</td></tr>
                  ))}
                  {!isPay && p?.address && <tr><td /><td /><td className="small">{[p.address, p.city].filter(Boolean).join(", ")}</td></tr>}
                  {!isPay && <tr><td /><td /><td className="small">NPWP : {p?.npwp ?? ""}</td></tr>}
                </tbody>
              </table>
              <table className="cf-kv">
                <tbody>
                  {right.map(([k, v]) => <tr key={k}><td>{k}</td><td>:</td><td>{v}</td></tr>)}
                  <tr><td>Lembar</td><td>:</td><td>{pi + 1} / {pages.length}</td></tr>
                </tbody>
              </table>
            </div>

            {/* TABEL */}
            <table className="cf-items">
              <colgroup>{cols.map((c, i) => <col key={i} style={c.w ? { width: c.w } : undefined} />)}</colgroup>
              <thead><tr>{cols.map((c, i) => <th key={i} className={c.cls}>{c.h}</th>)}</tr></thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r.id}>{cols.map((c, j) => <td key={j} className={c.cls}>{c.v(r, pi * ROWS_PER_PAGE + i)}</td>)}</tr>
                ))}
                {extraRow && (
                  <tr><td /><td colSpan={cols.length - 2}>Uang muka / belum dialokasikan</td><td className="r">{n2(doc.unallocated_amount)}</td></tr>
                )}
                {Array.from({ length: filler }).map((_, i) => (
                  <tr key={`f${i}`}>{cols.map((c, j) => <td key={j}>&nbsp;</td>)}</tr>
                ))}
              </tbody>
              {isPay && last && (
                <tfoot><tr><td colSpan={cols.length - 1} className="r b">Total Rp</td><td className="r b">{n2(doc.paid_amount)}</td></tr></tfoot>
              )}
              {!isPay && last && (
                <tfoot>
                  <tr className="cf-qtyrow">
                    <td colSpan={qIdx} className="r b cf-nob">Total Kuantitas</td>
                    <td className="r b">{n0(totalQty)}</td>
                    {cols.length - qIdx - 1 > 0 && <td colSpan={cols.length - qIdx - 1} className="cf-nob" />}
                  </tr>
                </tfoot>
              )}
            </table>

            {/* BAWAH */}
            {!last ? (
              <div className="cf-cont">Bersambung ke lembar {pi + 2} …</div>
            ) : (
              <div className="cf-bottom">
                <div className="cf-left">
                  {(priced || isPay) && (
                    <div className="cf-words"><span className="b">Terbilang :</span> <i>{grand ? terbilang(grand) : ""}</i></div>
                  )}
                  {key === "sales_invoices" && bank && (
                    <div className="cf-bank">
                      <div>Pembayaran dapat ditransfer ke rekening :</div>
                      <div className="b">{head.toUpperCase()}</div>
                      <div className="b">{[company.bank_name, company.bank_account_name].filter(Boolean).join(". ")}</div>
                      <div className="b">{company.bank_account_no}</div>
                    </div>
                  )}
                  {key === "delivery_notes" && <div className="cf-note">Barang telah diterima dalam keadaan baik dan jumlah yang benar.</div>}
                  {key === "purchase_receipts" && <div className="cf-note">Bahan baku/kemas berstatus karantina sampai dinyatakan lulus QC.</div>}
                  {key === "purchase_orders" && <div className="cf-note">Cantumkan No. PO pada surat jalan &amp; invoice. Sertakan CoA untuk bahan baku.</div>}
                  {doc.remarks && !isPay && <div className="cf-note">Ket.: {doc.remarks}</div>}
                </div>

                <div className="cf-signs">
                  {signs.map((s, i) => (
                    <div key={i} className="cf-sign">
                      <div className="b">{s.label}</div>
                      <div className="cf-sign-name"><span>(</span><span>{s.name ?? ""}</span><span>)</span></div>
                    </div>
                  ))}
                </div>

                {priced && (
                  <table className="cf-tot">
                    <tbody>
                      {priced ? <>
                        <tr><td>Sub Total</td><td>Rp</td><td className="cf-box r">{n2(subTotal)}</td></tr>
                        <tr><td>Diskon</td><td>Rp</td><td className="cf-box r">{n2(discTotal)}</td></tr>
                        <tr><td>PPN {n0(doc.ppn_percent)}%</td><td>Rp</td><td className="cf-box r">{n2(doc.tax_amount)}</td></tr>
                        <tr><td>Total</td><td>Rp</td><td className="cf-box r b">{n2(doc.grand_total)}</td></tr>
                      </> : null}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CSS = `
@page { size: 241.3mm 279.4mm; margin: 4mm 12mm; }
.cf-root { background: #e5e5e5; min-height: 100vh; padding: 16px 0 40px; color: #000;
  font-family: Tahoma, Verdana, sans-serif; font-size: 8.4pt; line-height: 1.25; }
.cf-toolbar { width: 241.3mm; margin: 0 auto 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-family: system-ui, sans-serif; }
.cf-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #000; background: #fff; color: #000; padding: 6px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.cf-primary { background: #000; color: #fff; }
.cf-hint { font-size: 11.5px; color: #444; }
.cf-sheet { position: relative; width: 241.3mm; height: 279.4mm; margin: 0 auto 12px; background: #fff; padding: 4mm 12mm;
  box-shadow: 0 1px 8px rgba(0,0,0,.15); display: flex; flex-direction: column; overflow: hidden; break-after: page; }
.cf-sheet:last-child { break-after: auto; }
.cf-wm { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-18deg); font-size: 72pt; font-weight: 700;
  color: transparent; -webkit-text-stroke: 1.2px rgba(0,0,0,.13); letter-spacing: .1em; pointer-events: none; }
.b { font-weight: 700; } .r { text-align: right; } .c { text-align: center; } .small { font-size: 7.8pt; }
.cf-top { display: flex; justify-content: space-between; align-items: flex-start; }
.cf-brand { display: flex; gap: 3mm; align-items: flex-start; max-width: 140mm; }
.cf-co { font-weight: 700; font-size: 9pt; }
.cf-co-addr { font-weight: 700; font-size: 8.4pt; }
.cf-title { font-weight: 700; font-size: 10.5pt; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.cf-meta { display: grid; grid-template-columns: 1fr 64mm; gap: 6mm; margin: 1mm 0 2mm; }
.cf-kv { border-collapse: collapse; align-self: end; }
.cf-kv td { padding: .25mm 0; vertical-align: top; }
.cf-kv td:first-child { width: 21mm; white-space: nowrap; }
.cf-kv td:nth-child(2) { width: 3mm; text-align: center; }
.cf-items { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cf-items th, .cf-items td { border: 0.7pt solid #000; padding: 0 1.2mm; height: 4.6mm; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cf-items tfoot td { height: 5mm; }
.cf-items td.cf-nob { border: none; padding-right: 2mm; }
.cf-qtyrow td { border-top: none; }
.cf-items th { font-weight: 700; height: 7mm; line-height: 1.1; white-space: normal; text-overflow: clip; text-align: left; padding: 0 .8mm; }
.cf-items th.r, .cf-items td.r { text-align: right; } .cf-items th.c, .cf-items td.c { text-align: center; }
.cf-cont { margin-top: auto; text-align: right; font-style: italic; }
.cf-bottom { display: grid; grid-template-columns: 1fr auto max-content; gap: 4mm; margin-top: 1.5mm; flex: 1; }
.cf-left { display: flex; flex-direction: column; gap: 1.6mm; min-width: 62mm; }
.cf-qty { display: flex; justify-content: flex-end; align-items: center; gap: 2mm; }
.cf-box { border: 0.7pt solid #000; padding: .3mm 1.2mm; min-width: 15mm; display: inline-block; }
.cf-words { }
.cf-bank { margin-top: .5mm; }
.cf-note { font-size: 7.6pt; }
.cf-signs { display: flex; gap: 6mm; align-items: flex-start; }
.cf-sign { text-align: center; width: 34mm; }
.cf-sign-name { margin-top: 13mm; display: flex; justify-content: space-between; white-space: nowrap; }
.cf-tot { border-collapse: collapse; align-self: start; }
.cf-tot td { padding: .25mm 0; }
.cf-tot td:first-child { font-weight: 700; text-align: right; padding-right: 2mm; white-space: nowrap; }
.cf-tot td:nth-child(2) { padding-right: 1.5mm; }
.cf-tot .cf-box { display: block; width: 33mm; border-width: 0.7pt; }
.cf-tot tr + tr .cf-box { border-top: none; }
@media print {
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .cf-root { background: #fff; padding: 0; min-height: 0; }
  .cf-sheet { box-shadow: none; margin: 0; width: auto; height: 131.4mm; padding: 0; }
}
`;
