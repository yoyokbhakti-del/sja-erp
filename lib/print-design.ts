// =====================================================================
// Desain Cetakan: model konfigurasi, katalog field/kolom, nilai bawaan
// dan data contoh untuk pratinjau. Disimpan di tabel print_designs.config.
// =====================================================================
import { number, rupiah, tanggal, terbilang, waktu } from "@/lib/format";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Dokumen yang desain cetaknya bisa diatur (dokumen dengan tabel barang)
export const DESIGN_DOCS = [
  { key: "sales_invoices", label: "Invoice Penjualan" },
  { key: "delivery_notes", label: "Surat Jalan" },
  { key: "sales_orders", label: "Sales Order" },
  { key: "purchase_orders", label: "Purchase Order" },
  { key: "purchase_receipts", label: "Bukti Penerimaan Barang" },
  { key: "purchase_invoices", label: "Purchase Invoice" },
  { key: "stock_entries", label: "Mutasi Stok" },
] as const;
export const designDocLabel = (key: string) => DESIGN_DOCS.find((d) => d.key === key)?.label ?? key;

// ----------------------------- kertas ---------------------------------
export const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  "cf-half": { label: "½ continuous form 9,5 × 5,5 inci", w: 241.3, h: 139.7 },
  "cf-full": { label: "Continuous form 9,5 × 11 inci", w: 241.3, h: 279.4 },
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
  a4l: { label: "A4 mendatar (297 × 210 mm)", w: 297, h: 210 },
  a5: { label: "A5 (148 × 210 mm)", w: 148, h: 210 },
  a5l: { label: "A5 mendatar (210 × 148 mm)", w: 210, h: 148 },
  custom: { label: "Ukuran khusus", w: 210, h: 297 },
};

// ----------------------------- model ----------------------------------
export type FontFam = "sans" | "serif" | "mono";
// Pengaturan huruf per kolom (kosong = ikut pengaturan tabel). size dalam pt, 0/kosong = ikut tabel.
export type ColCfg = {
  key: string; label: string; width: number | null;
  fam?: FontFam; size?: number; bold?: boolean; italic?: boolean; align?: "l" | "c" | "r";
  text?: string;          // khusus kolom kustom: teks tetap di tiap baris (kosong = kolom kosong untuk ditulis tangan)
};

export type ElType = "text" | "kv" | "totals" | "rect" | "line" | "image";
export type Band = "head" | "foot";
// Satu elemen di kanvas. Satuan posisi/ukuran: mm, relatif terhadap bagian (kop/bawah).
export type El = {
  id: string; type: ElType; band: Band; name?: string;
  x: number; y: number; w: number; h: number;
  hidden?: boolean; showIf?: string;
  // teks
  text?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; upper?: boolean;
  align?: "l" | "c" | "r"; valign?: "t" | "m" | "b"; family?: "" | "sans" | "serif" | "mono"; color?: string; spacing?: number;
  // kotak / garis
  stroke?: number; dash?: boolean; fill?: string; radius?: number; dir?: "h" | "v";
  // gambar
  src?: string;
  // daftar info (label : isi) & blok total
  rows?: { label: string; v: string; fam?: FontFam; size?: number; bold?: boolean; italic?: boolean }[]; labelW?: number; keys?: string[]; labelBold?: boolean;
};

export type TableCfg = {
  columns: ColCfg[]; border: "full" | "box" | "boxh" | "horizontal" | "none"; minRows: number; itemSubline: boolean;
  extraRows?: number;     // baris kosong tambahan di bawah data
  lineW?: number;         // tebal garis (pt)
  headBg: boolean; size: number; pad: number; headUpper: boolean;
  fam?: FontFam;          // jenis huruf tabel (kosong = ikut dokumen)
};

export type DesignConfig = {
  v: 2;
  paper: { preset: string; w: number; h: number; mt: number; mr: number; mb: number; ml: number };
  font: { family: "sans" | "serif" | "mono"; size: number };
  watermark: boolean;
  head: { h: number };
  foot: { h: number; pin: boolean };
  table: TableCfg;
  els: El[];
};

