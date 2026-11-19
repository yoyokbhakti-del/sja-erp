"use client";
// =====================================================================
// Upload data master dari Excel (.xlsx) atau CSV.
// - Kolom dicocokkan otomatis dari judul kolom (label/nama/alias).
// - Pratinjau + validasi sebelum disimpan.
// - Data yang sudah ada (kode sama, atau nama sama) bisa dilewati atau diperbarui.
// =====================================================================
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { DocType, Field } from "@/lib/doctypes";
import { errMsg, localISO } from "@/lib/format";
import { Alert, Button, Card, Select, Td, Th } from "@/components/ui";

type Row = Record<string, unknown>;
type Cell = string | number | boolean | Date | null | undefined;

const IMPORTABLE = new Set(["data", "text", "select", "int", "float", "currency", "percent", "check", "date"]);

/** Nama lain yang sering dipakai di file Excel. */
const ALIASES: Record<string, string[]> = {
  code: ["kode", "kodecustomer", "kodepelanggan", "kodesupplier", "kodebarang", "kodeitem", "id"],
  name: ["nama", "namacustomer", "namapelanggan", "pelanggan", "customer", "namatoko", "toko", "namasupplier", "supplier"],
  customer_group: ["grup", "group", "kelompok", "jenis", "jeniscustomer", "kategori", "tipe"],
  payment_terms_days: ["termin", "top", "terminbayar", "terminhari", "jatuhtempo", "kredit", "kredithari", "lamakredit"],
  credit_limit: ["plafon", "limit", "plafonkredit", "limitkredit", "batas kredit"],
  disabled: ["nonaktif", "tidakaktif"],
  npwp: ["npwp", "nonpwp"],
  contact_person: ["kontak", "cp", "contact", "contactperson", "pic", "namakontak"],
  phone: ["telepon", "telp", "tlp", "hp", "nohp", "notelp", "notelepon", "nowa", "wa", "whatsapp", "handphone", "phone"],
  email: ["email", "surel"],
  city: ["kota", "kabupaten", "kotakabupaten", "kab", "kotakab", "kabkota"],
  address: ["alamat", "alamatlengkap"],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
const headerOf = (f: Field) => f.label.replace(/\s*\((otomatis|0 = tanpa batas)\)\s*/i, "").trim();

function importFields(dt: DocType) {
  return dt.fields.filter((f) => IMPORTABLE.has(f.type) && (!f.readOnly || f.name === "code"));
}

function parseNum(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[^0-9,.\-]/g, "");
  if (!s) return null;
  // format Indonesia: 1.250.000,50  ->  1250000.50
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toText(v: Cell) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return localISO(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/\s+/g, " ").trim();
}

type Parsed = {
  line: number;          // nomor baris di Excel
  values: Row;           // hanya kolom yang terisi
  errors: string[];
  warnings: string[];
  match?: { id: string; code: string; by: "kode" | "nama" };
  dupInFile?: boolean;
};

function convert(fields: Field[], cols: (Field | null)[], cells: Cell[], line: number): Parsed {
  const values: Row = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  cols.forEach((f, i) => {
    if (!f) return;
    const raw = cells[i];
    if (raw === null || raw === undefined || toText(raw) === "") return;
    switch (f.type) {
      case "int": case "float": case "currency": case "percent": {
        const n = parseNum(raw);
        if (n === null) errors.push(`${headerOf(f)} bukan angka: "${toText(raw)}"`);
        else values[f.name] = f.type === "int" ? Math.round(n) : n;
        break;
      }
      case "check":
        values[f.name] = /^(1|y|ya|yes|true|x|v|benar|nonaktif)$/i.test(toText(raw));
        break;
      case "select": {
        const t = toText(raw);
        const opt = f.options?.find((o) => norm(o) === norm(t));
        if (opt) values[f.name] = opt;
        else {
          const fallback = f.options?.includes("Lainnya") ? "Lainnya" : f.options?.[0];
          values[f.name] = fallback;
          warnings.push(`${headerOf(f)} "${t}" tidak dikenal → ${fallback}`);
        }
        break;
      }
      case "date": {
        if (raw instanceof Date) values[f.name] = localISO(raw);
        else {
          const m = toText(raw).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
          values[f.name] = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : toText(raw);
        }
        break;
      }
      default:
        values[f.name] = toText(raw);
    }
  });
  for (const f of fields) {
    if (f.required && (values[f.name] === undefined || values[f.name] === "")) errors.push(`${headerOf(f)} wajib diisi`);
  }
  return { line, values, errors, warnings };
}

