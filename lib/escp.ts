// =====================================================================
// Cetak mode teks untuk printer dot-matrix (Epson LX-310, ESC/P).
// Kertas ½ continuous form 9,5 x 5,5 inci.
//   - 12 cpi (Elite)  -> 96 kolom pada lebar cetak 8 inci
//   - 1/8 inci/baris  -> 44 baris per lembar 5,5 inci (garis kotak menyambung)
//   - tabel karakter PC437 untuk garis kotak
// Satu "lembar" = kanvas 96 x 44 karakter. Huruf tebal disimpan per sel.
// =====================================================================

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const COLS = 96;
export const LINES = 44;
const ROWS_PER_PAGE = 8;

// ------------------------------- kanvas -------------------------------
class Canvas {
  ch: string[][] = Array.from({ length: LINES }, () => Array(COLS).fill(" "));
  bold: boolean[][] = Array.from({ length: LINES }, () => Array(COLS).fill(false));
  put(r: number, c: number, text: string, b = false) {
    if (r < 0 || r >= LINES) return;
    for (let i = 0; i < text.length; i++) {
      const x = c + i;
      if (x < 0 || x >= COLS) continue;
      this.ch[r][x] = text[i];
      this.bold[r][x] = b;
    }
  }
  right(r: number, endCol: number, text: string, b = false) { this.put(r, endCol - text.length, text, b); }
  center(r: number, c: number, w: number, text: string, b = false) {
    const t = text.slice(0, w);
    this.put(r, c + Math.floor((w - t.length) / 2), t, b);
  }
}

// ----------------------------- format ---------------------------------
const idn = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const idn2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: unknown) => (v === null || v === undefined || v === "" ? "" : idn.format(Number(v)));
const n2 = (v: unknown) => idn2.format(Number(v || 0));
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v));
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};
const ascii = (s: unknown) =>
  String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, "x")
    .normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
const fit = (s: unknown, w: number, align: "l" | "r" | "c" = "l") => {
  const t = ascii(s).slice(0, w);
  if (align === "r") return t.padStart(w);
  if (align === "c") return t.padStart(Math.floor((w + t.length) / 2)).padEnd(w);
  return t.padEnd(w);
};
function wrap(s: unknown, w: number): string[] {
  const words = ascii(s).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (!cur) cur = wd;
    else if ((cur + " " + wd).length <= w) cur += " " + wd;
    else { out.push(cur); cur = wd; }
  }
  if (cur) out.push(cur);
  return out;
}

// --------------------------- garis kotak ------------------------------
type Col = { h: string; w: number; a?: "l" | "r" | "c"; v: (r: Row, i: number) => unknown };
const H = "─", V = "│";
const line = (ws: number[], l: string, m: string, r: string) => l + ws.map((w) => H.repeat(w)).join(m) + r;
const colStart = (ws: number[], i: number) => 1 + ws.slice(0, i).reduce((s, w) => s + w + 1, 0);

/** Kotak kecil menyambung di bawah satu kolom tabel (Total Kuantitas / Total Rp). */
function underBox(cv: Canvas, r: number, ws: number[], i: number, label: string, value: string) {
  const x = colStart(ws, i) - 1;           // posisi garis kiri kolom
  const w = ws[i];
  // ubah garis bawah tabel jadi sambungan ke kotak
  cv.put(r, x, "┼"); cv.put(r, x + w + 1, "┼");
  if (x === 0) cv.put(r, x, "├");
  if (x + w + 1 === COLS - 1) cv.put(r, x + w + 1, "┤");
  cv.put(r + 1, x, V); cv.put(r + 1, x + 1, fit(value, w, "r"), true); cv.put(r + 1, x + w + 1, V);
  cv.right(r + 1, x - 1, label, true);
  cv.put(r + 2, x, "└" + H.repeat(w) + "┘");
}

/** Kotak bertingkat yang menggantung langsung di garis bawah tabel, selebar kolom i0..kolom terakhir. */
function hangBox(cv: Canvas, tb: number, ws: number[], i0: number, items: [string, string, boolean][]) {
  const x = colStart(ws, i0) - 1;          // garis kiri kotak
  const xr = COLS - 1;                     // garis kanan = tepi kanan tabel
  const w = xr - x - 1;
  cv.put(tb, x, x === 0 ? "├" : "┼");
  cv.put(tb, xr, "┤");
  let y = tb + 1;
  items.forEach(([k, v, b], i) => {
    cv.right(y, x - 1, k, true);
    cv.put(y, x, V); cv.put(y, x + 1, fit(v, w, "r"), b); cv.put(y, xr, V);
    y++;
    cv.put(y++, x, (i === items.length - 1 ? "└" : "├") + H.repeat(w) + (i === items.length - 1 ? "┘" : "┤"));
  });
}