// ------------------------ katalog informasi dokumen --------------------
export const META_FIELDS: { key: string; label: string; get: (d: Row) => unknown }[] = [
  { key: "date", label: "Tanggal", get: (d) => tanggal(d.posting_date ?? d.transaction_date) },
  { key: "due_date", label: "Jatuh Tempo", get: (d) => tanggal(d.due_date) },
  { key: "schedule_date", label: "Tgl. Dibutuhkan", get: (d) => tanggal(d.schedule_date) },
  { key: "delivery_date", label: "Tgl. Kirim", get: (d) => tanggal(d.delivery_date) },
  { key: "purpose", label: "Jenis", get: (d) => d.purpose && `${d.purpose}${d.is_opening ? " (Saldo Awal)" : ""}` },
  { key: "po_no", label: "No. PO Customer", get: (d) => d.po_no },
  { key: "ref_po", label: "Ref. Purchase Order", get: (d) => d.purchase_order_id__l?.name },
  { key: "ref_pr", label: "Ref. Penerimaan", get: (d) => d.purchase_receipt_id__l?.name },
  { key: "ref_so", label: "Ref. Sales Order", get: (d) => d.sales_order_id__l?.name },
  { key: "ref_dn", label: "Ref. Surat Jalan", get: (d) => d.delivery_note_id__l?.name },
  { key: "supplier_dn", label: "No. SJ Supplier", get: (d) => d.supplier_delivery_note },
  { key: "bill_no", label: "No. Invoice Supplier", get: (d) => d.bill_no },
  { key: "faktur_pajak", label: "No. Faktur Pajak", get: (d) => d.faktur_pajak_no },
  { key: "wh", label: "Gudang", get: (d) => wh(d, "set_warehouse_id") },
  { key: "wh_from", label: "Dari Gudang", get: (d) => wh(d, "from_warehouse_id") },
  { key: "wh_to", label: "Ke Gudang", get: (d) => wh(d, "to_warehouse_id") },
  { key: "vehicle", label: "No. Kendaraan", get: (d) => d.vehicle_no },
  { key: "driver", label: "Sopir", get: (d) => d.driver_name },
  { key: "currency", label: "Mata uang (kode)", get: (d) => d.currency || "IDR" },
  { key: "currency_name", label: "Mata uang (nama)", get: (d) => CURRENCY_NAMES[String(d.currency || "IDR")] ?? d.currency },
  { key: "credit_days", label: "Kredit (hari)", get: (d) => creditDays(d) },
  { key: "credit_term", label: "Termin bayar (Kredit 30 hari / Tunai)", get: (d) => {
      const n = creditDays(d);
      return n === "" ? "" : Number(n) === 0 ? "Tunai" : `Kredit ${n} hari`;
    } },
];
const CURRENCY_NAMES: Record<string, string> = { IDR: "Rupiah", USD: "Dolar AS", SGD: "Dolar Singapura", EUR: "Euro" };
// Lama kredit: selisih tanggal dokumen dan jatuh tempo; bila belum ada jatuh tempo, pakai termin bawaan customer/supplier.
function creditDays(d: Row): string {
  const t0 = Date.parse(String(d.posting_date ?? d.transaction_date ?? ""));
  const t1 = Date.parse(String(d.due_date ?? ""));
  if (!Number.isNaN(t0) && !Number.isNaN(t1)) return String(Math.max(0, Math.round((t1 - t0) / 86400000)));
  const terms = (d.party as Row | undefined)?.payment_terms_days;
  return terms === null || terms === undefined ? "" : String(terms);
}
function wh(d: Row, k: string) {
  const w = d[`${k}__l`];
  return w ? `${w.code} – ${w.name}` : "";
}

// ------------------------ katalog kolom tabel -------------------------
export type ColDef = { key: string; label: string; width: number | null; align: "l" | "r" | "c"; get: (r: Row, i: number, d: Row) => string };
const nz = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
export const COLUMN_DEFS: ColDef[] = [
  { key: "no", label: "No.", width: 12, align: "c", get: (_r, i) => String(i + 1) },
  { key: "item_code", label: "Kode", width: 24, align: "l", get: (r) => nz(r.item?.code) },
  { key: "item_name", label: "Nama Barang", width: null, align: "l", get: (r) => nz(r.item?.name) },
  { key: "brand", label: "Merk", width: 24, align: "l", get: (r) => nz(r.item?.brand) },
  { key: "reg_number", label: "No. Reg.", width: 28, align: "l", get: (r) => nz(r.item?.reg_number) },
  { key: "qty", label: "Qty", width: 16, align: "r", get: (r) => number(r.qty) },
  { key: "uom", label: "Sat.", width: 14, align: "l", get: (r) => nz(r.item?.stock_uom) },
  { key: "qty_uom", label: "Qty", width: 22, align: "r", get: (r) => `${number(r.qty)} ${nz(r.item?.stock_uom)}`.trim() },
  { key: "batch", label: "Batch", width: 28, align: "l", get: (r) => nz(r.batch_allocation ?? r.batch_no) },
  { key: "expiry", label: "Kedaluwarsa", width: 24, align: "l", get: (r) => (r.expiry_date ? tanggal(r.expiry_date) : "") },
  { key: "warehouse", label: "Gudang", width: 24, align: "l", get: (r, _i, d) =>
      [r.sw?.code ?? d.from_warehouse_id__l?.code, r.tw?.code ?? d.to_warehouse_id__l?.code].filter(Boolean).join(" → ") },
  { key: "rate", label: "Harga", width: 26, align: "r", get: (r) => rupiah(r.rate ?? r.basic_rate) },
  { key: "discount", label: "Disk. %", width: 14, align: "r", get: (r) => (Number(r.discount_percent) ? number(r.discount_percent) : "") },
  { key: "amount", label: "Jumlah", width: 30, align: "r", get: (r) => rupiah(r.amount) },
];
const CUSTOM_COL: ColDef = { key: "custom", label: "Kolom kustom", width: null, align: "l", get: () => "" };
export const isCustomCol = (key: string) => /^custom_\w+$/.test(key);
export const colDef = (key: string): ColDef | undefined => COLUMN_DEFS.find((c) => c.key === key) ?? (isCustomCol(key) ? CUSTOM_COL : undefined);

