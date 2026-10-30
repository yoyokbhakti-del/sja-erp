"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bySlug, type DocType } from "@/lib/doctypes";
import { number, rupiah, tanggal, terbilang, waktu } from "@/lib/format";

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

function partyEmbed(dt: DocType) {
  const parts: string[] = [];
  const has = (n: string) => dt.fields.some((f) => f.name === n);
  if (has("supplier_id")) parts.push("party:suppliers!supplier_id(code,name,address,city,npwp,phone,contact_person)");
  if (has("customer_id")) parts.push("party:customers!customer_id(code,name,address,city,npwp,phone,contact_person)");
  for (const [col, tbl] of [["purchase_order_id", "purchase_orders"], ["purchase_receipt_id", "purchase_receipts"],
                            ["sales_order_id", "sales_orders"], ["delivery_note_id", "delivery_notes"]]) {
    if (has(col)) parts.push(`${col}__l:${tbl}!${col}(name)`);
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
        const ch = await sb.from(dt.child!.table).select(`*, item:items!item_id(code,name,stock_uom,reg_number)${whEmbed}`).eq("parent_id", id).order("idx");
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

  const title = typeof dt.printTitle === "function" ? dt.printTitle(doc) : (dt.printTitle ?? dt.label.toUpperCase());
  const date = doc.posting_date ?? doc.transaction_date;
  const watermark = doc.docstatus === 0 ? "DRAFT" : doc.docstatus === 2 ? "DIBATALKAN" : "";
  const initials = (company.abbr || company.name || "").replace(/^(CV|PT)\.?\s*/i, "").slice(0, 3).toUpperCase();
  const addr = [company.address, company.city].filter(Boolean).join(", ");

  return (
    <div className="pf-root">
      <style>{CSS}</style>

      <div className="pf-toolbar no-print">
        <button className="pf-btn pf-primary" onClick={() => window.print()}><Printer size={15} /> Cetak / Simpan PDF</button>
        <button className="pf-btn" onClick={() => window.close()}><X size={15} /> Tutup</button>
        <span className="pf-hint">Tip: di jendela cetak pilih kertas A4, matikan &ldquo;Headers and footers&rdquo;, dan aktifkan &ldquo;Background graphics&rdquo;.</span>
      </div>

      <div className="pf-sheet">
        {watermark && <div className="pf-watermark">{watermark}</div>}

        {/* ---------- KOP ---------- */}
        <header className="pf-head">
          <div className="pf-brand">
            <div className="pf-logo">{initials}</div>
            <div>
              <div className="pf-company">{company.name}</div>
              {addr && <div className="pf-small">{addr}</div>}
              <div className="pf-small">
                {[company.phone && `Telp. ${company.phone}`, company.npwp && `NPWP ${company.npwp}`].filter(Boolean).join("  ·  ")}
              </div>
            </div>
          </div>
          <div className="pf-titlebox">
            <div className="pf-title" style={title.length > 16 ? { fontSize: "12.5pt" } : undefined}>{title}</div>
            <div className="pf-docno">{doc.name}</div>
            {watermark && <div className={`pf-chip ${doc.docstatus === 2 ? "pf-chip-red" : ""}`}>{watermark === "DRAFT" ? "Draft – belum sah" : "Dibatalkan"}</div>}
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
@page { size: A4; margin: 12mm 12mm 12mm 12mm; }
.pf-root { --ac: #0f4c5c; --ac-soft: #e7f0f2; --ink: #1c1f23; --mute: #5f6670; --line: #d9dee3;
  min-height: 100vh; background: #e9ecef; padding: 18px 0 40px; color: var(--ink);
  font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 10pt; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pf-toolbar { width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pf-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #c9ced4; background: #fff; color: #222;
  padding: 7px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.pf-btn:hover { background: #f5f6f7; }
.pf-primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.pf-primary:hover { background: #0c3d4a; }
.pf-hint { font-size: 11.5px; color: #6b7280; }
.pf-sheet { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 14mm 14mm 12mm;
  box-shadow: 0 2px 18px rgba(0,0,0,.12); display: flex; flex-direction: column; overflow: hidden; }
.pf-watermark { position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 92pt; font-weight: 800;
  letter-spacing: .08em; color: rgba(185, 28, 28, .08); pointer-events: none; white-space: nowrap; z-index: 0; }
.pf-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; position: relative; z-index: 1; }
.pf-brand { display: flex; gap: 4mm; align-items: center; flex: 1; min-width: 0; }
.pf-logo { width: 15mm; height: 15mm; border-radius: 3mm; background: var(--ac); color: #fff; display: flex; align-items: center;
  justify-content: center; font-weight: 800; font-size: 13pt; letter-spacing: .04em; flex-shrink: 0; }
.pf-company { font-size: 14pt; font-weight: 700; letter-spacing: -.01em; }
.pf-titlebox { text-align: right; flex-shrink: 0; white-space: nowrap; }
.pf-title { font-size: 16pt; font-weight: 800; color: var(--ac); letter-spacing: .03em; line-height: 1.1; }
.pf-docno { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 10.5pt; margin-top: 1.5mm; font-weight: 600; }
.pf-chip { display: inline-block; margin-top: 2mm; padding: .5mm 2.5mm; border-radius: 99px; font-size: 8pt; font-weight: 600;
  background: #fef3c7; color: #92400e; }
.pf-chip-red { background: #fee2e2; color: #991b1b; }
.pf-rule { height: 1.2mm; margin: 5mm 0 6mm; background: linear-gradient(90deg, var(--ac) 0 38%, var(--ac-soft) 38% 100%); border-radius: 1mm; }
.pf-info { display: grid; grid-template-columns: 1.1fr 1fr; gap: 6mm; margin-bottom: 6mm; position: relative; z-index: 1; }
.pf-party { border-left: 1mm solid var(--ac); background: #f7f9fa; padding: 3mm 4mm; border-radius: 0 2mm 2mm 0; }
.pf-party-name { font-size: 11.5pt; font-weight: 700; margin-bottom: .5mm; }
.pf-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .09em; color: var(--mute); font-weight: 600; margin-bottom: 1mm; }
.pf-meta { width: 100%; border-collapse: collapse; align-self: start; }
.pf-meta td { padding: 1.1mm 0; border-bottom: 1px dotted var(--line); vertical-align: top; }
.pf-meta td:first-child { color: var(--mute); width: 42%; padding-right: 3mm; }
.pf-meta td:last-child { font-weight: 600; text-align: right; }
.pf-items { width: 100%; border-collapse: collapse; position: relative; z-index: 1; }
.pf-items thead th { background: var(--ac); color: #fff; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em;
  padding: 2.2mm 2.5mm; text-align: left; }
.pf-items thead th:first-child { border-radius: 1.5mm 0 0 0; }
.pf-items thead th:last-child { border-radius: 0 1.5mm 0 0; }
.pf-items tbody td { padding: 2.2mm 2.5mm; border-bottom: 1px solid var(--line); vertical-align: top; }
.pf-items tbody tr:nth-child(even) td { background: #f7f9fa; }
.pf-items tfoot td { padding: 2.2mm 2.5mm; border-top: 1.5px solid var(--ink); font-weight: 600; }
.pf-items tr { break-inside: avoid; }
.pf-r { text-align: right !important; } .pf-c { text-align: center !important; width: 9mm; }
.pf-nowrap { white-space: nowrap; }
.pf-strong { font-weight: 600; } .pf-muted { color: var(--mute); } .pf-small { font-size: 9pt; } .pf-tiny { font-size: 7.8pt; color: var(--mute); }
.pf-mono { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
.pf-bottom { display: grid; grid-template-columns: 1fr 70mm; gap: 8mm; margin-top: 5mm; break-inside: avoid; position: relative; z-index: 1; }
.pf-notes { display: flex; flex-direction: column; gap: 3mm; font-size: 9pt; }
.pf-words { background: var(--ac-soft); border-radius: 2mm; padding: 2.5mm 3.5mm; }
.pf-note { color: var(--mute); font-size: 8.5pt; border-top: 1px dashed var(--line); padding-top: 2mm; }
.pf-totals { align-self: start; border: 1px solid var(--line); border-radius: 2mm; overflow: hidden; }
.pf-totals > div { display: flex; justify-content: space-between; padding: 1.8mm 3.5mm; border-bottom: 1px solid var(--line); }
.pf-totals > div:last-child { border-bottom: none; }
.pf-grand { background: var(--ac); color: #fff; font-weight: 700; font-size: 11.5pt; }
.pf-amount { display: grid; grid-template-columns: auto 1fr; gap: 8mm; align-items: center; background: var(--ac-soft);
  border-radius: 2.5mm; padding: 4mm 6mm; margin-bottom: 6mm; }
.pf-amount-value { font-size: 20pt; font-weight: 800; color: var(--ac); white-space: nowrap; }
.pf-amount-words { font-size: 10pt; border-left: 1px solid #c3d6db; padding-left: 6mm; }
.pf-signs { display: grid; gap: 8mm; justify-content: space-between; margin-top: auto; padding-top: 12mm; break-inside: avoid; }
.pf-signs:has(> .pf-sign:only-child) { justify-content: end; }
.pf-sign { text-align: center; font-size: 9pt; }
.pf-sign-label { color: var(--mute); }
.pf-sign-space { height: 20mm; }
.pf-sign-line { border-top: 1px solid var(--ink); padding-top: 1mm; font-weight: 600; min-height: 5mm; }
.pf-sign-date { color: var(--mute); font-size: 8pt; margin-top: 1mm; }
.pf-foot { display: flex; justify-content: space-between; margin-top: 8mm; padding-top: 2mm; border-top: 1px solid var(--line);
  font-size: 7.5pt; color: var(--mute); }
@media print {
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .pf-root { background: #fff; padding: 0; min-height: 0; }
  .pf-sheet { box-shadow: none; width: auto; min-height: 270mm; padding: 0; margin: 0; }
}
`;
