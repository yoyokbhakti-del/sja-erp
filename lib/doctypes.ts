// =====================================================================
// Metadata DocType ala ERPNext. Menambah modul baru cukup:
//   1) buat tabel + panggil _setup_master / _setup_doc di migrasi SQL
//   2) daftarkan field-nya di sini -> list, form, filter otomatis jadi.
// =====================================================================

import { localISO } from "@/lib/format";

export type FieldType =
  | "data" | "text" | "int" | "float" | "currency" | "percent"
  | "date" | "check" | "select" | "link";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];          // untuk select
  link?: string;               // key doctype tujuan untuk link
  required?: boolean;
  readOnly?: boolean;          // dihitung sistem / diisi otomatis
  inList?: boolean;            // tampil sebagai kolom di list view
  default?: unknown | (() => unknown);
  section?: string;            // judul section baru dimulai di field ini
  width?: string;              // lebar kolom di tabel anak (tailwind)
  fetchFrom?: string;          // tabel anak: ambil nilai dari item saat item dipilih
  dependsOn?: (doc: Record<string, unknown>) => boolean;
  linkFilters?: Record<string, unknown>;   // filter tambahan untuk pilihan link
}

export interface ChildTable {
  table: string;
  label: string;
  fields: Field[];
}

export interface MakeAction {
  label: string;
  rpc: string;               // nama fungsi SQL, argumen tunggal p_xx
  arg: string;
  target: string;            // doctype hasil
  when?: (doc: Record<string, unknown>) => boolean;
}

export interface DocAction {
  label: string;
  rpc: string;               // fungsi SQL dengan satu argumen id dokumen (draft)
  arg: string;
  when?: (doc: Record<string, unknown>) => boolean;
}

type Row = Record<string, unknown>;

export interface DocType {
  key: string;               // nama tabel
  slug: string;              // url: /app/<slug>
  label: string;
  module: "Stok" | "Pembelian" | "Penjualan" | "Akuntansi" | "Pengaturan";
  isMaster?: boolean;
  submittable?: boolean;
  titleField: string;        // kolom judul (name/code)
  subtitleField?: string;
  valueField?: string;       // kolom kunci untuk link (default id)
  linkLabel?: string[];      // kolom yang ditampilkan saat dipilih via link
  searchFields: string[];
  orderBy?: { column: string; ascending: boolean };
  fields: Field[];
  child?: ChildTable;
  makes?: MakeAction[];
  actions?: DocAction[];     // tombol khusus saat Draft
  liveTotals?: (doc: Row, rows: Row[]) => Row;   // total yang dihitung langsung di form
  printTitle?: string | ((doc: Row) => string);
}

const today = () => localISO();

// ----------------------------- MASTER --------------------------------
const uoms: DocType = {
  key: "uoms", slug: "uom", label: "Satuan", module: "Pengaturan", isMaster: true,
  titleField: "code", subtitleField: "name", valueField: "code", linkLabel: ["code", "name"],
  searchFields: ["code", "name"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode", type: "data", required: true, inList: true },
    { name: "name", label: "Nama", type: "data", required: true, inList: true },
    { name: "whole_number", label: "Harus Bilangan Bulat", type: "check", inList: true },
  ],
};

const itemGroups: DocType = {
  key: "item_groups", slug: "item-group", label: "Grup Item", module: "Pengaturan", isMaster: true,
  titleField: "name", linkLabel: ["name"], searchFields: ["name"],
  orderBy: { column: "name", ascending: true },
  fields: [
    { name: "name", label: "Nama Grup", type: "data", required: true, inList: true },
    { name: "parent_id", label: "Induk", type: "link", link: "item_groups", inList: true },
  ],
};

