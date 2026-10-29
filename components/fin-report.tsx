"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, errMsg, localISO, rupiah } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Td, Th } from "@/components/ui";

type TB = {
  account_id: string; code: string; name: string; parent_code: string | null; parent_name: string | null;
  root_type: string; account_type: string | null; opening: number; debit: number; credit: number; closing: number;
};
type Mode = "tb" | "pl" | "bs";

const iso = (d: Date) => localISO(d);
const glLink = (id: string) => `/reports/general-ledger?account=${id}`;

function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" }));
  a.download = `${name}.csv`;
  a.click();
}

export function FinReport({ mode }: { mode: Mode }) {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), 0, 1)));
  const [to, setTo] = useState(iso(now));
  const [hideZero, setHideZero] = useState(true);
  const [data, setData] = useState<TB[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("trial_balance", { p_from: mode === "bs" ? to : from, p_to: to });
      setErr(error ? errMsg(error) : "");
      setData(((data as TB[]) ?? []).map((r) => ({ ...r, opening: +r.opening, debit: +r.debit, credit: +r.credit, closing: +r.closing })));
    }, 200);
    return () => clearTimeout(t);
  }, [from, to, mode]);

  const title = mode === "tb" ? "Neraca Saldo" : mode === "pl" ? "Laba Rugi" : "Neraca";
  const sub = mode === "bs" ? `Per ${to}` : `${from} s/d ${to}`;

  return (
    <div className="pb-10">
      <PageHeader title={title} sub={sub}>
        <Button variant="outline" onClick={() => exportCsv(mode, title, data)}><Download size={14} /> Export CSV</Button>
        <Button variant="outline" onClick={() => window.print()}>Cetak</Button>
      </PageHeader>
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        {mode !== "bs" && (
          <div className="w-44"><label className="mb-1 block text-xs text-zinc-500">Dari Tanggal</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        )}
        <div className="w-44"><label className="mb-1 block text-xs text-zinc-500">{mode === "bs" ? "Per Tanggal" : "Sampai Tanggal"}</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-zinc-900" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Sembunyikan akun bersaldo nol
        </label>
      </div>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {mode === "tb" ? <TrialBalance data={data} hideZero={hideZero} />
        : mode === "pl" ? <ProfitLoss data={data} hideZero={hideZero} />
        : <BalanceSheet data={data} hideZero={hideZero} />}
    </div>
  );
}

function exportCsv(mode: Mode, title: string, data: TB[]) {
  if (mode === "tb") {
    downloadCsv(title, [["Kode", "Akun", "Saldo Awal", "Debit", "Kredit", "Saldo Akhir"],
      ...data.map((r) => [r.code, r.name, r.opening, r.debit, r.credit, r.closing])]);
  } else {
    const val = (r: TB) => (mode === "pl" ? (r.root_type === "Pendapatan" ? r.credit - r.debit : r.debit - r.credit)
      : r.root_type === "Aset" ? r.closing : -r.closing);
    const roots = mode === "pl" ? ["Pendapatan", "Beban"] : ["Aset", "Kewajiban", "Ekuitas"];
    downloadCsv(title, [["Kelompok", "Grup", "Kode", "Akun", "Nilai"],
      ...data.filter((r) => roots.includes(r.root_type)).map((r) => [r.root_type, r.parent_name ?? "", r.code, r.name, val(r)])]);
  }
}

const Dc = ({ v }: { v: number }) => <>{v > 0 ? rupiah(v) : ""}</>;