// ------------------------ katalog total -------------------------------
export const TOTAL_DEFS: { key: string; label: (d: Row) => string; get: (d: Row, rows: Row[]) => string; grand?: boolean; only?: (key: string, d: Row) => boolean }[] = [
  { key: "total_qty", label: () => "Total Qty", get: (_d, rows) => number(rows.reduce((s, r) => s + Number(r.qty || 0), 0)) },
  { key: "subtotal", label: () => "Subtotal", get: (d) => rupiah(d.net_total), only: (k) => k !== "stock_entries" },
  { key: "ppn", label: (d) => `PPN ${number(d.ppn_percent)}%`, get: (d) => rupiah(d.tax_amount), only: (k) => k !== "stock_entries" },
  { key: "total", label: (d) => (d.total_amount !== undefined && d.grand_total === undefined ? "Total Nilai" : "Total"),
    get: (d) => rupiah(d.grand_total ?? d.total_amount), grand: true },
  { key: "outstanding", label: () => "Sisa Tagihan", get: (d) => rupiah(d.outstanding_amount), only: (k, d) => k.endsWith("invoices") && Number(d.outstanding_amount) !== Number(d.grand_total) },
];

// ------------------------ nilai bawaan per dokumen --------------------
type Base = { party?: string; priced: boolean; batch: boolean; words?: boolean; note?: string; signs: string[] };
const BASE: Record<string, Base> = {
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

const META_BY_DOC: Record<string, string[]> = {
  sales_invoices: ["date", "due_date", "ref_dn", "po_no", "faktur_pajak"],
  delivery_notes: ["date", "ref_so", "po_no", "wh", "vehicle", "driver"],
  sales_orders: ["date", "delivery_date", "po_no", "wh"],
  purchase_orders: ["date", "schedule_date", "wh"],
  purchase_receipts: ["date", "ref_po", "supplier_dn", "wh"],
  purchase_invoices: ["date", "due_date", "ref_pr", "bill_no"],
  stock_entries: ["date", "purpose", "wh_from", "wh_to"],
};

const col = (key: string): ColCfg => {
  const d = colDef(key)!;
  return { key, label: d.label, width: d.width };
};

// ------------------------ variabel yang bisa disisipkan ke teks -------
// Tulis {nama.variabel} di teks mana pun; diganti dengan data dokumen saat dicetak.
export type VarDef = { key: string; label: string; group: string };
export const VAR_CATALOG: VarDef[] = [
  { group: "Perusahaan", key: "company.name", label: "Nama perusahaan" },
  { group: "Perusahaan", key: "company.address", label: "Alamat" },
  { group: "Perusahaan", key: "company.city", label: "Kota" },
  { group: "Perusahaan", key: "company.address_line", label: "Alamat + kota" },
  { group: "Perusahaan", key: "company.phone", label: "Telepon" },
  { group: "Perusahaan", key: "company.npwp", label: "NPWP perusahaan" },
  { group: "Perusahaan", key: "company.contact_line", label: "Telp. + NPWP (satu baris)" },
  { group: "Dokumen", key: "doc.name", label: "Nomor dokumen" },
  { group: "Dokumen", key: "doc.title", label: "Judul dokumen (otomatis)" },
  { group: "Dokumen", key: "doc.status", label: "Status (Draft / Dibatalkan)" },
  { group: "Dokumen", key: "doc.remarks", label: "Keterangan dokumen" },
  { group: "Customer / Supplier", key: "party.name", label: "Nama" },
  { group: "Customer / Supplier", key: "party.contact", label: "Kontak (u.p.)" },
  { group: "Customer / Supplier", key: "party.address", label: "Alamat" },
  { group: "Customer / Supplier", key: "party.city", label: "Kota" },
  { group: "Customer / Supplier", key: "party.address_line", label: "Alamat + kota" },
  { group: "Customer / Supplier", key: "party.phone", label: "Telepon" },
  { group: "Customer / Supplier", key: "party.npwp", label: "NPWP" },
  { group: "Customer / Supplier", key: "party.contact_line", label: "Telp. + NPWP (satu baris)" },
  ...META_FIELDS.map((m) => ({ group: "Info dokumen", key: `m.${m.key}`, label: m.label })),
  { group: "Total", key: "total.total_qty", label: "Total Qty" },
  { group: "Total", key: "total.subtotal", label: "Subtotal" },
  { group: "Total", key: "total.ppn", label: "Nilai PPN" },
  { group: "Total", key: "total.ppn_label", label: "Label PPN (mis. PPN 11%)" },
  { group: "Total", key: "total.total", label: "Total / Grand total" },
  { group: "Total", key: "total.outstanding", label: "Sisa tagihan" },
  { group: "Total", key: "terbilang", label: "Terbilang" },
  { group: "Cetak", key: "maker", label: "Nama pembuat dokumen" },
  { group: "Cetak", key: "printed_by", label: "Dicetak oleh (email)" },
  { group: "Cetak", key: "printed_at", label: "Waktu cetak" },
];
export const varLabel = (key: string) => VAR_CATALOG.find((v) => v.key === key)?.label ?? key;

export function buildVars(args: {
  dtKey: string; title: string; doc: Row; rows: Row[]; company: Row; maker: string; printedBy: string;
}): Record<string, string> {
  const { dtKey, title, doc, rows, company, maker, printedBy } = args;
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const p = (doc.party ?? {}) as Row;
  const join = (sep: string, ...a: unknown[]) => a.filter(Boolean).map(String).join(sep);
  const v: Record<string, string> = {
    "company.name": s(company.print_name || company.name),
    "company.address": s(company.address), "company.city": s(company.city),
    "company.address_line": join(", ", company.address, company.city),
    "company.phone": s(company.phone), "company.npwp": s(company.npwp),
    "company.contact_line": join("  ·  ", company.phone && `Telp. ${company.phone}`, company.npwp && `NPWP ${company.npwp}`),
    "doc.name": s(doc.name), "doc.title": title,
    "doc.status": doc.docstatus === 0 ? "Draft – belum sah" : doc.docstatus === 2 ? "Dibatalkan" : "",
    "doc.remarks": s(doc.remarks),
    "party.name": s(p.name), "party.contact": s(p.contact_person), "party.address": s(p.address), "party.city": s(p.city),
    "party.address_line": join(", ", p.address, p.city), "party.phone": s(p.phone), "party.npwp": s(p.npwp),
    "party.contact_line": join("  ·  ", p.phone && `Telp. ${p.phone}`, p.npwp && `NPWP ${p.npwp}`),
    maker: s(maker), printed_by: s(printedBy), printed_at: waktu(new Date().toISOString()),
    terbilang: doc.grand_total !== undefined && doc.grand_total !== null ? terbilang(Number(doc.grand_total || 0)) : "",
    logo: "/logo-sja.png",
  };
  for (const m of META_FIELDS) v[`m.${m.key}`] = s(m.get(doc));
  for (const t of TOTAL_DEFS) v[`total.${t.key}`] = !t.only || t.only(dtKey, doc) ? t.get(doc, rows) : "";
  v["total.ppn_label"] = `PPN ${number(doc.ppn_percent)}%`;
  return v;
}

// Ganti {variabel} dengan nilainya. Baris yang seluruh variabelnya kosong dibuang
// (mis. "u.p. {party.contact}" hilang bila tak ada kontak).
export function resolveText(text: string, vars: Record<string, string>): string {
  const re = /\{([a-z0-9_.]+)\}/g;
  return text.split("\n").map((line) => {
    let n = 0, filled = 0;
    const out = line.replace(re, (m, k: string) => {
      if (!(k in vars)) return m;
      n++;
      if (vars[k]) filled++;
      return vars[k];
    });
    return { out, keep: n === 0 || filled > 0 };
  }).filter((l) => l.keep).map((l) => l.out).join("\n");
}

// ------------------------ elemen baru ---------------------------------
export const uid = () => Math.random().toString(36).slice(2, 9);

export function newEl(type: ElType, band: Band, fs: number, W: number): El {
  const base = { id: uid(), type, band, x: Math.min(10, W / 4), y: 3 };
  switch (type) {
    case "text": return { ...base, w: 60, h: 6, text: "Teks baru", size: fs, align: "l", valign: "t" };
    case "kv": return { ...base, w: 80, h: 18, size: fs, labelW: 30, rows: [{ label: "Tanggal", v: "m.date" }, { label: "No. PO", v: "m.po_no" }] };
    case "totals": return { ...base, w: 68, h: 20, size: fs, keys: ["subtotal", "ppn", "total"] };
    case "rect": return { ...base, w: 60, h: 20, stroke: 0.25, fill: "", color: "#000000", radius: 0 };
    case "line": return { ...base, w: 60, h: 1, stroke: 0.25, dir: "h", color: "#000000" };
    case "image": return { ...base, w: 14, h: 14, src: "{logo}" };
  }
}

// Kotak tanda tangan: judul + ruang kosong + garis + nama
export function signGroup(band: Band, x: number, y: number, label: string, fs: number, spaceH = 18, w = 50): El[] {
  return [
    { id: uid(), type: "text", band, x, y, w, h: 5, text: label, size: fs, align: "c", valign: "t", name: `TTD ${label}` },
    { id: uid(), type: "line", band, x, y: y + 5 + spaceH, w, h: 1, stroke: 0.25, dir: "h", color: "#000000", name: `Garis TTD ${label}` },
    { id: uid(), type: "text", band, x, y: y + 6.5 + spaceH, w, h: 5, text: "Tgl. ____________", size: Math.max(fs - 1.5, 6), align: "c", valign: "t", name: `Tgl TTD ${label}` },
  ];
}

// ------------------------ konfigurasi lama (v1) → tata letak bebas -----
type LegacyCfg = {
  paper: DesignConfig["paper"]; font: DesignConfig["font"];
  header: { showCompany: boolean; showAddress: boolean; showPhone: boolean; showNpwp: boolean; align: "split" | "center"; title: string; showDocNo: boolean; rule: boolean };
  info: { showParty: boolean; partyLabel: string; showContact: boolean; showRemarks: boolean; fields: string[] };
  table: { columns: ColCfg[]; border: "full" | "horizontal" | "none"; minRows: number; itemSubline: boolean };
  totals: { show: string[]; words: boolean };
  footer: { note: string; signs: string[]; signHeight: number; showSignDate: boolean; showPrinted: boolean };
};

function legacyDefault(docKey: string): LegacyCfg {
  const b = BASE[docKey] ?? { priced: true, batch: false, signs: ["Dibuat oleh", "Disetujui"] };
  const isSte = docKey === "stock_entries";
  const columns: ColCfg[] = [
    col("no"), col("item_name"),
    ...(isSte ? [col("warehouse")] : []),
    ...(b.batch ? [{ ...col("batch"), label: "Batch / Kedaluwarsa" }] : []),
    col("qty_uom"),
    ...(b.priced ? [col("rate"), col("amount")] : []),
  ];
  const totals = b.priced
    ? (isSte ? ["total"] : ["subtotal", "ppn", "total", "outstanding"])
    : ["total_qty"];
  return {
    paper: { preset: "a4", w: 210, h: 297, mt: 12, mr: 12, mb: 12, ml: 12 },
    font: { family: "sans", size: 9.5 },
    header: { showCompany: true, showAddress: true, showPhone: true, showNpwp: true, align: "split", title: "", showDocNo: true, rule: true },
    info: { showParty: true, partyLabel: b.party ?? "Keterangan", showContact: true, showRemarks: true, fields: META_BY_DOC[docKey] ?? ["date"] },
    table: { columns, border: "full", minRows: 0, itemSubline: true },
    totals: { show: totals, words: !!b.words },
    footer: { note: b.note ?? "", signs: b.signs, signHeight: 20, showSignDate: true, showPrinted: true },
  };
}

function fromLegacy(docKey: string, L: LegacyCfg): DesignConfig {
  const hasParty = !!(BASE[docKey]?.party);
  const W = L.paper.w - L.paper.ml - L.paper.mr;
  const fs = L.font.size;
  const els: El[] = [];
  const t = (e: Partial<El> & { band: Band; x: number; y: number; w: number; h: number; text: string }) =>
    els.push({ id: uid(), type: "text", size: fs, align: "l", valign: "t", ...e });
  const center = L.header.align === "center";
  const tw = 76;

  // ---- kop
  if (L.header.showCompany) {
    const w = center ? W : W - tw - 4;
    const al = center ? "c" : "l";
    t({ band: "head", x: 0, y: 0, w, h: 6.5, text: "{company.name}", size: fs + 3.5, bold: true, upper: true, align: al, name: "Nama perusahaan" });
    if (L.header.showAddress) t({ band: "head", x: 0, y: 6.8, w, h: 4, text: "{company.address_line}", size: Math.max(fs - 0.5, 6), align: al, name: "Alamat perusahaan" });
    const contact = L.header.showPhone && L.header.showNpwp ? "{company.contact_line}"
      : L.header.showPhone ? "Telp. {company.phone}" : L.header.showNpwp ? "NPWP {company.npwp}" : "";
    if (contact) t({ band: "head", x: 0, y: 10.8, w, h: 4, text: contact, size: Math.max(fs - 0.5, 6), align: al, name: "Kontak perusahaan" });
  }
  const ty = center ? (L.header.showCompany ? 16 : 0) : 0;
  const tx = center ? 0 : W - tw;
  const tAl = center ? "c" : "r";
  const tW = center ? W : tw;
  t({ band: "head", x: tx, y: ty, w: tW, h: 7, text: L.header.title.trim() || "{doc.title}", size: fs + 4.5, bold: true, upper: true, spacing: 0.4, align: tAl, name: "Judul dokumen" });
  let ty2 = ty + 7.5;
  if (L.header.showDocNo) { t({ band: "head", x: tx, y: ty2, w: tW, h: 5, text: "{doc.name}", size: fs + 0.5, align: tAl, name: "Nomor dokumen" }); ty2 += 5.5; }
  t({ band: "head", x: tx, y: ty2, w: tW, h: 4, text: "{doc.status}", size: Math.max(fs - 1.5, 6), bold: true, upper: true, align: tAl, showIf: "doc.status", name: "Status dokumen" });
  const base = center ? Math.max(ty2 + 6, 24) : Math.max(ty2 + 5, L.header.showCompany ? 17 : 14);
  let iy = base;
  if (L.header.rule) {
    els.push({ id: uid(), type: "line", band: "head", x: 0, y: base, w: W, h: 1, stroke: 0.7, dir: "h", color: "#000000", name: "Garis kop" });
    els.push({ id: uid(), type: "line", band: "head", x: 0, y: base + 1.4, w: W, h: 1, stroke: 0.2, dir: "h", color: "#000000", name: "Garis kop tipis" });
    iy = base + 5;
  } else iy = base + 3;

  // ---- info: customer/supplier + data dokumen
  const colW = (W - 8) * 0.52;
  let infoH = 0;
  if (L.info.showParty) {
    t({ band: "head", x: 0, y: iy, w: colW, h: 4, text: L.info.partyLabel, size: Math.max(fs - 1.5, 6), bold: true, upper: true, name: "Judul kotak" });
    if (hasParty) {
      t({ band: "head", x: 0, y: iy + 4, w: colW, h: 5, text: "{party.name}", size: fs + 1, bold: true, name: "Nama customer/supplier" });
      const lines = [L.info.showContact ? "u.p. {party.contact}" : "", "{party.address}", "{party.city}", "{party.contact_line}"].filter(Boolean);
      t({ band: "head", x: 0, y: iy + 9.2, w: colW, h: lines.length * 4.4, text: lines.join("\n"), name: "Alamat customer/supplier" });
      infoH = 9.2 + 4 * 4.4;
    } else {
      t({ band: "head", x: 0, y: iy + 4, w: colW, h: 12, text: "{doc.remarks}", name: "Keterangan" });
      infoH = 16;
    }
  }
  const rows = L.info.fields.map((k) => META_FIELDS.find((m) => m.key === k)).filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ label: m.label, v: `m.${m.key}` }));
  if (rows.length) {
    const kx = L.info.showParty ? colW + 8 : 0;
    const kh = rows.length * (fs * 0.4 + 0.9) + 1;
    els.push({ id: uid(), type: "kv", band: "head", x: kx, y: iy, w: W - kx, h: kh, size: fs, labelW: 32, rows, name: "Data dokumen" });
    infoH = Math.max(infoH, kh);
  }
  const headH = Math.ceil(iy + infoH + 2);

  // ---- bagian bawah
  let ly = 3;
  if (L.totals.words) {
    t({ band: "foot", x: 0, y: ly, w: W - 72, h: 4, text: "Terbilang", size: Math.max(fs - 1.5, 6), bold: true, upper: true, showIf: "terbilang", name: "Judul terbilang" });
    t({ band: "foot", x: 0, y: ly + 4, w: W - 72, h: 11, text: "{terbilang}", italic: true, showIf: "terbilang", name: "Terbilang" });
    ly += 16;
  }
  if (L.info.showRemarks && hasParty) {
    t({ band: "foot", x: 0, y: ly, w: W - 72, h: 4, text: "Keterangan", size: Math.max(fs - 1.5, 6), bold: true, upper: true, showIf: "doc.remarks", name: "Judul keterangan" });
    t({ band: "foot", x: 0, y: ly + 4, w: W - 72, h: 8, text: "{doc.remarks}", showIf: "doc.remarks", name: "Keterangan dokumen" });
    ly += 12.5;
  }
  if (L.footer.note.trim()) {
    const lines = Math.ceil(L.footer.note.length / Math.max(((W - 72) / (fs * 0.2)), 20));
    const nh = Math.max(5, lines * (fs * 0.4));
    t({ band: "foot", x: 0, y: ly, w: W - 72, h: nh, text: L.footer.note, size: Math.max(fs - 1, 6), name: "Catatan" });
    ly += nh + 1;
  }
  let totH = 0;
  if (L.totals.show.length) {
    totH = L.totals.show.length * (fs * 0.4 + 1.9);
    els.push({ id: uid(), type: "totals", band: "foot", x: W - 68, y: 3, w: 68, h: totH, size: fs, keys: L.totals.show, name: "Total" });
  }
  let fy = Math.max(ly, 3 + totH);
  const signs = L.footer.signs.map((x) => x.trim()).filter(Boolean);
  if (signs.length) {
    fy += 6;
    const sw = 52;
    signs.forEach((s, i) => {
      const x = signs.length === 1 ? W - sw : (i * (W - sw)) / (signs.length - 1);
      const g = signGroup("foot", x, fy, s, fs, L.footer.signHeight, sw);
      if (!L.footer.showSignDate) g.pop();
      if (["Dibuat oleh", "Hormat kami"].includes(s)) {
        g.push({ id: uid(), type: "text", band: "foot", x, y: fy + 6 + L.footer.signHeight, w: sw, h: 5, text: "{maker}", size: fs, align: "c", valign: "t", name: `Nama TTD ${s}` });
      }
      els.push(...g);
    });
    fy += 6.5 + L.footer.signHeight + (L.footer.showSignDate ? 6 : 1) + 5;
  }
  if (L.footer.showPrinted) {
    fy += 3;
    els.push({ id: uid(), type: "line", band: "foot", x: 0, y: fy - 0.5, w: W, h: 1, stroke: 0.15, dir: "h", color: "#000000", name: "Garis footer" });
    t({ band: "foot", x: 0, y: fy + 1, w: W * 0.8, h: 4, text: "Dicetak dari SJA ERP · {printed_at} · {printed_by}", size: Math.max(fs - 2, 5.5), name: "Footer cetak" });
    t({ band: "foot", x: W * 0.8, y: fy + 1, w: W * 0.2, h: 4, text: "{doc.name}", size: Math.max(fs - 2, 5.5), align: "r", name: "Footer nomor" });
    fy += 6;
  }

  return {
    v: 2, paper: L.paper, font: L.font, watermark: true,
    head: { h: headH }, foot: { h: Math.ceil(fy + 1), pin: false },
    table: { ...L.table, headBg: false, size: 0, pad: 1.5, headUpper: true },
    els,
  };
}

