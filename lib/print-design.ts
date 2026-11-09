// =====================================================================
// Desain Cetakan: model konfigurasi, katalog field/kolom, nilai bawaan
// dan data contoh untuk pratinjau. Disimpan di tabel print_designs.config.
// =====================================================================
import { number, rupiah, tanggal } from "@/lib/format";

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
export type ColCfg = { key: string; label: string; width: number | null };

export type DesignConfig = {
  paper: { preset: string; w: number; h: number; mt: number; mr: number; mb: number; ml: number };
  font: { family: "sans" | "serif" | "mono"; size: number };
  header: {
    showCompany: boolean; showAddress: boolean; showPhone: boolean; showNpwp: boolean;
    align: "split" | "center"; title: string; showDocNo: boolean; rule: boolean;
  };
  info: { showParty: boolean; partyLabel: string; showContact: boolean; showRemarks: boolean; fields: string[] };
  table: { columns: ColCfg[]; border: "full" | "horizontal" | "none"; minRows: number; itemSubline: boolean };
  totals: { show: string[]; words: boolean };
  footer: { note: string; signs: string[]; signHeight: number; showSignDate: boolean; showPrinted: boolean };
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
];
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
export const colDef = (key: string) => COLUMN_DEFS.find((c) => c.key === key);

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
type Base = { party?: string; priced: boolean; batch: boolean; words?: boolean; note?: string; signs: string[]; remarksTitle?: string };
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

export function defaultDesign(docKey: string): DesignConfig {
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

// Gabungkan konfigurasi tersimpan dengan bawaan agar desain lama tetap valid
export function mergeDesign(docKey: string, raw: unknown): DesignConfig {
  const d = defaultDesign(docKey);
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<DesignConfig>;
  const cols = Array.isArray(c.table?.columns)
    ? c.table!.columns.filter((x) => x && colDef(x.key)).map((x) => ({
        key: x.key, label: typeof x.label === "string" ? x.label : colDef(x.key)!.label,
        width: typeof x.width === "number" && x.width > 0 ? x.width : null,
      }))
    : d.table.columns;
  return {
    paper: { ...d.paper, ...c.paper },
    font: { ...d.font, ...c.font },
    header: { ...d.header, ...c.header },
    info: { ...d.info, ...c.info, fields: Array.isArray(c.info?.fields) ? c.info!.fields.filter((k) => META_FIELDS.some((m) => m.key === k)) : d.info.fields },
    table: { ...d.table, ...c.table, columns: cols.length ? cols : d.table.columns },
    totals: { ...d.totals, ...c.totals, show: Array.isArray(c.totals?.show) ? c.totals!.show.filter((k) => TOTAL_DEFS.some((t) => t.key === k)) : d.totals.show },
    footer: { ...d.footer, ...c.footer, signs: Array.isArray(c.footer?.signs) ? c.footer!.signs : d.footer.signs },
  };
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
