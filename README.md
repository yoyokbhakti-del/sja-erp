# SJA ERP — CV. Sekar Jaya Abadi

ERP ringan bergaya ERPNext: **Next.js 15 (App Router) + Tailwind + Supabase/PostgreSQL**.
Versi 0.2 berisi modul **Fondasi (RBAC + Audit Trail)**, **Stok & Gudang**, **Pembelian**, **Penjualan**, dan **Akuntansi**.
Tanggal mulai pembukuan: **29 Oktober 2026** (bisa diubah di menu Perusahaan).

## Fitur

| Modul | Isi |
|---|---|
| Fondasi | Login Supabase, role & izin per dokumen (baca/tulis/submit/cancel), Row Level Security, audit trail append-only, penomoran otomatis `PO-2026-00001` |
| Stok | Item (batch, kedaluwarsa, no. registrasi Kementan, titik reorder), Gudang (Karantina/Bahan Baku/Produk Jadi/Reject…), Stock Entry (terima/keluar/transfer), Saldo Stok, Stok per Batch, Buku Besar Stok |
| Pembelian | Supplier (+ Approved Vendor CPOHB), Purchase Order → Purchase Receipt → Purchase Invoice |
| Penjualan | Customer (+ plafon kredit), Sales Order → Delivery Note (Surat Jalan) → Sales Invoice |
| Akuntansi | Bagan Akun (COA standar Indonesia), jurnal otomatis dari setiap transaksi, Payment Entry (terima piutang / bayar hutang / transfer kas-bank, termasuk cicilan & uang muka), Journal Entry, saldo awal, kunci periode. Laporan: Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Umur Piutang, Umur Hutang. Cetak bukti kas/bank (dengan terbilang) & bukti jurnal |
| Lain-lain | Dashboard KPI, cetak dokumen (PO, Surat Jalan, Invoice, BPB), export CSV, timeline aktivitas per dokumen |

### Aturan bisnis yang dijaga di database (bukan hanya di UI)
- Siklus dokumen ala ERPNext: **Draft → Submit → Cancel**. Dokumen yang sudah submit tidak bisa diedit/dihapus; harus Cancel lalu *Amend*.
- Tidak bisa Cancel dokumen yang masih dipakai dokumen turunannya (mis. DN yang sudah ditagih).
- Stok tidak boleh minus (per gudang dan per batch).
- Pengeluaran batch otomatis **FEFO**; batch kedaluwarsa diblokir untuk pengiriman (boleh ke gudang Reject/Karantina atau pemusnahan).
- Item ber-batch wajib isi No. Batch; item ber-expiry wajib tanggal kedaluwarsa (atau dihitung dari masa simpan).
- Bahan Baku/Bahan Kemas hanya boleh dibeli dari supplier **Approved Vendor**.
- Penerimaan/pengiriman tidak boleh melebihi qty PO/SO. SO ditolak jika melebihi plafon kredit.
- Valuasi persediaan **moving average** per item+gudang.
- Semua perubahan tercatat di `audit_log` (siapa, kapan, kolom apa berubah) dan tidak bisa dihapus dari aplikasi.

### Jurnal otomatis (persediaan perpetual, seperti ERPNext)
| Dokumen | Debit | Kredit |
|---|---|---|
| Purchase Receipt | Persediaan | Barang Diterima Belum Ditagih |
| Purchase Invoice | Barang Diterima Belum Ditagih (item stok) / Beban (non-stok) + PPN Masukan | Hutang Usaha |
| Delivery Note | Harga Pokok Penjualan | Persediaan |
| Sales Invoice | Piutang Usaha | Penjualan + PPN Keluaran |
| Stock Entry | Persediaan ↔ Penyesuaian Persediaan (atau akun lawan pilihan) | |
| Payment Entry | Kas/Bank ↔ Piutang/Hutang per invoice | |

Setiap posting wajib seimbang; saldo akun Persediaan selalu sama dengan nilai stok. Cancel membuat jurnal balik.
Purchase Invoice berisi item stok harus dibuat dari Purchase Receipt. Akun default per tipe bisa diganti lewat centang
"Akun default" di Bagan Akun; akun pendapatan/beban bisa diatur per item.

