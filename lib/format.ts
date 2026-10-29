import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export const rupiah = (v: unknown) => (v === null || v === undefined || v === "" ? "" : idr.format(Number(v)));
export const number = (v: unknown) => (v === null || v === undefined || v === "" ? "" : num.format(Number(v)));
export const tanggal = (v: unknown) =>
  v ? new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "";
export const waktu = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "";

export function statusColor(status?: string | null, docstatus?: number | null) {
  if (docstatus === 2 || status === "Dibatalkan") return "bg-red-50 text-red-700 ring-red-200";
  if (status === "Draft" || docstatus === 0) return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  if (status === "Selesai" || status === "Lunas") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status?.includes("Sebagian")) return "bg-amber-50 text-amber-700 ring-amber-200";
  if (status === "Belum Dibayar" || status?.startsWith("Menunggu")) return "bg-orange-50 text-orange-700 ring-orange-200";
  return "bg-blue-50 text-blue-700 ring-blue-200";
}

// Pesan error Postgres -> kalimat ramah
export function errMsg(e: unknown) {
  const m = (e as { message?: string })?.message ?? String(e);
  if (m.includes("row-level security")) return "Akses ditolak: Anda tidak punya izin untuk menyimpan data ini.";
  if (m.includes("duplicate key")) return "Data dengan kode/nomor yang sama sudah ada.";
  if (m.includes("violates foreign key") && m.includes("delete")) return "Data tidak bisa dihapus karena sudah dipakai di dokumen lain.";
  if (m.includes("violates foreign key")) return "Data tidak bisa dihapus/diubah karena masih dipakai dokumen lain.";
  return m;
}

// Terbilang (angka -> kata, Bahasa Indonesia) untuk kwitansi
export function terbilang(n: number): string {
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

// Tanggal lokal (WIB) format YYYY-MM-DD — jangan pakai toISOString() (UTC, bisa mundur sehari)
export const localISO = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