const items: DocType = {
  key: "items", slug: "item", label: "Item", module: "Stok", isMaster: true,
  titleField: "code", subtitleField: "name", linkLabel: ["code", "name"],
  searchFields: ["code", "name"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode Item (otomatis)", type: "data", readOnly: true, inList: true },
    { name: "name", label: "Nama Item", type: "data", required: true, inList: true },
    { name: "item_group_id", label: "Grup Item", type: "link", link: "item_groups", inList: true },
    { name: "item_type", label: "Jenis", type: "select", required: true, inList: true, default: "Produk Jadi",
      options: ["Bahan Baku", "Bahan Kemas", "Produk Jadi", "Barang Dagang", "Jasa", "Lainnya"] },
    { name: "stock_uom", label: "Satuan Stok", type: "link", link: "uoms", required: true, inList: true },
    { name: "brand", label: "Merk", type: "data", inList: true },
    { name: "reg_number", label: "No. Registrasi Kementan", type: "data" },
    { name: "disabled", label: "Nonaktif", type: "check" },

    { name: "is_stock_item", label: "Item Stok (dihitung persediaannya)", type: "check", default: true, section: "Persediaan" },
    { name: "has_batch", label: "Pakai Nomor Batch", type: "check" },
    { name: "has_expiry", label: "Pakai Tanggal Kedaluwarsa", type: "check", dependsOn: (d) => !!d.has_batch },
    { name: "shelf_life_days", label: "Masa Simpan (hari)", type: "int", dependsOn: (d) => !!d.has_expiry },
    { name: "min_qty", label: "Titik Reorder (Qty Minimum)", type: "float" },

    { name: "standard_buying_rate", label: "Harga Beli Standar", type: "currency", section: "Harga" },
    { name: "standard_selling_rate", label: "Harga Jual Standar", type: "currency", inList: true },
    { name: "income_account_id", label: "Akun Pendapatan (kosong = default)", type: "link", link: "accounts", section: "Akuntansi",
      linkFilters: { root_type: "Pendapatan", is_group: false } },
    { name: "expense_account_id", label: "Akun Beban untuk item non-stok", type: "link", link: "accounts",
      linkFilters: { root_type: "Beban", is_group: false } },
    { name: "description", label: "Deskripsi", type: "text", section: "Keterangan" },
  ],
};

const warehouses: DocType = {
  key: "warehouses", slug: "warehouse", label: "Gudang", module: "Stok", isMaster: true,
  titleField: "code", subtitleField: "name", linkLabel: ["code", "name"],
  searchFields: ["code", "name"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode Gudang (otomatis)", type: "data", readOnly: true, inList: true },
    { name: "name", label: "Nama Gudang", type: "data", required: true, inList: true },
    { name: "warehouse_type", label: "Tipe", type: "select", inList: true, default: "Umum",
      options: ["Umum", "Karantina", "Bahan Baku", "Bahan Kemas", "Produk Jadi", "Reject", "Transit"] },
    { name: "disabled", label: "Nonaktif", type: "check", inList: true },
  ],
};

const suppliers: DocType = {
  key: "suppliers", slug: "supplier", label: "Supplier", module: "Pembelian", isMaster: true,
  titleField: "code", subtitleField: "name", linkLabel: ["code", "name"],
  searchFields: ["code", "name", "city"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode Supplier (otomatis)", type: "data", readOnly: true, inList: true },
    { name: "name", label: "Nama Supplier", type: "data", required: true, inList: true },
    { name: "supplier_group", label: "Grup", type: "select", options: ["Lokal", "Impor", "Jasa"], default: "Lokal", inList: true },
    { name: "is_approved", label: "Approved Vendor (CPOHB)", type: "check", inList: true },
    { name: "payment_terms_days", label: "Termin Bayar (hari)", type: "int", default: 30 },
    { name: "disabled", label: "Nonaktif", type: "check" },
    { name: "npwp", label: "NPWP", type: "data", section: "Kontak & Alamat" },
    { name: "contact_person", label: "Kontak", type: "data" },
    { name: "phone", label: "Telepon", type: "data" },
    { name: "email", label: "Email", type: "data" },
    { name: "city", label: "Kota", type: "data", inList: true },
    { name: "address", label: "Alamat", type: "text" },
  ],
};