export function defaultDesign(docKey: string): DesignConfig {
  return fromLegacy(docKey, legacyDefault(docKey));
}

// ------------------------ penggabungan & pembersihan ------------------
const num = (v: unknown, d: number, min = -1000, max = 2000) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

function cleanEls(arr: unknown): El[] {
  if (!Array.isArray(arr)) return [];
  const types: ElType[] = ["text", "kv", "totals", "rect", "line", "image"];
  return arr.flatMap((raw): El[] => {
    const e = raw as Partial<El> | null;
    if (!e || typeof e !== "object" || !types.includes(e.type as ElType)) return [];
    const el: El = {
      ...e, id: str(e.id) || uid(), type: e.type as ElType, band: e.band === "foot" ? "foot" : "head",
      x: num(e.x, 0), y: num(e.y, 0), w: num(e.w, 20, 0.5, 1000), h: num(e.h, 5, 0.1, 1000),
    };
    if (el.rows && !Array.isArray(el.rows)) delete el.rows;
    if (el.rows) el.rows = el.rows.filter((r) => r && typeof r === "object").map((r) => {
      const o: NonNullable<El["rows"]>[number] = { label: str(r.label), v: str(r.v) };
      if (r.fam === "sans" || r.fam === "serif" || r.fam === "mono") o.fam = r.fam;
      if (typeof r.size === "number" && r.size > 0) o.size = Math.min(30, r.size);
      if (r.bold) o.bold = true;
      if (r.italic) o.italic = true;
      return o;
    });
    if (el.keys && !Array.isArray(el.keys)) delete el.keys;
    if (el.type === "totals") el.keys = (el.keys ?? []).filter((k) => TOTAL_DEFS.some((t) => t.key === k));
    return [el];
  });
}