### Memulai pembukuan (go-live 29 Okt 2026)
Transaksi biasa tidak boleh bertanggal sebelum tanggal mulai. Saldo lama dimasukkan lewat dokumen bertanda **Saldo Awal**
(boleh bertanggal sebelumnya, misalnya 28 Okt 2026), dengan lawan akun **3901 Ekuitas Saldo Awal**:
1. **Kas & bank** → Journal Entry jenis "Saldo Awal": Dr akun kas/bank, Cr 3901.
2. **Persediaan** → Stock Entry "Penerimaan Material" centang *Saldo Awal Persediaan*, per item/batch/gudang dengan harga pokok.
3. **Piutang per invoice** → Sales Invoice centang *Invoice Saldo Awal*, item `SALDO-AWAL`, PPN 0, isi tanggal & jatuh tempo asli.
4. **Hutang per invoice** → Purchase Invoice centang *Invoice Saldo Awal* (sama seperti di atas).
5. **Aset tetap, modal, hutang bank, dll.** → Journal Entry "Saldo Awal".
6. Cek **Neraca** per 28 Okt: Ekuitas Saldo Awal kemudian bisa dipindah ke Modal/Laba Ditahan lewat jurnal.
7. Setelah tutup buku bulanan, isi **Kunci Periode s/d Tanggal** di Perusahaan agar periode itu tidak bisa diubah.

Role baru **Staf Keuangan / Akuntansi** (`keuangan`) untuk invoice, pembayaran, jurnal, dan laporan keuangan.

## Instalasi

1. **Buat project Supabase** (supabase.com, region Singapore).
2. **Jalankan migrasi** berurutan di *SQL Editor* Supabase:
   `supabase/migrations/0001_…` s/d `0006_…`, lalu `supabase/seed.sql` (data contoh — ubah/hapus sebelum go-live).
   Atau dengan CLI: `npx supabase link --project-ref <id>` lalu `npx supabase db push`.
3. **Env**: salin `.env.example` → `.env.local`, isi URL & anon key (Project Settings → API).
4. **Jalankan**:
   ```bash
   npm install
   npm run dev        # http://localhost:3000
   ```
5. **Daftar user pertama** di halaman login → otomatis menjadi **admin**. User berikutnya otomatis "Hanya Lihat"; admin memberi role di menu *Pengguna & Role*.
   (Untuk uji cepat, matikan "Confirm email" di Supabase → Authentication → Providers → Email.)

Deploy: push ke GitHub → import di Vercel → isi 2 env var di atas.

## Struktur

```
supabase/migrations/   skema, trigger, fungsi submit/cancel, RLS (sumber kebenaran logika bisnis)
supabase/seed.sql      data awal contoh
supabase/test/         stub Supabase + skenario uji end-to-end (psql)
lib/doctypes.ts        METADATA semua dokumen (field, child table, tombol "Buat →")
components/doc-list    list view generik
components/doc-form    form generik (field, tabel item, submit/cancel/amend, aktivitas, dokumen terkait)
app/(app)/…            dashboard, laporan, pengguna, audit trail
app/print/…            format cetak
```

### Menambah modul baru (pola ERPNext "DocType")
1. Buat migrasi baru `0006_xxx.sql`: tabel induk + tabel anak (kolom `docstatus`, `status`, `name`, `parent_id`), lalu
   `select _setup_doc('tabel', 'PREFIX'); select _setup_child('tabel_items', 'tabel');` → otomatis dapat penomoran, audit, RLS, penguncian submit.
2. Tambahkan logika submit di `submit_doc` / `cancel_doc` bila dokumen menggerakkan stok.
3. Daftarkan field-nya di `lib/doctypes.ts` → list, form, filter, menu, dan cetak langsung jadi.

## Pengujian
```bash
# Postgres lokal: jalankan stub + migrasi + seed, lalu:
psql -d erp -f supabase/test/supabase_stub.sql   # sebelum migrasi
psql -d erp -f supabase/test/scenario.sql        # PO→PR→STE→SO→DN→SI, cancel, FEFO, plafon, RBAC
psql -d erp2 -f supabase/test/accounting.sql     # (DB baru) saldo awal, jurnal, pembayaran, neraca saldo, kunci periode
```
Sudah diuji: skenario SQL di atas + alur UI lengkap (login → PO → PR → Stock Entry → SO → DN → Invoice → cetak) di browser.

## Belum ada (rencana berikutnya)
- Retur, nota kredit/debit, PPh 23 pada pembayaran, rekonsiliasi bank, aset tetap & penyusutan otomatis, tutup buku tahunan
- Quality Control: inspeksi bahan masuk, status karantina → release/reject (CPOHB)
- Produksi: BOM/formula, Work Order, Batch Manufacturing Record
- Retur pembelian/penjualan, stock opname, multi satuan (konversi UOM)
- Generated types Supabase untuk type-safety penuh