/** CSV sederhana (pemisah , atau ;) dengan tanda kutip. */
function parseCsv(text: string): Cell[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ";" : ",";
  const out: Cell[][] = [];
  let row: Cell[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); out.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

export function ExcelImport({ dt, onDone }: { dt: DocType; onDone: () => void }) {
  const fields = importFields(dt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [cols, setCols] = useState<(Field | null)[]>([]);
  const [heads, setHeads] = useState<string[]>([]);
  const [items, setItems] = useState<Parsed[]>([]);
  const [mode, setMode] = useState<"Lewati" | "Perbarui">("Lewati");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function reset() {
    setFileName(""); setCols([]); setHeads([]); setItems([]); setErr(""); setDone(""); setProgress("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function template() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const header = fields.map((f) => ({ value: headerOf(f) + (f.required ? " *" : ""), fontWeight: "bold" as const }));
    const sample = fields.map((f) => {
      const ex: Record<string, string | number> = {
        name: dt.key === "customers" ? "Toko Ternak Makmur" : "Contoh Nama", customer_group: "Poultry Shop",
        payment_terms_days: 30, credit_limit: 0, npwp: "01.234.567.8-614.000", contact_person: "Budi",
        phone: "081234567890", email: "", city: "Lamongan", address: "Jl. Raya Lamongan No. 5",
      };
      const v = ex[f.name] ?? (f.type === "select" ? f.options?.[0] ?? "" : "");
      return typeof v === "number" ? { value: v, type: Number } : { value: String(v), type: String };
    });
    const notes = fields.map((f) => ({
      value: f.name === "code" ? "kosongkan = otomatis"
        : f.type === "select" ? `pilih: ${f.options?.join(" / ")}`
        : f.type === "check" ? "isi Ya / kosong" : f.required ? "wajib" : "",
      type: String, fontStyle: "italic" as const, color: "#888888",
    }));
    const blob = await writeXlsxFile([header, sample, notes], {
      columns: fields.map((f) => ({ width: f.type === "text" ? 40 : f.name === "name" ? 30 : 18 })),
      sheet: dt.label,
    }).toBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Template-${dt.label}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function readFile(file: File) {
    reset();
    setFileName(file.name);
    try {
      let data: Cell[][];
      if (/\.csv$|\.txt$/i.test(file.name)) data = parseCsv(await file.text());
      else if (/\.xls$/i.test(file.name)) throw new Error("File .xls (Excel lama) belum didukung. Buka di Excel lalu Simpan Sebagai .xlsx atau CSV.");
      else {
        const { readSheet } = await import("read-excel-file/browser");
        data = (await readSheet(file)) as Cell[][];
      }
      // cari baris judul: baris pertama (dari 10 teratas) yang paling banyak kolom dikenali
      const lookup = new Map<string, Field>();
      for (const f of fields) {
        for (const k of [f.name, f.label, headerOf(f), ...(ALIASES[f.name] ?? [])]) lookup.set(norm(k), f);
      }
      let hi = -1, best = 0;
      data.slice(0, 10).forEach((r, i) => {
        const n = r.filter((c) => lookup.has(norm(c))).length;
        if (n > best) { best = n; hi = i; }
      });
      if (hi < 0) throw new Error(`Judul kolom tidak dikenali. Baris judul harus berisi misalnya: ${fields.slice(0, 4).map(headerOf).join(", ")}. Unduh template untuk contoh.`);
      const hdr = data[hi].map((c) => toText(c));
      const used = new Set<string>();
      const map = hdr.map((h) => {
        const f = lookup.get(norm(h.replace(/\*$/, "")));
        if (!f || used.has(f.name)) return null;
        used.add(f.name);
        return f;
      });
      if (!map.some((f) => f?.name === "name")) throw new Error("Kolom Nama tidak ditemukan di file.");

      const body = data.slice(hi + 1)
        .map((cells, i) => ({ cells, line: hi + i + 2 }))
        .filter(({ cells }) => cells.some((c) => toText(c) !== ""))
        // abaikan baris keterangan template
        .filter(({ cells }) => !cells.some((c) => /^(kosongkan = otomatis|pilih: )/.test(toText(c))));
      const parsed = body.map(({ cells, line }) => convert(fields, map, cells, line));

      // cocokkan dengan data yang sudah ada
      setProgress("Memeriksa data yang sudah ada…");
      const sb = supabaseBrowser();
      const existing: { id: string; code: string; name: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: d, error } = await sb.from(dt.key).select("id,code,name").range(from, from + 999);
        if (error) throw error;
        existing.push(...((d ?? []) as { id: string; code: string; name: string }[]));
        if (!d || d.length < 1000) break;
      }
      const byCode = new Map(existing.map((e) => [norm(e.code), e]));
      const byName = new Map(existing.map((e) => [norm(e.name), e]));
      const seen = new Set<string>();
      for (const p of parsed) {
        const c = p.values.code ? byCode.get(norm(p.values.code)) : undefined;
        const n = byName.get(norm(p.values.name));
        if (c) p.match = { id: c.id, code: c.code, by: "kode" };
        else if (n) p.match = { id: n.id, code: n.code, by: "nama" };
        if (p.errors.length) continue;
        const k = norm(p.values.code) || norm(p.values.name);
        if (k && seen.has(k)) p.dupInFile = true;
        seen.add(k);
      }
      setCols(map); setHeads(hdr); setItems(parsed); setProgress("");
    } catch (e) {
      setProgress("");
      setErr(e instanceof Error ? e.message : errMsg(e));
    }
  }

  const valid = items.filter((p) => !p.errors.length && !p.dupInFile);
  const toInsert = valid.filter((p) => !p.match);
  const toUpdate = valid.filter((p) => p.match);
  const nErr = items.filter((p) => p.errors.length || p.dupInFile).length;

  async function save() {
    setBusy(true); setErr(""); setDone("");
    const sb = supabaseBrowser();
    let ins = 0, upd = 0;
    try {
      for (let i = 0; i < toInsert.length; i += 200) {
        setProgress(`Menyimpan data baru ${Math.min(i + 200, toInsert.length)} / ${toInsert.length}…`);
        const batch = toInsert.slice(i, i + 200).map((p) => p.values);
        const { error } = await sb.from(dt.key).insert(batch);
        if (error) throw new Error(`Baris Excel ${toInsert[i].line}–${toInsert[Math.min(i + 199, toInsert.length - 1)].line}: ${errMsg(error)}`);
        ins += batch.length;
      }
      if (mode === "Perbarui") {
        for (let i = 0; i < toUpdate.length; i++) {
          if (i % 10 === 0) setProgress(`Memperbarui ${i + 1} / ${toUpdate.length}…`);
          const p = toUpdate[i];
          const { code: _c, ...vals } = p.values; // eslint-disable-line @typescript-eslint/no-unused-vars
          const { error } = await sb.from(dt.key).update(vals).eq("id", p.match!.id);
          if (error) throw new Error(`Baris Excel ${p.line}: ${errMsg(error)}`);
          upd++;
        }
      }
      const skipped = items.length - ins - upd;
      setDone(`${ins} ${dt.label} baru ditambahkan${upd ? `, ${upd} diperbarui` : ""}${skipped ? `, ${skipped} dilewati` : ""}.`);
      setItems([]);
      onDone();
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : errMsg(e)}${ins || upd ? ` (sudah tersimpan: ${ins} baru, ${upd} diperbarui)` : ""}`);
      if (ins || upd) onDone();
    } finally { setBusy(false); setProgress(""); }
  }

  const shown = fields.filter((f) => cols.includes(f));

  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); }}><FileSpreadsheet size={14} /> Upload Excel</Button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <Card className="my-6 w-full max-w-5xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Upload {dt.label} dari Excel</h2>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}><X size={16} /></Button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
              <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14} /> Pilih file (.xlsx / .csv)</Button>
              <Button variant="outline" onClick={template}><Download size={14} /> Unduh template</Button>
              {fileName && <span className="text-zinc-500">{fileName}</span>}
            </div>

            {!items.length && !done && !err && (
              <p className="mb-3 text-sm text-zinc-500">
                Baris pertama berisi judul kolom, misalnya {fields.map(headerOf).join(", ")}.
                Urutan kolom bebas dan kolom yang tidak dikenal diabaikan. Hanya <b>Nama</b> yang wajib.
                Kode dibuat otomatis bila dikosongkan.
              </p>
            )}

            {progress && <div className="mb-3 text-sm text-zinc-500">{progress}</div>}
            {err && <div className="mb-3"><Alert onClose={() => setErr("")}>{err}</Alert></div>}
            {done && <div className="mb-3"><Alert kind="success">{done}</Alert></div>}

            {items.length > 0 && (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>Kolom dikenali: <b>{shown.map(headerOf).join(", ")}</b></span>
                  {heads.some((h, i) => h && !cols[i]) && (
                    <span className="text-zinc-500">Diabaikan: {heads.filter((h, i) => h && !cols[i]).join(", ")}</span>
                  )}
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{toInsert.length} baru</span>
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">{toUpdate.length} sudah ada</span>
                  {nErr > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">{nErr} bermasalah (dilewati)</span>}
                  {toUpdate.length > 0 && (
                    <label className="flex items-center gap-2">Data yang sudah ada:
                      <Select className="w-56" value={mode} onChange={(e) => setMode(e.target.value as "Lewati" | "Perbarui")}
                              options={["Lewati", "Perbarui"]} />
                      <span className="text-xs text-zinc-500">{mode === "Perbarui" ? "kolom yang terisi di Excel menimpa data lama" : "tidak diubah"}</span>
                    </label>
                  )}
                </div>

                <div className="max-h-[55vh] overflow-auto rounded border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                      <tr><Th>Baris</Th><Th>Status</Th>{shown.map((f) => <Th key={f.name}>{headerOf(f)}</Th>)}</tr>
                    </thead>
                    <tbody>
                      {items.map((p) => {
                        const bad = p.errors.length > 0 || p.dupInFile;
                        return (
                          <tr key={p.line} className={bad ? "bg-red-50/60 dark:bg-red-950/30" : p.match ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}>
                            <Td className="text-zinc-400">{p.line}</Td>
                            <Td className="whitespace-nowrap">
                              {bad ? <span className="text-red-600">{p.dupInFile ? "Ganda di file" : p.errors.join("; ")}</span>
                                : p.match ? <span className="text-amber-700 dark:text-amber-300">Sudah ada ({p.match.code}, cocok {p.match.by}) · {mode === "Perbarui" ? "diperbarui" : "dilewati"}</span>
                                : <span className="text-emerald-700 dark:text-emerald-300">Baru</span>}
                              {p.warnings.length > 0 && <div className="text-amber-600">{p.warnings.join("; ")}</div>}
                            </Td>
                            {shown.map((f) => (
                              <Td key={f.name} className="max-w-56 truncate">
                                {f.type === "check" ? (p.values[f.name] ? "Ya" : "") : String(p.values[f.name] ?? "")}
                              </Td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={reset}>Batal</Button>
                  <Button variant="primary" disabled={busy || (!toInsert.length && !(mode === "Perbarui" && toUpdate.length))} onClick={save}>
                    Simpan {toInsert.length} baru{mode === "Perbarui" && toUpdate.length ? ` + perbarui ${toUpdate.length}` : ""}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>,
        document.body,
      )}
    </>
  );
}