const customers: DocType = {
  key: "customers", slug: "customer", label: "Customer", module: "Penjualan", isMaster: true,
  titleField: "code", subtitleField: "name", linkLabel: ["code", "name"],
  searchFields: ["code", "name", "city"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode Customer (otomatis)", type: "data", readOnly: true, inList: true },
    { name: "name", label: "Nama Customer", type: "data", required: true, inList: true },
    { name: "customer_group", label: "Grup", type: "select", default: "Distributor", inList: true,
      options: ["Distributor", "Poultry Shop", "Peternak", "Tambak", "Pemerintah", "Lainnya"] },
    { name: "payment_terms_days", label: "Termin Bayar (hari)", type: "int", default: 30 },
    { name: "credit_limit", label: "Plafon Kredit (0 = tanpa batas)", type: "currency" },
    { name: "disabled", label: "Nonaktif", type: "check" },
    { name: "npwp", label: "NPWP", type: "data", section: "Kontak & Alamat" },
    { name: "contact_person", label: "Kontak", type: "data" },
    { name: "phone", label: "Telepon", type: "data" },
    { name: "email", label: "Email", type: "data" },
    { name: "city", label: "Kota", type: "data", inList: true },
    { name: "address", label: "Alamat", type: "text" },
  ],
};

const companies: DocType = {
  key: "companies", slug: "company", label: "Perusahaan", module: "Pengaturan", isMaster: true,
  titleField: "name", linkLabel: ["name"], searchFields: ["name"],
  fields: [
    { name: "name", label: "Nama Perusahaan", type: "data", required: true, inList: true },
    { name: "abbr", label: "Singkatan", type: "data", required: true, inList: true },
    { name: "npwp", label: "NPWP", type: "data" },
    { name: "phone", label: "Telepon", type: "data" },
    { name: "city", label: "Kota", type: "data", inList: true },
    { name: "default_ppn", label: "PPN Default (%)", type: "percent", default: 11 },
    { name: "books_start_date", label: "Tanggal Mulai Pembukuan", type: "date" },
    { name: "frozen_until", label: "Kunci Periode s/d Tanggal", type: "date" },
    { name: "print_name", label: "Nama di Kop Cetak (kosong = nama perusahaan)", type: "data", section: "Cetakan" },
    { name: "bank_name", label: "Bank (rekening pembayaran)", type: "data" },
    { name: "bank_account_name", label: "Atas Nama Rekening", type: "data" },
    { name: "bank_account_no", label: "No. Rekening", type: "data" },
    { name: "address", label: "Alamat", type: "text" },
  ],
};

// --------------------------- TRANSAKSI --------------------------------
const tradeTotals = (): Field[] => [
  { name: "ppn_percent", label: "PPN (%)", type: "percent", default: 11, section: "Total" },
  { name: "total_qty", label: "Total Qty", type: "float", readOnly: true },
  { name: "net_total", label: "Total Sebelum Pajak", type: "currency", readOnly: true },
  { name: "tax_amount", label: "PPN", type: "currency", readOnly: true },
  { name: "grand_total", label: "Grand Total", type: "currency", readOnly: true, inList: true },
];

const docHeader = (): Field[] => [
  { name: "name", label: "No. Dokumen", type: "data", readOnly: true, inList: true },
  { name: "status", label: "Status", type: "data", readOnly: true, inList: true },
];