// ------------------------------- dokumen -------------------------------
export function buildPages(key: string, doc: Row, rows: Row[], company: Row): Canvas[] {
  const isPay = key === "payment_entries";
  const priced = key === "sales_invoices" || key === "purchase_orders";
  const head = ascii(company.print_name || company.name || "").toUpperCase();
  const signer = head.replace(/\bGROUP\b/, "").replace(/^(CV|PT)\.?\s*/, "").trim();
  const title =
    key === "sales_invoices" ? "INVOICE" :
    key === "delivery_notes" ? "SURAT JALAN" :
    key === "purchase_orders" ? "PURCHASE ORDER" :
    key === "purchase_receipts" ? "BUKTI PENERIMAAN BARANG" :
    doc.payment_type === "Terima" ? "BUKTI PENERIMAAN KAS/BANK" :
    doc.payment_type === "Bayar" ? "BUKTI PENGELUARAN KAS/BANK" : "BUKTI TRANSFER KAS/BANK";

  const gross = (r: Row) => Number(r.qty || 0) * Number(r.rate || 0);
  const No: Col = { h: "No", w: 3, a: "r", v: (_r, i) => i + 1 };
  const qty: Col = { h: "Kuant.", w: 8, a: "r", v: (r) => n0(r.qty) };
  const sat: Col = { h: "Sat.", w: 6, v: (r) => r.item?.stock_uom };
  const cols: Col[] = isPay ? [
    No,
    { h: "Untuk Pembayaran", w: 33, v: (r) => (r.si ?? r.pi)?.name + (r.pi?.bill_no ? ` (${r.pi.bill_no})` : "") },
    { h: "Tgl. Inv.", w: 11, v: (r) => tgl((r.si ?? r.pi)?.posting_date) },
    { h: "Jatuh Tempo", w: 11, v: (r) => tgl((r.si ?? r.pi)?.due_date) },
    { h: "Nilai Invoice", w: 15, a: "r", v: (r) => n2((r.si ?? r.pi)?.grand_total) },
    { h: "Dibayar", w: 16, a: "r", v: (r) => n2(r.allocated_amount) },
  ] : priced ? [
    No,
    { h: "Nama Barang", w: 31, v: (r) => r.item?.name },
    qty, sat,
    { h: "Harga", w: 11, a: "r", v: (r) => n0(r.rate) },
    { h: "Disk%", w: 5, a: "r", v: (r) => (Number(r.discount_percent) ? n0(r.discount_percent) : "") },
    { h: "Diskon", w: 10, a: "r", v: (r) => (Number(r.discount_percent) ? n0(gross(r) - Number(r.amount)) : "") },
    { h: "Jumlah", w: 13, a: "r", v: (r) => n0(r.amount) },
  ] : key === "delivery_notes" ? [
    No,
    { h: "Nama Barang", w: 44, v: (r) => r.item?.name },
    { h: "No. Batch", w: 29, v: (r) => r.batch_allocation || r.batch_no },
    qty, sat,
  ] : [
    No,
    { h: "Nama Barang", w: 33, v: (r) => r.item?.name },
    { h: "No. Batch", w: 16, v: (r) => r.batch_no },
    { h: "Tgl. Prod.", w: 11, v: (r) => tgl(r.mfg_date) },
    { h: "Exp.", w: 11, v: (r) => tgl(r.expiry_date) },
    qty, sat,
  ];
  const ws = cols.map((c) => c.w);
  const tableWidth = 1 + ws.reduce((s, w) => s + w + 1, 0);
  if (tableWidth !== COLS) throw new Error(`Lebar tabel ${key} = ${tableWidth}, harus ${COLS}`);

  const p = (doc.party ?? doc.cust ?? doc.supp) as Row | undefined;
  const termDays = doc.due_date && doc.posting_date
    ? Math.round((new Date(doc.due_date).getTime() - new Date(doc.posting_date).getTime()) / 86400000)
    : p?.payment_terms_days;
  const partyLabel = key === "purchase_orders" || key === "purchase_receipts" ? "Supplier"
    : isPay ? (doc.payment_type === "Bayar" ? "Dibayar ke" : "Terima dari") : "Pelanggan";
  const so = doc.sales_order_id__l ?? doc.delivery_note_id__l?.sales_order_id__l;
  const wh = (k: string) => doc[`${k}__l`]?.name;

  const leftKV: [string, string, boolean?][] = isPay ? [
    [partyLabel, p?.name ?? "-", true],
    ["Akun", doc.payment_type === "Bayar" ? `${doc.af?.code ?? ""} ${doc.af?.name ?? ""}` : `${doc.at?.code ?? ""} ${doc.at?.name ?? ""}`],
    ["Keterangan", doc.remarks ?? ""],
  ] : priced ? [
    ["Mata Uang", "Rupiah"],
    ["Kredit", `${termDays ?? 0} Hari`],
    [partyLabel, p?.name ?? "", true],
  ] : [[partyLabel, p?.name ?? "", true]];

  const rightKV: [string, string][] = ([
    ["Tanggal", tgl(doc.posting_date ?? doc.transaction_date)],
    ["No.", doc.name],
    ...(key === "sales_invoices" ? [["No. SJ", doc.delivery_note_id__l?.name], ["No. FP", doc.faktur_pajak_no], ["No. PO", so?.po_no]] : []),
    ...(key === "delivery_notes" ? [["No. SO", so?.name], ["No. PO", so?.po_no], ["Kendaraan", doc.vehicle_no], ["Sopir", doc.driver_name]] : []),
    ...(key === "purchase_orders" ? [["Tgl. Butuh", tgl(doc.schedule_date)], ["Gudang", wh("set_warehouse_id")]] : []),
    ...(key === "purchase_receipts" ? [["No. PO", doc.purchase_order_id__l?.name], ["No. SJ Supp", doc.supplier_delivery_note], ["Gudang", wh("set_warehouse_id")]] : []),
    ...(isPay ? [["No. Ref.", doc.reference_no], ["Tgl. Ref.", tgl(doc.reference_date)]] : []),
  ] as [string, unknown][]).map(([k, v]) => [k, ascii(v)]);

  const chunks: Row[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
  if (!chunks.length) chunks.push([]);

  const addrLines = wrap([company.address, company.city].filter(Boolean).join(", "), 62).slice(0, 2);
  const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const subTotal = rows.reduce((s, r) => s + gross(r), 0);

  return chunks.map((pageRows, pi) => {
    const cv = new Canvas();
    const last = pi === chunks.length - 1;

    // ---------- kop ----------
    cv.put(0, 0, head, true);
    cv.right(0, COLS, title, true);
    addrLines.forEach((l, i) => cv.put(1 + i, 0, l, true));
    if (company.phone) cv.put(1 + addrLines.length, 0, ascii(company.phone), true);
    if (doc.docstatus === 0) cv.right(2, COLS, "*** DRAFT - BELUM SAH ***", true);
    if (doc.docstatus === 2) cv.right(2, COLS, "*** DIBATALKAN ***", true);

    // ---------- data kiri ----------
    let r = 5;
    for (const [k, v, b] of leftKV) {
      cv.put(r, 0, fit(k, 11) + ": ");
      const vl = wrap(v, 45);
      cv.put(r, 13, vl[0] ?? "", !!b);
      r++;
      if (k === partyLabel && !isPay && p) {
        for (const a of wrap([p.address, p.city].filter(Boolean).join(", "), 45).slice(0, 2)) cv.put(r++, 13, a);
        if (p.npwp) cv.put(r++, 13, `NPWP : ${ascii(p.npwp)}`);
      }
    }
    // ---------- data kanan ----------
    let rr = 5;
    for (const [k, v] of [...rightKV, ["Lembar", `${pi + 1} / ${chunks.length}`] as [string, string]]) {
      cv.put(rr++, 62, fit(k, 11) + ": " + fit(v, 21));
    }

    // ---------- tabel ----------
    const t0 = 13;
    cv.put(t0, 0, line(ws, "┌", "┬", "┐"));
    cv.put(t0 + 1, 0, V + cols.map((c) => fit(c.h, c.w, c.a === "r" ? "r" : "l")).join(V) + V, true);
    cv.put(t0 + 2, 0, line(ws, "├", "┼", "┤"));
    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const row = pageRows[i];
      cv.put(t0 + 3 + i, 0, V + cols.map((c) => (row ? fit(c.v(row, pi * ROWS_PER_PAGE + i), c.w, c.a) : " ".repeat(c.w))).join(V) + V);
    }
    const tb = t0 + 3 + ROWS_PER_PAGE;          // baris garis bawah tabel
    cv.put(tb, 0, line(ws, "└", "┴", "┘"));

    if (!last) {
      cv.right(tb + 2, COLS, `Bersambung ke lembar ${pi + 2} ...`);
      return cv;
    }

    // ---------- bawah ----------
    const bottom = tb + 1;
    if (!isPay) underBox(cv, tb, ws, cols.indexOf(qty), "Total Kuantitas ", n0(totalQty));
    else underBox(cv, tb, ws, cols.length - 1, "Total Rp ", n2(doc.paid_amount));

    if (priced) {
      // kotak total menyambung langsung ke tabel (di bawah kolom Diskon + Jumlah)
      hangBox(cv, tb, ws, cols.length - 2, [
        ["Sub Total Rp", n2(subTotal), false],
        ["Diskon Rp", n2(subTotal - Number(doc.net_total || 0)), false],
        [`PPN ${n0(doc.ppn_percent)}% Rp`, n2(doc.tax_amount), false],
        ["Total Rp", n2(doc.grand_total), true],
      ]);
      // terbilang
      const words = wrap(terbilangAscii(Number(doc.grand_total || 0)), 38);
      cv.put(bottom + 3, 0, "Terbilang :", true);
      words.slice(0, 3).forEach((w, i) => cv.put(bottom + 4 + i, 0, w));
    }

    if (key === "sales_invoices") {
      cv.center(bottom + 2, 40, 17, signer, true);
      cv.put(bottom + 8, 40, "(" + " ".repeat(15) + ")");
      if (company.bank_account_no) {
        cv.put(bottom + 7, 0, "Pembayaran ditransfer ke rekening :");
        cv.put(bottom + 8, 0, head, true);
        cv.put(bottom + 9, 0, ascii([company.bank_name, company.bank_account_name].filter(Boolean).join(". ")), true);
        cv.put(bottom + 10, 0, ascii(company.bank_account_no), true);
      }
    } else if (key === "purchase_orders") {
      cv.put(bottom + 8, 0, "Cantumkan No. PO pada surat jalan & invoice. Sertakan CoA bahan baku.");
      if (doc.remarks) cv.put(bottom + 9, 0, "Ket.: " + ascii(doc.remarks).slice(0, 66));
      signs(cv, bottom + 11, ["Supplier", signer]);
    } else if (isPay) {
      const words = wrap(terbilangAscii(Number(doc.paid_amount || 0)), 60);
      cv.put(bottom + 3, 0, "Terbilang :", true);
      words.slice(0, 2).forEach((w, i) => cv.put(bottom + 4 + i, 0, w));
      signs(cv, bottom + 7, [doc.payment_type === "Bayar" ? "Penerima" : "Penyetor", "Kasir", signer]);
    } else {
      const note = key === "delivery_notes"
        ? "Barang telah diterima dalam keadaan baik dan jumlah yang benar."
        : "Bahan baku/kemas berstatus karantina sampai dinyatakan lulus QC.";
      wrap(note, 54).forEach((w, i) => cv.put(bottom + i, 0, w));
      if (doc.remarks) cv.put(bottom + 2, 0, "Ket.: " + ascii(doc.remarks).slice(0, 48));
      signs(cv, bottom + 4, key === "delivery_notes" ? ["Penerima", "Sopir", signer] : ["Pengirim", "Penerima Gudang", "QC"]);
    }
    return cv;
  });
}

