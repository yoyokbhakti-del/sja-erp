"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Banknote, Boxes, Factory, HandCoins, PackageX, Receipt, ShoppingCart, Truck, Wallet,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { docUrl } from "@/lib/doctypes";
import { localISO, number, rupiah, tanggal } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { usePerms } from "@/components/perms";

type Summary = Record<string, number> & { sales_by_month: { month: string; total: number }[] };
type Row = Record<string, unknown>;

const card = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";

// angka ringkas untuk kartu: 1,2 M / 350 jt / 12 rb
function ringkas(n: number) {
  const a = Math.abs(n);
  const f = (v: number, s: string) => `${(n < 0 ? -v : v).toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${s}`;
  if (a >= 1e12) return f(a / 1e12, "T");
  if (a >= 1e9) return f(a / 1e9, "M");
  if (a >= 1e6) return f(a / 1e6, "jt");
  if (a >= 1e3) return f(a / 1e3, "rb");
  return number(n);
}

function Stat({ icon: Icon, label, value, full, href, tone, chip }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value: number; full?: boolean; href: string; tone?: "bad" | "warn"; chip?: string;
}) {
  return (
    <Link href={href} className={`${card} group transition hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><Icon size={17} /></span>
        <ArrowUpRight size={15} className="text-zinc-300 transition group-hover:text-zinc-600" />
      </div>
      <div className="mt-4 text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums" title={rupiah(value)}>
        <span className="mr-1 text-sm font-medium text-zinc-400">Rp</span>{full ? number(value) : ringkas(value)}
      </div>
      {chip && (
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
          tone === "bad" ? "bg-red-100 text-red-700" : tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
          {chip}
        </span>
      )}
    </Link>
  );
}

function Alert({ label, value, href, tone }: { label: string; value: number; href: string; tone: "bad" | "warn" | "ok" }) {
  const cls = value === 0 ? "bg-emerald-50 text-emerald-700" : tone === "bad" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return (
    <Link href={href} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${cls}`}>
      <span>{label}</span><span className="text-base font-semibold tabular-nums">{number(value)}</span>
    </Link>
  );
}