const stockEntries: DocType = {
  key: "stock_entries", slug: "stock-entry", label: "Stock Entry", module: "Stok", submittable: true,
  titleField: "name", subtitleField: "purpose", searchFields: ["name", "remarks"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "BUKTI MUTASI STOK",
  fields: [
    ...docHeader(),
    { name: "purpose", label: "Tujuan", type: "select", required: true, inList: true, default: "Penerimaan Material",
      options: ["Penerimaan Material", "Pengeluaran Material", "Transfer Material"] },
    { name: "posting_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "from_warehouse_id", label: "Gudang Asal (default)", type: "link", link: "warehouses",
      dependsOn: (d) => d.purpose !== "Penerimaan Material" },
    { name: "to_warehouse_id", label: "Gudang Tujuan (default)", type: "link", link: "warehouses",
      dependsOn: (d) => d.purpose !== "Pengeluaran Material" },
    { name: "total_amount", label: "Total Nilai", type: "currency", readOnly: true, inList: true },
    { name: "is_opening", label: "Saldo Awal Persediaan", type: "check", dependsOn: (d) => d.purpose === "Penerimaan Material" },
    { name: "difference_account_id", label: "Akun Lawan (kosong = Penyesuaian Persediaan)", type: "link", link: "accounts",
      dependsOn: (d) => d.purpose !== "Transfer Material" && !d.is_opening },
    { name: "remarks", label: "Keterangan", type: "text" },
  ],
  child: {
    table: "stock_entry_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-56" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "s_warehouse_id", label: "Gdg Asal", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "t_warehouse_id", label: "Gdg Tujuan", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "batch_no", label: "No. Batch", type: "data", width: "w-32" },
      { name: "expiry_date", label: "Exp.", type: "date", width: "w-36" },
      { name: "basic_rate", label: "Harga", type: "currency", width: "w-32", fetchFrom: "standard_buying_rate" },
      { name: "batch_allocation", label: "Alokasi Batch", type: "data", readOnly: true },
    ],
  },
};