function signs(cv: Canvas, r: number, labels: string[]) {
  const w = 24, gap = Math.floor((COLS - labels.length * w) / (labels.length + 1));
  labels.forEach((l, i) => {
    const x = gap + i * (w + gap);
    cv.center(r, x, w, l, true);
    cv.put(r + 6, x, "(" + " ".repeat(w - 2) + ")");
  });
}

// terbilang (salinan ringkas, tanpa huruf kapital khusus)
function terbilangAscii(n: number): string {
  const s = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  const f = (x: number): string => {
    x = Math.floor(x);
    if (x < 12) return s[x];
    if (x < 20) return `${f(x - 10)} belas`;
    if (x < 100) return `${f(x / 10)} puluh ${f(x % 10)}`;
    if (x < 200) return `seratus ${f(x - 100)}`;
    if (x < 1000) return `${f(x / 100)} ratus ${f(x % 100)}`;
    if (x < 2000) return `seribu ${f(x - 1000)}`;
    if (x < 1e6) return `${f(x / 1000)} ribu ${f(x % 1000)}`;
    if (x < 1e9) return `${f(x / 1e6)} juta ${f(x % 1e6)}`;
    if (x < 1e12) return `${f(x / 1e9)} miliar ${f(x % 1e9)}`;
    return `${f(x / 1e12)} triliun ${f(x % 1e12)}`;
  };
  const out = n === 0 ? "nol" : f(Math.abs(n));
  return (out.replace(/\s+/g, " ").trim() + " rupiah").replace(/^./, (c) => c.toUpperCase());
}