function TrialBalance({ data, hideZero }: { data: TB[]; hideZero: boolean }) {
  const rows = data.filter((r) => !hideZero || r.opening || r.debit || r.credit || r.closing);
  const sum = (f: (r: TB) => number) => rows.reduce((s, r) => s + f(r), 0);
  const ok = Math.abs(sum((r) => r.closing)) < 0.01;
  return (
    <>
      <div className="mb-3">
        <Alert kind={ok ? "success" : "error"}>{ok ? "Seimbang: total debit = total kredit." : `Tidak seimbang! Selisih ${rupiah(sum((r) => r.closing))}`}</Alert>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr><Th rowSpan={2}>Kode</Th><Th rowSpan={2}>Akun</Th>
              <Th colSpan={2} className="text-center">Saldo Awal</Th><Th colSpan={2} className="text-center">Mutasi</Th><Th colSpan={2} className="text-center">Saldo Akhir</Th></tr>
            <tr>{["Debit", "Kredit", "Debit", "Kredit", "Debit", "Kredit"].map((h, i) => <Th key={i} className="text-right">{h}</Th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account_id} className="hover:bg-zinc-50">
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td><Link href={glLink(r.account_id)} className="hover:underline">{r.name}</Link></Td>
                <Td className="text-right tabular-nums"><Dc v={r.opening} /></Td><Td className="text-right tabular-nums"><Dc v={-r.opening} /></Td>
                <Td className="text-right tabular-nums"><Dc v={r.debit} /></Td><Td className="text-right tabular-nums"><Dc v={r.credit} /></Td>
                <Td className="text-right tabular-nums"><Dc v={r.closing} /></Td><Td className="text-right tabular-nums"><Dc v={-r.closing} /></Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <Td className="bg-zinc-50" colSpan={2}>Total</Td>
              {[(r: TB) => Math.max(r.opening, 0), (r: TB) => Math.max(-r.opening, 0), (r: TB) => r.debit, (r: TB) => r.credit,
                (r: TB) => Math.max(r.closing, 0), (r: TB) => Math.max(-r.closing, 0)].map((f, i) => (
                <Td key={i} className="bg-zinc-50 text-right tabular-nums">{rupiah(sum(f))}</Td>
              ))}
            </tr>
          </tfoot>
        </table>
      </Card>
    </>
  );
}

type Line = { label: string; value: number; href?: string; code?: string; level: 0 | 1 | 2; bold?: boolean; total?: boolean; header?: boolean };

function Statement({ lines }: { lines: Line[] }) {
  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <table className="w-full">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cn(l.total && "bg-zinc-50", l.level === 0 && l.header && "bg-zinc-100")}>
              <Td className={cn(l.bold && "font-semibold", l.level === 1 && "pl-6", l.level === 2 && "pl-10")}>
                {l.code && <span className="mr-2 font-mono text-xs text-zinc-400">{l.code}</span>}
                {l.href ? <Link href={l.href} className="hover:underline">{l.label}</Link> : l.label}
              </Td>
              <Td className={cn("w-48 text-right tabular-nums", l.bold && "font-semibold", l.value < 0 && "text-red-600")}>
                {l.header ? "" : rupiah(l.value)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function group(rows: TB[], val: (r: TB) => number, hideZero: boolean): Line[] {
  const out: Line[] = [];
  const groups = new Map<string, TB[]>();
  for (const r of rows) {
    if (hideZero && Math.abs(val(r)) < 0.005) continue;
    const k = `${r.parent_code ?? ""}|${r.parent_name ?? "Lainnya"}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rs] of Array.from(groups.entries()).sort()) {
    const name = k.split("|")[1];
    out.push({ label: name, value: 0, level: 1, bold: true, header: true });
    for (const r of rs) out.push({ label: r.name, code: r.code, value: val(r), level: 2, href: glLink(r.account_id) });
    out.push({ label: `Total ${name}`, value: rs.reduce((s, r) => s + val(r), 0), level: 1, total: true });
  }
  return out;
}

function ProfitLoss({ data, hideZero }: { data: TB[]; hideZero: boolean }) {
  const lines = useMemo(() => {
    const inc = data.filter((r) => r.root_type === "Pendapatan");
    const exp = data.filter((r) => r.root_type === "Beban");
    const iv = (r: TB) => r.credit - r.debit, ev = (r: TB) => r.debit - r.credit;
    const cogs = exp.filter((r) => r.parent_code?.startsWith("5"));
    const opex = exp.filter((r) => !r.parent_code?.startsWith("5"));
    const tI = inc.reduce((s, r) => s + iv(r), 0), tC = cogs.reduce((s, r) => s + ev(r), 0), tO = opex.reduce((s, r) => s + ev(r), 0);
    const L: Line[] = [
      { label: "PENDAPATAN", value: 0, level: 0, bold: true, header: true }, ...group(inc, iv, hideZero),
      { label: "Total Pendapatan", value: tI, level: 0, bold: true, total: true },
      { label: "HARGA POKOK & PENYESUAIAN PERSEDIAAN", value: 0, level: 0, bold: true, header: true }, ...group(cogs, ev, hideZero),
      { label: "LABA KOTOR", value: tI - tC, level: 0, bold: true, total: true },
      { label: "BEBAN OPERASIONAL", value: 0, level: 0, bold: true, header: true }, ...group(opex, ev, hideZero),
      { label: "Total Beban Operasional", value: tO, level: 0, bold: true, total: true },
      { label: "LABA (RUGI) BERSIH", value: tI - tC - tO, level: 0, bold: true, total: true },
    ];
    return L;
  }, [data, hideZero]);
  return <Statement lines={lines} />;
}

function BalanceSheet({ data, hideZero }: { data: TB[]; hideZero: boolean }) {
  const { lines, ok, diff } = useMemo(() => {
    const by = (rt: string) => data.filter((r) => r.root_type === rt);
    const a = (r: TB) => r.closing, l = (r: TB) => -r.closing;
    const tA = by("Aset").reduce((s, r) => s + a(r), 0);
    const tL = by("Kewajiban").reduce((s, r) => s + l(r), 0);
    const tE = by("Ekuitas").reduce((s, r) => s + l(r), 0);
    const profit = -[...by("Pendapatan"), ...by("Beban")].reduce((s, r) => s + r.closing, 0);
    const L: Line[] = [
      { label: "ASET", value: 0, level: 0, bold: true, header: true }, ...group(by("Aset"), a, hideZero),
      { label: "TOTAL ASET", value: tA, level: 0, bold: true, total: true },
      { label: "KEWAJIBAN", value: 0, level: 0, bold: true, header: true }, ...group(by("Kewajiban"), l, hideZero),
      { label: "Total Kewajiban", value: tL, level: 0, bold: true, total: true },
      { label: "EKUITAS", value: 0, level: 0, bold: true, header: true }, ...group(by("Ekuitas"), l, hideZero),
      { label: "Laba (Rugi) Berjalan", value: profit, level: 1 },
      { label: "Total Ekuitas", value: tE + profit, level: 0, bold: true, total: true },
      { label: "TOTAL KEWAJIBAN + EKUITAS", value: tL + tE + profit, level: 0, bold: true, total: true },
    ];
    return { lines: L, ok: Math.abs(tA - tL - tE - profit) < 0.01, diff: tA - tL - tE - profit };
  }, [data, hideZero]);
  return (
    <>
      <div className="mx-auto mb-3 max-w-3xl">
        <Alert kind={ok ? "success" : "error"}>{ok ? "Seimbang: Total Aset = Kewajiban + Ekuitas." : `Tidak seimbang! Selisih ${rupiah(diff)}`}</Alert>
      </div>
      <Statement lines={lines} />
    </>
  );
}