// Gabungkan konfigurasi tersimpan dengan bawaan agar desain lama tetap valid.
// Bersihkan satu kolom dari data tersimpan (tolak nilai di luar pilihan)
function cleanCol(x: ColCfg): ColCfg {
  const o: ColCfg = {
    key: x.key, label: typeof x.label === "string" ? x.label : colDef(x.key)!.label,
    width: typeof x.width === "number" && x.width > 0 ? x.width : null,
  };
  if (x.fam === "sans" || x.fam === "serif" || x.fam === "mono") o.fam = x.fam;
  if (typeof x.size === "number" && x.size > 0) o.size = Math.min(30, x.size);
  if (x.bold) o.bold = true;
  if (x.italic) o.italic = true;
  if (x.align === "l" || x.align === "c" || x.align === "r") o.align = x.align;
  if (isCustomCol(x.key) && typeof x.text === "string") o.text = x.text.slice(0, 200);
  return o;
}

// Desain format lama (v1, berbentuk formulir) otomatis diubah jadi tata letak bebas.
export function mergeDesign(docKey: string, raw: unknown): DesignConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (c.v === 2 && Array.isArray(c.els)) {
    const d = defaultDesign(docKey);
    const cols = Array.isArray(c.table?.columns)
      ? c.table.columns.filter((x: ColCfg) => x && colDef(x.key)).map((x: ColCfg) => cleanCol(x))
      : d.table.columns;
    return {
      v: 2,
      paper: { ...d.paper, ...c.paper },
      font: { ...d.font, ...c.font },
      watermark: c.watermark !== false,
      head: { h: num(c.head?.h, d.head.h, 5, 400) },
      foot: { h: num(c.foot?.h, d.foot.h, 5, 400), pin: !!c.foot?.pin },
      table: {
        ...d.table, ...c.table, fam: c.table?.fam === "sans" || c.table?.fam === "serif" || c.table?.fam === "mono" ? c.table.fam : undefined,
        border: ["full", "box", "boxh", "horizontal", "none"].includes(c.table?.border) ? c.table.border : d.table.border,
        extraRows: num(c.table?.extraRows, 0, 0, 40), lineW: num(c.table?.lineW, 0.6, 0.1, 3), columns: cols.length ? cols : d.table.columns },
      els: cleanEls(c.els),
    };
  }
  // format lama
  const d = legacyDefault(docKey);
  const cols = Array.isArray(c.table?.columns)
    ? c.table.columns.filter((x: ColCfg) => x && colDef(x.key)).map((x: ColCfg) => cleanCol(x))
    : d.table.columns;
  const L: LegacyCfg = {
    paper: { ...d.paper, ...c.paper },
    font: { ...d.font, ...c.font },
    header: { ...d.header, ...c.header },
    info: { ...d.info, ...c.info, fields: Array.isArray(c.info?.fields) ? c.info.fields.filter((k: string) => META_FIELDS.some((m) => m.key === k)) : d.info.fields },
    table: { ...d.table, ...c.table, columns: cols.length ? cols : d.table.columns },
    totals: { ...d.totals, ...c.totals, show: Array.isArray(c.totals?.show) ? c.totals.show.filter((k: string) => TOTAL_DEFS.some((t) => t.key === k)) : d.totals.show },
    footer: { ...d.footer, ...c.footer, signs: Array.isArray(c.footer?.signs) ? c.footer.signs : d.footer.signs },
  };
  return fromLegacy(docKey, L);
}

