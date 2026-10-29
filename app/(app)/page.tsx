"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { docUrl } from "@/lib/doctypes";
import { number, rupiah, tanggal } from "@/lib/format";
import { Card, PageHeader, Td, Th } from "@/components/ui";
import { usePerms } from "@/components/perms";

type Summary = Record<string, number> & { sales_by_month: { month: string; total: number }[] };
type Row = Record<string, unknown>;

function Kpi({ label, value, href, tone }: { label: string; value: string; href?: string; tone?: "warn" | "bad" }) {
  const body = (
    <Card className="p-4 transition-colors hover:border-zinc-300">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Dashboard() {
  const { can } = usePerms();
  const [s, setS] = useState<Summary | null>(null);
  const [expiring, setExpiring] = useState<Row[]>([]);
  const [reorder, setReorder] = useState<Row[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.rpc("dashboard_summary").then(({ data }) => setS(data as Summary));
    sb.from("v_batch_stock").select("*").gt("qty", 0).lte("days_to_expiry", 90).order("expiry_date").limit(8)
      .then(({ data }) => setExpiring((data as Row[]) ?? []));
    sb.from("v_reorder").select("*").limit(8).then(({ data }) => setReorder((data as Row[]) ?? []));
  }, []);

  const max = Math.max(1, ...(s?.sales_by_month ?? []).map((m) => Number(m.total)));
  const shortcuts = [
    ["purchase_orders", "Purchase Order"], ["purchase_receipts", "Terima Barang"], ["stock_entries", "Stock Entry"],
    ["sales_orders", "Sales Order"], ["delivery_notes", "Surat Jalan"], ["sales_invoices", "Invoice"],
    ["payment_entries", "Pembayaran"], ["journal_entries", "Jurnal"],
  ].filter(([k]) => can(k, "write"));

  return (
    <div className="pb-10">
      <PageHeader title="Dashboard" sub={new Date().toLocaleDateString("id-ID", { dateStyle: "full" })} />

      {shortcuts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {shortcuts.map(([k, l]) => (
            <Link key={k} href={docUrl(k, "new")} className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">+ {l}</Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Nilai Persediaan" value={rupiah(s?.stock_value ?? 0)} href="/reports/stock-balance" />
        <Kpi label="Penjualan Bulan Ini" value={rupiah(s?.sales_month ?? 0)} href={docUrl("sales_invoices")} />
        <Kpi label="Piutang" value={rupiah(s?.receivable ?? 0)} href="/reports/receivable" />
        <Kpi label="Hutang" value={rupiah(s?.payable ?? 0)} href="/reports/payable" />
        <Kpi label="Saldo Kas & Bank" value={rupiah(s?.cash_balance ?? 0)} href="/reports/balance-sheet" />
        <Kpi label="Piutang Lewat Jatuh Tempo" value={rupiah(s?.overdue_receivable ?? 0)} tone={s?.overdue_receivable ? "bad" : undefined} href="/reports/receivable" />
        <Kpi label="Pembelian Bulan Ini" value={rupiah(s?.purchase_month ?? 0)} href={docUrl("purchase_invoices")} />
        <Kpi label="PO Belum Diterima" value={number(s?.po_open ?? 0)} href={docUrl("purchase_orders")} />
        <Kpi label="SO Belum Dikirim" value={number(s?.so_open ?? 0)} href={docUrl("sales_orders")} />
        <Kpi label="Batch Exp. ≤ 90 hari" value={number(s?.expiring_90 ?? 0)} tone={s?.expiring_90 ? "warn" : undefined} href="/reports/batch-stock" />
        <Kpi label="Batch Kedaluwarsa (masih ada stok)" value={number(s?.expired ?? 0)} tone={s?.expired ? "bad" : undefined} href="/reports/batch-stock" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Penjualan 6 Bulan Terakhir</h3>
          {(s?.sales_by_month ?? []).length === 0 ? <div className="py-8 text-center text-sm text-zinc-400">Belum ada invoice</div> : (
            <div className="flex h-40 items-end gap-3">
              {s!.sales_by_month.map((m) => (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div className="text-[10px] text-zinc-500">{(Number(m.total) / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt</div>
                  <div className="w-full rounded-t bg-zinc-800" style={{ height: `${(Number(m.total) / max) * 100}%` }} />
                  <div className="text-[10px] text-zinc-500">{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={14} className="text-amber-500" /> Mendekati / Lewat Kedaluwarsa</h3>
            <Link href="/reports/batch-stock" className="flex items-center gap-1 text-xs text-zinc-500 hover:underline">Semua <ArrowRight size={12} /></Link>
          </div>
          <table className="w-full">
            <thead><tr><Th>Item</Th><Th>Batch</Th><Th>Gudang</Th><Th>Exp.</Th><Th className="text-right">Qty</Th></tr></thead>
            <tbody>
              {expiring.map((r, i) => (
                <tr key={i} className={Number(r.days_to_expiry) < 0 ? "text-red-600" : ""}>
                  <Td>{String(r.item_code)}</Td><Td>{String(r.batch_no)}</Td><Td>{String(r.warehouse_code)}</Td>
                  <Td>{tanggal(r.expiry_date)}</Td><Td className="text-right tabular-nums">{number(r.qty)}</Td>
                </tr>
              ))}
              {!expiring.length && <tr><Td colSpan={5} className="py-6 text-center text-zinc-400">Aman</Td></tr>}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <h3 className="p-4 pb-2 text-sm font-semibold">Di Bawah Titik Reorder</h3>
          <table className="w-full">
            <thead><tr><Th>Kode</Th><Th>Item</Th><Th className="text-right">Stok</Th><Th className="text-right">Minimum</Th><Th>Satuan</Th></tr></thead>
            <tbody>
              {reorder.map((r) => (
                <tr key={String(r.item_id)}>
                  <Td><Link className="hover:underline" href={docUrl("items", String(r.item_id))}>{String(r.item_code)}</Link></Td>
                  <Td>{String(r.item_name)}</Td>
                  <Td className="text-right tabular-nums text-red-600">{number(r.actual_qty)}</Td>
                  <Td className="text-right tabular-nums">{number(r.min_qty)}</Td><Td>{String(r.stock_uom)}</Td>
                </tr>
              ))}
              {!reorder.length && <tr><Td colSpan={5} className="py-6 text-center text-zinc-400">Semua stok di atas minimum</Td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
