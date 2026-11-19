"use client";
// =====================================================================
// Katalog widget Dasbor (gaya Accurate). Setiap widget mengambil datanya
// sendiri; ringkasan umum (dashboard_summary) dibagi lewat context.
// =====================================================================
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, CalendarClock, ChartColumn, Clock, Factory, FileText, HandCoins,
  Landmark, ListOrdered, NotebookPen, PackageX, Receipt, ShoppingBag, ShoppingCart, Sparkles, Trophy, Truck,
  UserRound, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { docUrl } from "@/lib/doctypes";
import { localISO, number, rupiah, tanggal } from "@/lib/format";

type Row = Record<string, unknown>;
export type Summary = Record<string, number> & { sales_by_month: { month: string; total: number }[] };
export type Size = "S" | "M" | "L";
export type WidgetInst = { id: string; type: string; size: Size; text?: string };

export const SummaryCtx = createContext<Summary | null>(null);
const useSummary = () => useContext(SummaryCtx);

// ---------------------------------------------------------------- utils
export function ringkas(n: number) {
  const a = Math.abs(n);
  const f = (v: number, s: string) => `${(n < 0 ? -v : v).toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${s}`;
  if (a >= 1e12) return f(a / 1e12, "T");
  if (a >= 1e9) return f(a / 1e9, "M");
  if (a >= 1e6) return f(a / 1e6, "jt");
  if (a >= 1e3) return f(a / 1e3, "rb");
  return number(n);
}
const monthStart = () => { const d = new Date(); return localISO(new Date(d.getFullYear(), d.getMonth(), 1)); };
const monthEnd = () => { const d = new Date(); return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function useQuery<T>(fn: () => PromiseLike<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    Promise.resolve(fn()).then((d) => { if (live) setData(d); }, (e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err };
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full min-h-20 items-center justify-center rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-400">{children}</div>
);
const Loading = () => <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />;
const More = ({ href, label = "Lihat semua" }: { href: string; label?: string }) => (
  <Link href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#1d5fb4] hover:underline dark:text-[#8fb6ea]">
    {label} <ArrowRight size={12} />
  </Link>
);

// ------------------------------------------------------------- widgets
function Kpi({ value, href, sub, tone }: { value: number | undefined; href: string; sub?: React.ReactNode; tone?: "bad" | "good" }) {
  if (value === undefined) return <Loading />;
  return (
    <Link href={href} className="block">
      <div className="text-[26px] font-semibold leading-tight tracking-tight tabular-nums" title={rupiah(value)}>
        <span className="mr-1 text-sm font-medium text-zinc-400">Rp</span>{ringkas(value)}
      </div>
      <div className="mt-0.5 text-xs text-zinc-400">{rupiah(value)}</div>
      {sub && (
        <div className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
          tone === "bad" ? "bg-red-100 text-red-700" : tone === "good" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{sub}</div>
      )}
    </Link>
  );
}

function SumKpi({ k, href, sub, subKey }: { k: string; href: string; sub?: string; subKey?: string }) {
  const s = useSummary();
  return <Kpi value={s?.[k] as number | undefined} href={href} sub={subKey ? (s ? `${number(s[subKey])} item aktif` : undefined) : sub} />;
}

function SalesKpi() {
  const s = useSummary();
  const m = s?.sales_by_month ?? [];
  const last = m.at(-1)?.month === localISO().slice(0, 7) ? Number(m.at(-1)!.total) : 0;
  const prevRow = m.find((x) => x.month === localISO(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7));
  const prev = prevRow ? Number(prevRow.total) : 0;
  const g = prev > 0 ? ((last - prev) / prev) * 100 : null;
  return <Kpi value={s?.sales_month} href={docUrl("sales_invoices")}
    sub={g === null ? "Bulan ini" : `${g >= 0 ? "▲" : "▼"} ${Math.abs(g).toFixed(0)}% vs bulan lalu`} tone={g === null ? undefined : g >= 0 ? "good" : "bad"} />;
}
function ReceivableKpi() {
  const s = useSummary();
  return <Kpi value={s?.receivable} href="/reports/receivable"
    sub={s ? (s.overdue_receivable ? `Lewat tempo Rp ${ringkas(s.overdue_receivable)}` : "Tidak ada yang lewat tempo") : undefined}
    tone={s?.overdue_receivable ? "bad" : "good"} />;
}

function SalesChart() {
  const s = useSummary();
  if (!s) return <Loading />;
  // 6 bulan terakhir, bulan tanpa penjualan tetap tampil
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = localISO(d).slice(0, 7);
    return { key, label: BULAN[d.getMonth()], total: Number(s.sales_by_month.find((x) => x.month === key)?.total ?? 0) };
  });
  const max = Math.max(1, ...months.map((m) => m.total));
  return (
    <div className="flex h-40 items-end gap-2 pt-2">
      {months.map((m, i) => (
        <div key={m.key} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${m.label}: ${rupiah(m.total)}`}>
          <div className="text-[10px] tabular-nums text-zinc-400 opacity-0 transition group-hover:opacity-100">{ringkas(m.total)}</div>
          <div className={`w-full max-w-12 rounded-t-md ${i === 5 ? "bg-[#1d5fb4]" : "bg-[#bcd2ee] dark:bg-[#2b4b74]"}`}
            style={{ height: `${Math.max(3, (m.total / max) * 100)}%` }} />
          <div className="text-[11px] text-zinc-500">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProfitLoss() {
  const { data, err } = useQuery(() => supabaseBrowser().rpc("trial_balance", { p_from: monthStart(), p_to: monthEnd() })
    .then(({ data, error }) => { if (error) throw error; return data as Row[]; }));
  if (err) return <Empty>Tidak ada akses laporan keuangan</Empty>;
  if (!data) return <Loading />;
  const sum = (f: (r: Row) => boolean, sign: 1 | -1) => data.filter(f).reduce((s, r) => s + sign * (Number(r.debit) - Number(r.credit)), 0);
  const income = sum((r) => r.root_type === "Pendapatan", -1);
  const hpp = sum((r) => r.root_type === "Beban" && r.account_type === "HPP", 1);
  const expense = sum((r) => r.root_type === "Beban" && r.account_type !== "HPP", 1);
  const profit = income - hpp - expense;
  const rows: [string, number, string?][] = [
    ["Pendapatan", income], ["Harga Pokok Penjualan", -hpp], ["Laba Kotor", income - hpp, "b"], ["Beban Operasional", -expense],
  ];
  return (
    <div>
      <div className="space-y-1.5 text-sm">
        {rows.map(([l, v, b]) => (
          <div key={l} className={`flex justify-between gap-3 ${b ? "border-t border-zinc-100 pt-1.5 font-medium" : "text-zinc-600"}`}>
            <span>{l}</span><span className="tabular-nums">{rupiah(v || 0)}</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2 ${profit >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        <span className="text-sm font-medium">{profit >= 0 ? "Laba Bersih" : "Rugi Bersih"}</span>
        <span className="text-lg font-semibold tabular-nums">{rupiah(Math.abs(profit))}</span>
      </div>
      <More href="/reports/profit-loss" label="Laporan Laba Rugi" />
    </div>
  );
}

function CashAccounts() {
  const { data, err } = useQuery(() => supabaseBrowser().rpc("trial_balance", { p_from: localISO(), p_to: localISO() })
    .then(({ data, error }) => { if (error) throw error; return (data as Row[]).filter((r) => r.account_type === "Kas" || r.account_type === "Bank"); }));
  if (err) return <Empty>Tidak ada akses laporan keuangan</Empty>;
  if (!data) return <Loading />;
  const total = data.reduce((s, r) => s + Number(r.closing), 0);
  return (
    <div>
      <div className="mb-2 text-2xl font-semibold tabular-nums">{rupiah(total)}</div>
      <div className="space-y-1">
        {data.map((r) => (
          <div key={String(r.account_id)} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm odd:bg-zinc-50">
            <span className="flex min-w-0 items-center gap-2">
              {r.account_type === "Bank" ? <Landmark size={14} className="shrink-0 text-zinc-400" /> : <Banknote size={14} className="shrink-0 text-zinc-400" />}
              <span className="truncate">{String(r.name)}</span>
            </span>
            <span className={`shrink-0 tabular-nums ${Number(r.closing) < 0 ? "text-red-600" : ""}`}>{rupiah(r.closing)}</span>
          </div>
        ))}
        {!data.length && <Empty>Belum ada akun kas/bank</Empty>}
      </div>
      <More href="/reports/general-ledger" label="Buku Besar" />
    </div>
  );
}

function DueList({ view, slug, party }: { view: string; slug: string; party: string }) {
  const { data, err } = useQuery(() => supabaseBrowser().from(view).select("*").order("due_date").limit(7)
    .then(({ data, error }) => { if (error) throw error; return data as Row[]; }));
  if (err) return <Empty>Tidak ada akses</Empty>;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Tidak ada {party === "Customer" ? "piutang" : "hutang"} yang belum lunas</Empty>;
  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
          <th className="pb-1 font-medium">{party}</th><th className="pb-1 font-medium">Jatuh Tempo</th><th className="pb-1 text-right font-medium">Sisa</th>
        </tr></thead>
        <tbody>
          {data.map((r) => {
            const late = Number(r.days_overdue) > 0;
            return (
              <tr key={String(r.id)} className="border-t border-zinc-100">
                <td className="max-w-0 py-1.5 pr-2">
                  <Link href={docUrl(slug, String(r.id))} className="block truncate hover:underline">{String(r.party_name)}</Link>
                  <div className="text-[11px] text-zinc-400">{String(r.name)}</div>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2">
                  <div>{tanggal(r.due_date)}</div>
                  <div className={`text-[11px] ${late ? "text-red-600" : "text-zinc-400"}`}>{late ? `Lewat ${number(r.days_overdue)} hari` : "Belum jatuh tempo"}</div>
                </td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{rupiah(r.outstanding_amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <More href={party === "Customer" ? "/reports/receivable" : "/reports/payable"} />
    </div>
  );
}

function TopList({ kind }: { kind: "customers" | "items" }) {
  const { data, err } = useQuery(async () => {
    const sb = supabaseBrowser();
    if (kind === "customers") {
      const { data, error } = await sb.from("sales_invoices").select("grand_total, customer_id, c:customers!customer_id(name)")
        .eq("docstatus", 1).gte("posting_date", monthStart()).lte("posting_date", monthEnd()).limit(2000);
      if (error) throw error;
      const m = new Map<string, { label: string; value: number; sub: string }>();
      for (const r of data as Row[]) {
        const k = String(r.customer_id);
        const e = m.get(k) ?? { label: String((r.c as Row)?.name ?? "-"), value: 0, sub: "" };
        e.value += Number(r.grand_total); m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 6);
    }
    const { data, error } = await sb.from("sales_invoice_items")
      .select("qty, amount, item_id, it:items!item_id(code,name,stock_uom), p:sales_invoices!inner(posting_date,docstatus)")
      .eq("p.docstatus", 1).gte("p.posting_date", monthStart()).lte("p.posting_date", monthEnd()).limit(5000);
    if (error) throw error;
    const m = new Map<string, { label: string; value: number; sub: string; qty: number; uom: string }>();
    for (const r of data as Row[]) {
      const it = r.it as Row | undefined;
      const k = String(r.item_id);
      const e = m.get(k) ?? { label: String(it?.name ?? "-"), value: 0, sub: "", qty: 0, uom: String(it?.stock_uom ?? "") };
      e.value += Number(r.amount); e.qty += Number(r.qty); e.sub = `${number(e.qty)} ${e.uom}`; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 6);
  }, [kind]);
  if (err) return <Empty>Tidak ada akses</Empty>;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Belum ada penjualan bulan ini</Empty>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label + i}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-4 shrink-0 text-xs font-semibold text-zinc-400">{i + 1}</span>
              <span className="truncate">{d.label}</span>
              {d.sub && <span className="shrink-0 text-xs text-zinc-400">{d.sub}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-xs font-medium">{rupiah(d.value)}</span>
          </div>
          <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-[#1d5fb4]" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentTx() {
  const { data } = useQuery(async () => {
    const sb = supabaseBrowser();
    const src: [string, string, string, LucideIcon][] = [
      ["sales_orders", "Sales Order", "transaction_date", ShoppingBag], ["delivery_notes", "Surat Jalan", "posting_date", Truck],
      ["sales_invoices", "Invoice", "posting_date", FileText], ["purchase_orders", "PO", "transaction_date", ShoppingCart],
      ["payment_entries", "Pembayaran", "posting_date", HandCoins],
    ];
    const res = await Promise.all(src.map(([t, label, , Icon]) =>
      sb.from(t).select("id,name,docstatus,created_at,grand_total:" + (t === "payment_entries" ? "paid_amount" : "grand_total"))
        .order("created_at", { ascending: false }).limit(5)
        .then(({ data }) => ((data as unknown as Row[] | null) ?? []).map((r): Row => ({ ...r, t, label, Icon })))));
    return res.flat().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  });
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Belum ada transaksi</Empty>;
  return (
    <div className="divide-y divide-zinc-100">
      {data.map((r) => {
        const Icon = r.Icon as LucideIcon;
        return (
          <Link key={`${r.t}-${r.id}`} href={docUrl(String(r.t), String(r.id))} className="flex items-center gap-3 py-2 hover:bg-zinc-50">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#eaf1fb] text-[#1d5fb4] dark:bg-zinc-100 dark:text-[#8fb6ea]"><Icon size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{String(r.name)}</span>
              <span className="text-[11px] text-zinc-400">{String(r.label)} · {new Date(String(r.created_at)).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm tabular-nums">{rupiah(r.grand_total)}</span>
              <span className={`text-[10px] font-medium ${r.docstatus === 1 ? "text-emerald-600" : r.docstatus === 2 ? "text-red-600" : "text-amber-600"}`}>
                {r.docstatus === 1 ? "Submitted" : r.docstatus === 2 ? "Dibatalkan" : "Draft"}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Attention() {
  const s = useSummary();
  if (!s) return <Loading />;
  const items: [string, number, string, "bad" | "warn"][] = [
    ["PO belum diterima", s.po_open, docUrl("purchase_orders"), "warn"],
    ["SO belum dikirim", s.so_open, docUrl("sales_orders"), "warn"],
    ["Batch exp. ≤ 90 hari", s.expiring_90, "/reports/batch-stock", "warn"],
    ["Batch kedaluwarsa (ada stok)", s.expired, "/reports/batch-stock", "bad"],
    ["Barang di bawah minimum", s.reorder_count, "/reports/stock-balance", "warn"],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map(([l, v, href, tone]) => (
        <Link key={l} href={href} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
          !v ? "bg-emerald-50 text-emerald-700" : tone === "bad" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
          <span>{l}</span><span className="text-base font-semibold tabular-nums">{number(v ?? 0)}</span>
        </Link>
      ))}
    </div>
  );
}

function Expiring() {
  const { data } = useQuery(() => supabaseBrowser().from("v_batch_stock").select("*").gt("qty", 0).lte("days_to_expiry", 90)
    .order("expiry_date").limit(6).then(({ data }) => (data as Row[]) ?? []));
  if (!data) return <Loading />;
  if (!data.length) return <Empty><PackageX size={16} className="mr-2" /> Tidak ada batch yang mendekati kedaluwarsa</Empty>;
  return (
    <div className="space-y-2">
      {data.map((r, i) => {
        const d = Number(r.days_to_expiry);
        return (
          <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{String(r.item_code)} <span className="font-normal text-zinc-400">· {String(r.batch_no)}</span></div>
              <div className="text-xs text-zinc-500">{String(r.warehouse_code)} · Exp {tanggal(r.expiry_date)} · {number(r.qty)}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${d < 0 ? "bg-red-100 text-red-700" : d <= 30 ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>
              {d < 0 ? `Lewat ${Math.abs(d)} hari` : `${d} hari lagi`}
            </span>
          </div>
        );
      })}
      <More href="/reports/batch-stock" />
    </div>
  );
}

function Reorder() {
  const { data } = useQuery(() => supabaseBrowser().from("v_reorder").select("*").limit(7).then(({ data }) => (data as Row[]) ?? []));
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Semua stok di atas minimum</Empty>;
  return (
    <div className="space-y-3">
      {data.map((r) => {
        const pct = Math.min(100, Math.max(2, (Number(r.actual_qty) / Math.max(1, Number(r.min_qty))) * 100));
        return (
          <Link key={String(r.item_id)} href={docUrl("items", String(r.item_id))} className="block">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate"><span className="font-medium">{String(r.item_code)}</span> <span className="text-zinc-500">{String(r.item_name)}</span></span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-500"><b className="text-red-600">{number(r.actual_qty)}</b> / {number(r.min_qty)} {String(r.stock_uom)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} /></div>
          </Link>
        );
      })}
      <More href="/reports/stock-balance" label="Saldo stok" />
    </div>
  );
}

function Production() {
  const { data, err } = useQuery(() => supabaseBrowser().from("work_orders").select("id,name,docstatus,posting_date")
    .order("created_at", { ascending: false }).limit(6).then(({ data, error }) => { if (error) throw error; return data as Row[]; }));
  if (err) return <Empty>Tidak ada akses produksi</Empty>;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>Belum ada perintah produksi</Empty>;
  return (
    <div className="divide-y divide-zinc-100">
      {data.map((r) => (
        <Link key={String(r.id)} href={docUrl("work_orders", String(r.id))} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-zinc-50">
          <span className="min-w-0"><span className="block truncate font-medium">{String(r.name)}</span><span className="text-[11px] text-zinc-400">{tanggal(r.posting_date)}</span></span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${r.docstatus === 1 ? "bg-emerald-100 text-emerald-700" : r.docstatus === 2 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
            {r.docstatus === 1 ? "Selesai" : r.docstatus === 2 ? "Batal" : "Draft"}
          </span>
        </Link>
      ))}
    </div>
  );
}

const SHORTCUTS: [string, string, LucideIcon][] = [
  ["sales_orders", "Sales Order", ShoppingBag], ["delivery_notes", "Surat Jalan", Truck], ["sales_invoices", "Invoice", FileText],
  ["payment_entries", "Pembayaran", HandCoins], ["purchase_orders", "Purchase Order", ShoppingCart], ["purchase_receipts", "Penerimaan Barang", Boxes],
  ["purchase_invoices", "Faktur Pembelian", Receipt], ["work_orders", "Perintah Produksi", Factory], ["customers", "Customer", UserRound],
];
function Shortcuts({ can }: { can: (k: string, a: "write") => boolean }) {
  const list = SHORTCUTS.filter(([k]) => can(k, "write"));
  if (!list.length) return <Empty>Tidak ada akses buat transaksi</Empty>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
      {list.map(([k, l, Icon]) => (
        <Link key={k} href={docUrl(k, "new")}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-100 px-2 py-3 text-center text-xs text-zinc-600 transition hover:border-[#bcd2ee] hover:bg-[#eaf1fb] hover:text-[#123d73] dark:hover:bg-zinc-100 dark:hover:text-[#8fb6ea]">
          <span className="grid size-9 place-items-center rounded-full bg-[#eaf1fb] text-[#1d5fb4] dark:bg-zinc-100 dark:text-[#8fb6ea]"><Icon size={17} /></span>
          {l}
        </Link>
      ))}
    </div>
  );
}

function Note({ w, onText, editing }: { w: WidgetInst; onText: (t: string) => void; editing: boolean }) {
  const [t, setT] = useState(w.text ?? "");
  useEffect(() => setT(w.text ?? ""), [w.text]);
  return (
    <textarea value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t !== (w.text ?? "") && onText(t)} disabled={editing}
      placeholder="Tulis catatan, pengingat, atau target di sini…"
      className="h-full min-h-28 w-full resize-none rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm outline-none focus:border-amber-400 dark:border-zinc-200 dark:bg-zinc-100" />
  );
}

// ------------------------------------------------------------- katalog
export type WidgetDef = {
  type: string; title: string; desc: string; icon: LucideIcon; size: Size; sizes: Size[];
  perm?: string; multi?: boolean; group: "Ringkasan" | "Grafik & Laporan" | "Daftar" | "Lainnya";
  render: (p: { w: WidgetInst; can: (k: string, a: "read" | "write") => boolean; setText: (t: string) => void; editing: boolean }) => React.ReactNode;
};

export const WIDGETS: WidgetDef[] = [
  { type: "shortcuts", title: "Akses Cepat", desc: "Tombol buat transaksi baru", icon: Zap, size: "L", sizes: ["M", "L"], group: "Lainnya",
    render: ({ can }) => <Shortcuts can={can} /> },
  { type: "kpi_sales", title: "Penjualan Bulan Ini", desc: "Total invoice bulan ini dan perbandingan dengan bulan lalu", icon: FileText, size: "S", sizes: ["S", "M"], perm: "sales_invoices", group: "Ringkasan",
    render: () => <SalesKpi /> },
  { type: "kpi_receivable", title: "Piutang Usaha", desc: "Sisa piutang customer dan yang lewat jatuh tempo", icon: HandCoins, size: "S", sizes: ["S", "M"], perm: "sales_invoices", group: "Ringkasan",
    render: () => <ReceivableKpi /> },
  { type: "kpi_payable", title: "Hutang Usaha", desc: "Sisa hutang ke supplier", icon: Wallet, size: "S", sizes: ["S", "M"], perm: "purchase_invoices", group: "Ringkasan",
    render: () => <SumKpi k="payable" href="/reports/payable" /> },
  { type: "kpi_cash", title: "Saldo Kas & Bank", desc: "Total saldo semua akun kas dan bank", icon: Banknote, size: "S", sizes: ["S", "M"], perm: "gl_entries", group: "Ringkasan",
    render: () => <SumKpi k="cash_balance" href="/reports/general-ledger" /> },
  { type: "kpi_purchase", title: "Pembelian Bulan Ini", desc: "Total faktur pembelian bulan ini", icon: ShoppingCart, size: "S", sizes: ["S", "M"], perm: "purchase_invoices", group: "Ringkasan",
    render: () => <SumKpi k="purchase_month" href={docUrl("purchase_invoices")} sub="Bulan ini" /> },
  { type: "kpi_stock", title: "Nilai Persediaan", desc: "Nilai seluruh stok di semua gudang", icon: Boxes, size: "S", sizes: ["S", "M"], perm: "items", group: "Ringkasan",
    render: () => <SumKpi k="stock_value" href="/reports/stock-balance" subKey="item_count" /> },
  { type: "chart_sales", title: "Grafik Penjualan", desc: "Penjualan 6 bulan terakhir", icon: ChartColumn, size: "M", sizes: ["M", "L"], perm: "sales_invoices", group: "Grafik & Laporan",
    render: () => <SalesChart /> },
  { type: "pnl", title: "Laba Rugi Bulan Ini", desc: "Pendapatan, HPP, beban, dan laba bersih bulan berjalan", icon: Sparkles, size: "M", sizes: ["S", "M", "L"], perm: "gl_entries", group: "Grafik & Laporan",
    render: () => <ProfitLoss /> },
  { type: "cash_accounts", title: "Kas & Bank per Akun", desc: "Saldo masing-masing akun kas dan bank", icon: Landmark, size: "M", sizes: ["S", "M", "L"], perm: "gl_entries", group: "Grafik & Laporan",
    render: () => <CashAccounts /> },
  { type: "ar_due", title: "Piutang Jatuh Tempo", desc: "Invoice belum lunas, urut jatuh tempo terdekat", icon: CalendarClock, size: "M", sizes: ["M", "L"], perm: "sales_invoices", group: "Daftar",
    render: () => <DueList view="v_receivable_aging" slug="sales_invoices" party="Customer" /> },
  { type: "ap_due", title: "Hutang Jatuh Tempo", desc: "Faktur pembelian belum lunas, urut jatuh tempo", icon: Clock, size: "M", sizes: ["M", "L"], perm: "purchase_invoices", group: "Daftar",
    render: () => <DueList view="v_payable_aging" slug="purchase_invoices" party="Supplier" /> },
  { type: "top_items", title: "Barang Terlaris Bulan Ini", desc: "6 barang dengan penjualan terbesar", icon: Trophy, size: "M", sizes: ["S", "M", "L"], perm: "sales_invoices", group: "Daftar",
    render: () => <TopList kind="items" /> },
  { type: "top_customers", title: "Pelanggan Teratas Bulan Ini", desc: "6 customer dengan pembelian terbesar", icon: UserRound, size: "M", sizes: ["S", "M", "L"], perm: "sales_invoices", group: "Daftar",
    render: () => <TopList kind="customers" /> },
  { type: "recent", title: "Transaksi Terbaru", desc: "SO, surat jalan, invoice, PO, dan pembayaran terakhir dibuat", icon: ListOrdered, size: "M", sizes: ["M", "L"], group: "Daftar",
    render: () => <RecentTx /> },
  { type: "attention", title: "Perlu Perhatian", desc: "PO/SO terbuka, batch kedaluwarsa, stok di bawah minimum", icon: AlertTriangle, size: "M", sizes: ["M", "L"], group: "Daftar",
    render: () => <Attention /> },
  { type: "expiring", title: "Batch Mendekati Kedaluwarsa", desc: "Batch dengan masa kedaluwarsa ≤ 90 hari", icon: CalendarClock, size: "M", sizes: ["M", "L"], perm: "items", group: "Daftar",
    render: () => <Expiring /> },
  { type: "reorder", title: "Di Bawah Titik Reorder", desc: "Barang yang stoknya di bawah minimum", icon: PackageX, size: "M", sizes: ["S", "M", "L"], perm: "items", group: "Daftar",
    render: () => <Reorder /> },
  { type: "production", title: "Perintah Produksi Terakhir", desc: "Status perintah produksi terbaru", icon: Factory, size: "M", sizes: ["S", "M", "L"], perm: "work_orders", group: "Daftar",
    render: () => <Production /> },
  { type: "note", title: "Catatan", desc: "Catatan bebas pribadi (boleh lebih dari satu)", icon: NotebookPen, size: "S", sizes: ["S", "M", "L"], multi: true, group: "Lainnya",
    render: ({ w, setText, editing }) => <Note w={w} onText={setText} editing={editing} /> },
];
export const WIDGET_BY_TYPE = Object.fromEntries(WIDGETS.map((w) => [w.type, w]));

export const DEFAULT_LAYOUT: WidgetInst[] = [
  { id: "d1", type: "shortcuts", size: "L" },
  { id: "d2", type: "kpi_sales", size: "S" }, { id: "d3", type: "kpi_receivable", size: "S" },
  { id: "d4", type: "kpi_payable", size: "S" }, { id: "d5", type: "kpi_cash", size: "S" },
  { id: "d6", type: "chart_sales", size: "M" }, { id: "d7", type: "pnl", size: "M" },
  { id: "d8", type: "ar_due", size: "M" }, { id: "d9", type: "top_items", size: "M" },
  { id: "d10", type: "attention", size: "M" }, { id: "d11", type: "expiring", size: "M" },
];