export default function Dashboard() {
  const { can } = usePerms();
  const [s, setS] = useState<Summary | null>(null);
  const [expiring, setExpiring] = useState<Row[]>([]);
  const [reorder, setReorder] = useState<Row[]>([]);
  const [wo, setWo] = useState<number | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.rpc("dashboard_summary").then(({ data }) => setS(data as Summary));
    sb.from("v_batch_stock").select("*").gt("qty", 0).lte("days_to_expiry", 90).order("expiry_date").limit(6)
      .then(({ data }) => setExpiring((data as Row[]) ?? []));
    sb.from("v_reorder").select("*").limit(6).then(({ data }) => setReorder((data as Row[]) ?? []));
    const d = new Date(); const first = localISO(new Date(d.getFullYear(), d.getMonth(), 1));
    sb.from("work_orders").select("id", { count: "exact", head: true }).eq("docstatus", 1).gte("posting_date", first)
      .then(({ count, error }) => setWo(error ? null : count ?? 0));
  }, []);

  const months = s?.sales_by_month ?? [];
  const max = Math.max(1, ...months.map((m) => Number(m.total)));
  const last = months.at(-1) ? Number(months.at(-1)!.total) : 0;
  const prev = months.length > 1 ? Number(months.at(-2)!.total) : 0;
  const growth = prev > 0 ? ((last - prev) / prev) * 100 : null;

  const shortcuts = [
    ["sales_orders", "Sales Order", ShoppingCart], ["delivery_notes", "Surat Jalan", Truck], ["sales_invoices", "Invoice", Receipt],
    ["purchase_orders", "Purchase Order", ShoppingCart], ["work_orders", "Perintah Produksi", Factory],
    ["stock_reconciliations", "Stok Opname", Boxes], ["payment_entries", "Pembayaran", HandCoins],
  ] as const;
  const allowed = shortcuts.filter(([k]) => can(k, "write"));

  return (
    <div className="pb-12">
      <PageHeader title="Dashboard" sub={new Date().toLocaleDateString("id-ID", { dateStyle: "full" })} />

      {allowed.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {allowed.map(([k, l, Icon]) => (
            <Link key={k} href={docUrl(k, "new")}
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm shadow-sm transition hover:border-zinc-400">
              <Icon size={14} className="text-zinc-500" /> {l}
            </Link>
          ))}
        </div>
      )}

      {/* ---------------- bento ---------------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Hero: persediaan */}
        <div className="col-span-2 rounded-2xl bg-zinc-900 p-6 text-zinc-50 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-zinc-400"><Boxes size={16} /> Nilai Persediaan</div>
          <div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums" title={rupiah(s?.stock_value ?? 0)}>
            <span className="mr-1.5 text-lg font-medium text-zinc-400">Rp</span>{ringkas(s?.stock_value ?? 0)}
          </div>
          <div className="mt-1 text-xs text-zinc-400">{rupiah(s?.stock_value ?? 0)}</div>
          <div className="mt-6 grid grid-cols-3 gap-2 text-center">
            {([
              ["Exp. ≤ 90 hari", s?.expiring_90 ?? 0],
              ["Kedaluwarsa", s?.expired ?? 0],
              ["Di bawah minimum", reorder.length],
            ] as const).map(([l, v]) => (
              <Link key={l} href={l === "Di bawah minimum" ? "/reports/stock-balance" : "/reports/batch-stock"}
                className="rounded-xl bg-white/10 px-2 py-2 transition hover:bg-white/20">
                <div className="text-xl font-semibold tabular-nums">{number(v)}{l === "Di bawah minimum" && reorder.length >= 6 ? "+" : ""}</div>
                <div className="text-[11px] text-zinc-300">{l}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* Penjualan + grafik */}
        <div className={`${card} col-span-2`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-zinc-500">Penjualan Bulan Ini</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums" title={rupiah(s?.sales_month ?? 0)}>
                <span className="mr-1 text-base font-medium text-zinc-400">Rp</span>{ringkas(s?.sales_month ?? 0)}
              </div>
            </div>
            {growth !== null && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${growth >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {growth >= 0 ? "▲" : "▼"} {Math.abs(growth).toLocaleString("id-ID", { maximumFractionDigits: 0 })}% vs bulan lalu
              </span>
            )}
          </div>
          {months.length === 0 ? <div className="py-10 text-center text-sm text-zinc-400">Belum ada invoice</div> : (
            <div className="mt-4 flex h-28 items-end gap-2">
              {months.map((m, i) => (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={rupiah(Number(m.total))}>
                  <div className={`w-full rounded-lg ${i === months.length - 1 ? "bg-zinc-900" : "bg-zinc-200"}`}
                    style={{ height: `${Math.max(4, (Number(m.total) / max) * 100)}%` }} />
                  <div className="text-[10px] text-zinc-500">{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Stat icon={HandCoins} label="Piutang" value={s?.receivable ?? 0} href="/reports/receivable"
          chip={s?.overdue_receivable ? `Lewat tempo ${ringkas(s.overdue_receivable)}` : "Tidak ada yang lewat tempo"}
          tone={s?.overdue_receivable ? "bad" : undefined} />
        <Stat icon={Wallet} label="Hutang" value={s?.payable ?? 0} href="/reports/payable" />
        <Stat icon={Banknote} label="Saldo Kas & Bank" value={s?.cash_balance ?? 0} href="/reports/balance-sheet" />
        <Stat icon={ShoppingCart} label="Pembelian Bulan Ini" value={s?.purchase_month ?? 0} href={docUrl("purchase_invoices")} />

        {/* Perlu perhatian */}
        <div className={`${card} col-span-2`}>
          <h3 className="mb-3 text-sm font-semibold">Perlu Perhatian</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Alert label="PO belum diterima" value={s?.po_open ?? 0} href={docUrl("purchase_orders")} tone="warn" />
            <Alert label="SO belum dikirim" value={s?.so_open ?? 0} href={docUrl("sales_orders")} tone="warn" />
            <Alert label="Batch exp. ≤ 90 hari" value={s?.expiring_90 ?? 0} href="/reports/batch-stock" tone="warn" />
            <Alert label="Batch kedaluwarsa (ada stok)" value={s?.expired ?? 0} href="/reports/batch-stock" tone="bad" />
          </div>
          {wo !== null && (
            <Link href={docUrl("work_orders")} className="mt-3 flex items-center justify-between rounded-xl bg-zinc-100 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><Factory size={14} className="text-zinc-500" /> Perintah Produksi selesai bulan ini</span>
              <span className="text-base font-semibold tabular-nums">{number(wo)}</span>
            </Link>
          )}
        </div>

        {/* Kedaluwarsa */}
        <div className={`${card} col-span-2`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={15} className="text-amber-500" /> Mendekati / Lewat Kedaluwarsa</h3>
            <Link href="/reports/batch-stock" className="flex items-center gap-1 text-xs text-zinc-500 hover:underline">Semua <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-2">
            {expiring.map((r, i) => {
              const d = Number(r.days_to_expiry);
              const bad = d < 0;
              return (
                <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{String(r.item_code)} <span className="font-normal text-zinc-400">· {String(r.batch_no)}</span></div>
                    <div className="text-xs text-zinc-500">{String(r.warehouse_code)} · Exp {tanggal(r.expiry_date)} · {number(r.qty)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${bad ? "bg-red-100 text-red-700" : d <= 30 ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>
                    {bad ? `Lewat ${Math.abs(d)} hari` : `${d} hari lagi`}
                  </span>
                </div>
              );
            })}
            {!expiring.length && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-6 text-sm text-emerald-700">
                <PackageX size={16} /> Tidak ada batch yang mendekati kedaluwarsa
              </div>
            )}
          </div>
        </div>

        {/* Reorder */}
        <div className={`${card} col-span-2`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Di Bawah Titik Reorder</h3>
            <Link href="/reports/stock-balance" className="flex items-center gap-1 text-xs text-zinc-500 hover:underline">Saldo stok <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-3">
            {reorder.map((r) => {
              const pct = Math.min(100, Math.max(2, (Number(r.actual_qty) / Math.max(1, Number(r.min_qty))) * 100));
              return (
                <Link key={String(r.item_id)} href={docUrl("items", String(r.item_id))} className="block">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate"><span className="font-medium">{String(r.item_code)}</span> <span className="text-zinc-500">{String(r.item_name)}</span></span>
                    <span className="shrink-0 tabular-nums text-xs text-zinc-500">
                      <b className="text-red-600">{number(r.actual_qty)}</b> / {number(r.min_qty)} {String(r.stock_uom)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} />
                  </div>
                </Link>
              );
            })}
            {!reorder.length && <div className="rounded-xl bg-emerald-50 px-3 py-6 text-sm text-emerald-700">Semua stok di atas minimum</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