// --------------------------- keluaran ---------------------------------
// Pemetaan Unicode -> PC437
const CP437: Record<string, number> = {
  "─": 0xc4, "│": 0xb3, "┌": 0xda, "┐": 0xbf, "└": 0xc0, "┘": 0xd9,
  "├": 0xc3, "┤": 0xb4, "┬": 0xc2, "┴": 0xc1, "┼": 0xc5,
};
const ESC = 0x1b;

export type EscOpts = {
  nlq?: boolean;      // true: Near Letter Quality (tajam), false: Draft (cepat)
  dark?: boolean;     // true: cetak dobel (double-strike) supaya huruf lebih hitam
  topMm?: number;     // geser cetakan ke bawah (mm) dari posisi awal kertas
  roman?: boolean;    // huruf Roman (berkait) alih-alih Sans Serif
};

/** Byte ESC/P siap kirim ke printer Epson LX-310 (atau dot-matrix ESC/P lain). */
export function toEscP(pages: Canvas[], opts: EscOpts = {}): Uint8Array {
  const { nlq = true, dark = false, topMm = 0, roman = false } = opts;
  const out: number[] = [];
  const cmd = (...b: number[]) => out.push(...b);
  cmd(ESC, 0x40);                 // ESC @  reset
  cmd(ESC, 0x78, nlq ? 1 : 0);    // ESC x  NLQ / Draft
  cmd(ESC, 0x6b, roman ? 0 : 1);  // ESC k  huruf NLQ: 0 Roman, 1 Sans Serif
  cmd(ESC, 0x74, 1);              // ESC t 1 tabel karakter grafis (PC437)
  cmd(ESC, 0x52, 0);              // ESC R 0 karakter internasional USA
  cmd(ESC, 0x4d);                 // ESC M  12 cpi (Elite) -> 96 kolom
  cmd(ESC, 0x30);                 // ESC 0  spasi baris 1/8 inci -> 44 baris
  cmd(ESC, 0x43, LINES);          // ESC C n panjang halaman = 44 baris (5,5 inci); posisi saat ini = awal halaman
  cmd(ESC, 0x4f);                 // ESC O  tanpa lompat perforasi
  cmd(ESC, dark ? 0x47 : 0x48);   // ESC G / ESC H  double-strike on/off
  const shift = Math.max(0, Math.min(60, Math.round((topMm / 25.4) * 216)));
  pages.forEach((cv) => {
    if (shift) cmd(ESC, 0x4a, shift);  // ESC J n  maju n/216 inci
    let last = LINES - 1;
    while (last > 0 && cv.ch[last].every((c) => c === " ")) last--;
    for (let r = 0; r <= last; r++) {
      // buang spasi di akhir baris supaya lebih cepat
      let end = COLS;
      while (end > 0 && cv.ch[r][end - 1] === " ") end--;
      let bold = false;
      for (let c = 0; c < end; c++) {
        const b = cv.bold[r][c] && cv.ch[r][c] !== " ";
        if (b !== bold) { cmd(ESC, b ? 0x45 : 0x46); bold = b; }
        const ch = cv.ch[r][c];
        cmd(CP437[ch] ?? (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 0x3f));
      }
      if (bold) cmd(ESC, 0x46);
      cmd(0x0d, 0x0a);
    }
    cmd(0x0c);                    // form feed -> awal lembar berikutnya
  });
  cmd(ESC, 0x40);
  return Uint8Array.from(out);
}

/** Teks polos (untuk pratinjau/salin) */
export function toText(pages: Canvas[]) {
  return pages.map((cv) => cv.ch.map((l) => l.join("").replace(/\s+$/, "")).join("\n")).join("\n\f\n");
}

export type { Canvas };