const purchaseOrders: DocType = {
  key: "purchase_orders", slug: "purchase-order", label: "Purchase Order", module: "Pembelian", submittable: true,
  titleField: "name", subtitleField: "supplier_id", searchFields: ["name", "remarks"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "PURCHASE ORDER",
  fields: [
    ...docHeader(),
    { name: "supplier_id", label: "Supplier", type: "link", link: "suppliers", required: true, inList: true },
    { name: "transaction_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "schedule_date", label: "Tgl. Dibutuhkan", type: "date" },
    { name: "set_warehouse_id", label: "Gudang Tujuan", type: "link", link: "warehouses" },
    { name: "per_received", label: "% Diterima", type: "percent", readOnly: true, inList: true },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
  ],
  child: {
    table: "purchase_order_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-64" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-36", fetchFrom: "standard_buying_rate" },
      { name: "discount_percent", label: "Disk %", type: "percent", width: "w-20" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-36" },
      { name: "warehouse_id", label: "Gudang", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "received_qty", label: "Diterima", type: "float", readOnly: true, width: "w-24" },
    ],
  },
  makes: [{ label: "Purchase Receipt", rpc: "make_purchase_receipt", arg: "p_po", target: "purchase_receipts",
            when: (d) => Number(d.per_received) < 100 }],
};

const purchaseReceipts: DocType = {
  key: "purchase_receipts", slug: "purchase-receipt", label: "Purchase Receipt", module: "Pembelian", submittable: true,
  titleField: "name", subtitleField: "supplier_id", searchFields: ["name", "supplier_delivery_note"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "BUKTI PENERIMAAN BARANG",
  fields: [
    ...docHeader(),
    { name: "supplier_id", label: "Supplier", type: "link", link: "suppliers", required: true, inList: true },
    { name: "posting_date", label: "Tanggal Terima", type: "date", required: true, inList: true, default: today },
    { name: "supplier_delivery_note", label: "No. Surat Jalan Supplier", type: "data" },
    { name: "purchase_order_id", label: "Purchase Order", type: "link", link: "purchase_orders", readOnly: true, inList: true },
    { name: "set_warehouse_id", label: "Gudang Terima", type: "link", link: "warehouses" },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
  ],
  child: {
    table: "purchase_receipt_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-56" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-32", fetchFrom: "standard_buying_rate" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-32" },
      { name: "warehouse_id", label: "Gudang", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "batch_no", label: "No. Batch", type: "data", width: "w-32" },
      { name: "mfg_date", label: "Tgl. Produksi", type: "date", width: "w-36" },
      { name: "expiry_date", label: "Exp.", type: "date", width: "w-36" },
      { name: "po_item_id", label: "", type: "data", readOnly: true, width: "hidden" },
    ],
  },
  makes: [{ label: "Purchase Invoice", rpc: "make_purchase_invoice", arg: "p_pr", target: "purchase_invoices" }],
};

const purchaseInvoices: DocType = {
  key: "purchase_invoices", slug: "purchase-invoice", label: "Purchase Invoice", module: "Pembelian", submittable: true,
  titleField: "name", subtitleField: "supplier_id", searchFields: ["name", "bill_no", "faktur_pajak_no"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "PURCHASE INVOICE",
  fields: [
    ...docHeader(),
    { name: "supplier_id", label: "Supplier", type: "link", link: "suppliers", required: true, inList: true },
    { name: "posting_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "due_date", label: "Jatuh Tempo", type: "date", inList: true },
    { name: "bill_no", label: "No. Invoice Supplier", type: "data" },
    { name: "faktur_pajak_no", label: "No. Faktur Pajak", type: "data" },
    { name: "purchase_receipt_id", label: "Purchase Receipt", type: "link", link: "purchase_receipts", readOnly: true },
    { name: "is_opening", label: "Invoice Saldo Awal (hutang lama)", type: "check" },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
    { name: "outstanding_amount", label: "Sisa Tagihan", type: "currency", readOnly: true, inList: true },
  ],
  child: {
    table: "purchase_invoice_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-64" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-36", fetchFrom: "standard_buying_rate" },
      { name: "discount_percent", label: "Disk %", type: "percent", width: "w-20" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-36" },
    ],
  },
  makes: [{ label: "Pembayaran", rpc: "make_payment_from_purchase_invoice", arg: "p_pi", target: "payment_entries",
            when: (d) => Number(d.outstanding_amount) > 0 }],
};

const salesOrders: DocType = {
  key: "sales_orders", slug: "sales-order", label: "Sales Order", module: "Penjualan", submittable: true,
  titleField: "name", subtitleField: "customer_id", searchFields: ["name", "po_no", "remarks"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "SALES ORDER",
  fields: [
    ...docHeader(),
    { name: "customer_id", label: "Customer", type: "link", link: "customers", required: true, inList: true },
    { name: "transaction_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "delivery_date", label: "Tgl. Kirim", type: "date" },
    { name: "po_no", label: "No. PO Customer", type: "data" },
    { name: "set_warehouse_id", label: "Gudang Asal", type: "link", link: "warehouses" },
    { name: "per_delivered", label: "% Terkirim", type: "percent", readOnly: true, inList: true },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
  ],
  child: {
    table: "sales_order_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-64" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-36", fetchFrom: "standard_selling_rate" },
      { name: "discount_percent", label: "Disk %", type: "percent", width: "w-20" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-36" },
      { name: "warehouse_id", label: "Gudang", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "delivered_qty", label: "Terkirim", type: "float", readOnly: true, width: "w-24" },
    ],
  },
  makes: [{ label: "Delivery Note", rpc: "make_delivery_note", arg: "p_so", target: "delivery_notes",
            when: (d) => Number(d.per_delivered) < 100 }],
};

const deliveryNotes: DocType = {
  key: "delivery_notes", slug: "delivery-note", label: "Delivery Note", module: "Penjualan", submittable: true,
  titleField: "name", subtitleField: "customer_id", searchFields: ["name", "vehicle_no"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "SURAT JALAN",
  fields: [
    ...docHeader(),
    { name: "customer_id", label: "Customer", type: "link", link: "customers", required: true, inList: true },
    { name: "posting_date", label: "Tanggal Kirim", type: "date", required: true, inList: true, default: today },
    { name: "sales_order_id", label: "Sales Order", type: "link", link: "sales_orders", readOnly: true, inList: true },
    { name: "set_warehouse_id", label: "Gudang Asal", type: "link", link: "warehouses" },
    { name: "vehicle_no", label: "No. Kendaraan", type: "data" },
    { name: "driver_name", label: "Nama Sopir", type: "data" },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
  ],
  child: {
    table: "delivery_note_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-56" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-32", fetchFrom: "standard_selling_rate" },
      { name: "discount_percent", label: "Disk %", type: "percent", width: "w-20" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-32" },
      { name: "warehouse_id", label: "Gudang", type: "link", link: "warehouses", width: "min-w-36" },
      { name: "batch_no", label: "Batch (kosong=FEFO)", type: "data", width: "w-36" },
      { name: "batch_allocation", label: "Alokasi Batch", type: "data", readOnly: true },
      { name: "so_item_id", label: "", type: "data", readOnly: true, width: "hidden" },
    ],
  },
  makes: [{ label: "Sales Invoice", rpc: "make_sales_invoice", arg: "p_dn", target: "sales_invoices" }],
};

const salesInvoices: DocType = {
  key: "sales_invoices", slug: "sales-invoice", label: "Sales Invoice", module: "Penjualan", submittable: true,
  titleField: "name", subtitleField: "customer_id", searchFields: ["name", "faktur_pajak_no"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "INVOICE",
  fields: [
    ...docHeader(),
    { name: "customer_id", label: "Customer", type: "link", link: "customers", required: true, inList: true },
    { name: "posting_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "due_date", label: "Jatuh Tempo", type: "date", inList: true },
    { name: "faktur_pajak_no", label: "No. Faktur Pajak", type: "data" },
    { name: "delivery_note_id", label: "Delivery Note", type: "link", link: "delivery_notes", readOnly: true },
    { name: "is_opening", label: "Invoice Saldo Awal (piutang lama)", type: "check" },
    { name: "remarks", label: "Keterangan", type: "text" },
    ...tradeTotals(),
    { name: "outstanding_amount", label: "Sisa Tagihan", type: "currency", readOnly: true, inList: true },
  ],
  child: {
    table: "sales_invoice_items", label: "Item",
    fields: [
      { name: "item_id", label: "Item", type: "link", link: "items", required: true, width: "min-w-64" },
      { name: "qty", label: "Qty", type: "float", required: true, width: "w-24" },
      { name: "rate", label: "Harga", type: "currency", width: "w-36", fetchFrom: "standard_selling_rate" },
      { name: "discount_percent", label: "Disk %", type: "percent", width: "w-20" },
      { name: "amount", label: "Jumlah", type: "currency", readOnly: true, width: "w-36" },
    ],
  },
  makes: [{ label: "Pembayaran", rpc: "make_payment_from_sales_invoice", arg: "p_si", target: "payment_entries",
            when: (d) => Number(d.outstanding_amount) > 0 }],
};

// --------------------------- AKUNTANSI --------------------------------
const ACCOUNT_TYPES = ["Kas", "Bank", "Piutang", "Persediaan", "PPN Masukan", "Aset Tetap", "Akumulasi Penyusutan",
  "Hutang", "Barang Diterima Belum Ditagih", "PPN Keluaran", "Pajak", "Ekuitas", "Ekuitas Saldo Awal",
  "Pendapatan", "HPP", "Penyesuaian Persediaan", "Beban"];

const accounts: DocType = {
  key: "accounts", slug: "account", label: "Bagan Akun", module: "Akuntansi", isMaster: true,
  titleField: "code", subtitleField: "name", linkLabel: ["code", "name"],
  searchFields: ["code", "name"], orderBy: { column: "code", ascending: true },
  fields: [
    { name: "code", label: "Kode Akun", type: "data", required: true, inList: true },
    { name: "name", label: "Nama Akun", type: "data", required: true, inList: true },
    { name: "parent_id", label: "Induk (akun grup)", type: "link", link: "accounts", inList: true, linkFilters: { is_group: true } },
    { name: "root_type", label: "Kelompok", type: "select", required: true, inList: true, default: "Beban",
      options: ["Aset", "Kewajiban", "Ekuitas", "Pendapatan", "Beban"] },
    { name: "account_type", label: "Tipe Akun", type: "select", inList: true, options: ACCOUNT_TYPES },
    { name: "is_group", label: "Akun Grup (tidak bisa diposting)", type: "check", inList: true },
    { name: "is_default", label: "Akun default untuk tipe ini", type: "check" },
    { name: "disabled", label: "Nonaktif", type: "check" },
  ],
};

const paymentEntries: DocType = {
  key: "payment_entries", slug: "payment-entry", label: "Payment Entry", module: "Akuntansi", submittable: true,
  titleField: "name", subtitleField: "payment_type", searchFields: ["name", "reference_no", "remarks"],
  orderBy: { column: "created_at", ascending: false },
  printTitle: (d) => (d.payment_type === "Terima" ? "BUKTI PENERIMAAN KAS/BANK" : d.payment_type === "Bayar" ? "BUKTI PENGELUARAN KAS/BANK" : "BUKTI TRANSFER KAS/BANK"),
  fields: [
    ...docHeader(),
    { name: "payment_type", label: "Jenis", type: "select", required: true, inList: true, default: "Terima",
      options: ["Terima", "Bayar", "Transfer Internal"] },
    { name: "posting_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "customer_id", label: "Customer", type: "link", link: "customers", inList: true, dependsOn: (d) => d.payment_type === "Terima" },
    { name: "supplier_id", label: "Supplier", type: "link", link: "suppliers", inList: true, dependsOn: (d) => d.payment_type === "Bayar" },
    { name: "paid_amount", label: "Jumlah", type: "currency", required: true, inList: true },
    { name: "paid_from_account_id", label: "Dari Akun (kosong = default)", type: "link", link: "accounts" },
    { name: "paid_to_account_id", label: "Ke Akun (kosong = default)", type: "link", link: "accounts" },
    { name: "reference_no", label: "No. Referensi / Bukti Transfer / Giro", type: "data" },
    { name: "reference_date", label: "Tgl. Referensi", type: "date" },
    { name: "remarks", label: "Keterangan", type: "text" },
    { name: "total_allocated", label: "Total Dialokasikan ke Invoice", type: "currency", readOnly: true, section: "Total" },
    { name: "unallocated_amount", label: "Belum Dialokasikan (uang muka)", type: "currency", readOnly: true },
  ],
  child: {
    table: "payment_entry_references", label: "Alokasi ke Invoice",
    fields: [
      { name: "sales_invoice_id", label: "Sales Invoice", type: "link", link: "sales_invoices", width: "min-w-48" },
      { name: "purchase_invoice_id", label: "Purchase Invoice", type: "link", link: "purchase_invoices", width: "min-w-48" },
      { name: "outstanding_amount", label: "Sisa Tagihan", type: "currency", readOnly: true, width: "w-36" },
      { name: "allocated_amount", label: "Dialokasikan", type: "currency", required: true, width: "w-40" },
    ],
  },
  actions: [{ label: "Ambil Invoice Belum Lunas", rpc: "get_outstanding_invoices", arg: "p_pe",
              when: (d) => d.payment_type !== "Transfer Internal" }],
  liveTotals: (d, rows) => {
    const alloc = rows.reduce((s, r) => s + Number(r.allocated_amount ?? 0), 0);
    return { total_allocated: alloc, unallocated_amount: Number(d.paid_amount ?? 0) - alloc };
  },
};

const journalEntries: DocType = {
  key: "journal_entries", slug: "journal-entry", label: "Journal Entry", module: "Akuntansi", submittable: true,
  titleField: "name", subtitleField: "voucher_type", searchFields: ["name", "cheque_no", "remarks"],
  orderBy: { column: "created_at", ascending: false }, printTitle: "BUKTI JURNAL",
  fields: [
    ...docHeader(),
    { name: "voucher_type", label: "Jenis Jurnal", type: "select", required: true, inList: true, default: "Jurnal Umum",
      options: ["Jurnal Umum", "Kas Masuk", "Kas Keluar", "Bank Masuk", "Bank Keluar", "Penyesuaian", "Saldo Awal"] },
    { name: "posting_date", label: "Tanggal", type: "date", required: true, inList: true, default: today },
    { name: "cheque_no", label: "No. Bukti / Cek", type: "data" },
    { name: "remarks", label: "Keterangan", type: "text", inList: true },
    { name: "total_debit", label: "Total Debit", type: "currency", readOnly: true, section: "Total", inList: true },
    { name: "total_credit", label: "Total Kredit", type: "currency", readOnly: true },
  ],
  child: {
    table: "journal_entry_accounts", label: "Akun",
    fields: [
      { name: "account_id", label: "Akun", type: "link", link: "accounts", required: true, width: "min-w-60" },
      { name: "customer_id", label: "Customer", type: "link", link: "customers", width: "min-w-40" },
      { name: "supplier_id", label: "Supplier", type: "link", link: "suppliers", width: "min-w-40" },
      { name: "debit", label: "Debit", type: "currency", width: "w-36" },
      { name: "credit", label: "Kredit", type: "currency", width: "w-36" },
      { name: "user_remark", label: "Keterangan", type: "data", width: "min-w-40" },
    ],
  },
  liveTotals: (_d, rows) => ({
    total_debit: rows.reduce((s, r) => s + Number(r.debit ?? 0), 0),
    total_credit: rows.reduce((s, r) => s + Number(r.credit ?? 0), 0),
  }),
};

export const DOCTYPES: DocType[] = [
  items, warehouses, stockEntries,
  suppliers, purchaseOrders, purchaseReceipts, purchaseInvoices,
  customers, salesOrders, deliveryNotes, salesInvoices,
  paymentEntries, journalEntries, accounts,
  uoms, itemGroups, companies,
];

export const byKey = Object.fromEntries(DOCTYPES.map((d) => [d.key, d])) as Record<string, DocType>;
export const bySlug = Object.fromEntries(DOCTYPES.map((d) => [d.slug, d])) as Record<string, DocType>;

export const docUrl = (key: string, id?: string) => `/app/${byKey[key].slug}${id ? `/${id}` : ""}`;

export function defaultsFor(fields: Field[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.name] = typeof f.default === "function" ? (f.default as () => unknown)() : f.default;
    else if (f.type === "check") out[f.name] = false;
  }
  return out;
}

// PostgREST select dengan embed label untuk field link
export function selectWithLinks(dt: DocType, onlyList = false) {
  const parts = ["*"];
  for (const f of dt.fields) {
    if (f.type !== "link" || (onlyList && !f.inList)) continue;
    const target = byKey[f.link!];
    const cols = Array.from(new Set([target.valueField ?? "id", ...(target.linkLabel ?? [target.titleField])])).join(",");
    parts.push(`${f.name}__l:${target.key}!${f.name}(${cols})`);
  }
  return parts.join(",");
}

export function linkText(dt: DocType | undefined, row: Record<string, unknown> | null | undefined) {
  if (!dt || !row) return "";
  const cols = dt.linkLabel ?? [dt.titleField];
  return cols.map((c) => row[c]).filter(Boolean).join(" · ");
}

export const MODULES: { name: DocType["module"]; reports?: { label: string; href: string; perm: string }[] }[] = [
  { name: "Stok", reports: [
    { label: "Saldo Stok", href: "/reports/stock-balance", perm: "stock_ledger" },
    { label: "Stok per Batch & Kedaluwarsa", href: "/reports/batch-stock", perm: "stock_ledger" },
    { label: "Buku Besar Stok", href: "/reports/stock-ledger", perm: "stock_ledger" },
  ] },
  { name: "Pembelian", reports: [
    { label: "Umur Hutang", href: "/reports/payable", perm: "purchase_invoices" },
  ] },
  { name: "Penjualan", reports: [
    { label: "Umur Piutang", href: "/reports/receivable", perm: "sales_invoices" },
  ] },
  { name: "Akuntansi", reports: [
    { label: "Buku Besar", href: "/reports/general-ledger", perm: "gl_entries" },
    { label: "Neraca Saldo", href: "/reports/trial-balance", perm: "gl_entries" },
    { label: "Laba Rugi", href: "/reports/profit-loss", perm: "gl_entries" },
    { label: "Neraca", href: "/reports/balance-sheet", perm: "gl_entries" },
  ] },
  { name: "Pengaturan", reports: [
    { label: "Pengguna & Role", href: "/users", perm: "users" },
    { label: "Audit Trail", href: "/audit-log", perm: "audit_log" },
  ] },
];