// ------------------------ data contoh untuk pratinjau -----------------
export function sampleData(docKey: string): { doc: Row; rows: Row[] } {
  const isSales = docKey.startsWith("sales") || docKey === "delivery_notes";
  const rows: Row[] = [
    { id: "1", qty: 25, rate: 185000, discount_percent: 0, amount: 4625000, batch_no: "B2611-01", expiry_date: "2028-11-30",
      item: { code: "PRD-0001", name: "Disinfektan Tambak Formula D 5 L", brand: "SJA", stock_uom: "Jerigen", reg_number: "K-0000000" } },
    { id: "2", qty: 10, rate: 92500, discount_percent: 5, amount: 878750, batch_no: "B2611-02", expiry_date: "2028-12-31",
      item: { code: "PRD-0002", name: "Probiotik Udang 1 Kg", brand: "SJA", stock_uom: "Kg", reg_number: "" } },
    { id: "3", qty: 4, rate: 310000, discount_percent: 0, amount: 1240000, batch_no: "B2611-03", expiry_date: "2029-01-31",
      item: { code: "PRD-0003", name: "Mineral Mix 25 Kg", brand: "SJA", stock_uom: "Sak", reg_number: "" } },
  ];
  const net = rows.reduce((s, r) => s + r.amount, 0);
  const tax = Math.round(net * 0.11);
  const doc: Row = {
    name: "CONTOH-2026-00001", posting_date: "2026-11-09", due_date: "2026-12-09", transaction_date: "2026-11-09",
    schedule_date: "2026-11-16", delivery_date: "2026-11-12", po_no: "PO-CUST-123", vehicle_no: "W 1234 XY", driver_name: "Pak Joko",
    bill_no: "INV-SUP-777", faktur_pajak_no: "010.000-26.00000001", purpose: "Penerimaan Material",
    net_total: net, ppn_percent: 11, tax_amount: tax, grand_total: net + tax, total_amount: net, outstanding_amount: net + tax,
    remarks: "Contoh keterangan dokumen. Data ini hanya untuk pratinjau.", docstatus: 1,
    sales_order_id__l: { name: "SO-2026-00001" }, delivery_note_id__l: { name: "DN-2026-00001" },
    purchase_order_id__l: { name: "PO-2026-00001" }, purchase_receipt_id__l: { name: "PR-2026-00001" },
    set_warehouse_id__l: { code: "FG", name: "Gudang Produk Jadi" },
    from_warehouse_id__l: { code: "FG", name: "Gudang Produk Jadi" }, to_warehouse_id__l: { code: "QRN", name: "Karantina" },
    party: { name: isSales ? "PT. Contoh Customer Tambak" : "PT. Contoh Supplier Kimia", address: "Jl. Contoh Raya No. 12", city: "Banyuwangi",
      phone: "0333-123456", npwp: "00.000.000.0-000.000", contact_person: "Bapak Budi" },
  };
  return { doc, rows };
}

export const SAMPLE_COMPANY: Row = {
  name: "CV. Sekar Jaya Abadi", address: "Jl. Contoh No. 1", city: "Gresik", phone: "031-0000000", npwp: "00.000.000.0-000.000",
};
