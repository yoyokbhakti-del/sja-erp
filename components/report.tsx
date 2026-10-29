"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, errMsg, number, rupiah, tanggal, waktu } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Td, Th } from "@/components/ui";
import { LinkField } from "@/components/link-field";

type Row = Record<string, unknown>;
export type Col = { key: string; label: string; type?: "text" | "float" | "currency" | "date" | "datetime"; href?: (r: Row) => string | null; display?: (r: Row) => string; tone?: (r: Row) => string };
export type Filter =
  | { key: string; label: string; type: "link"; target: string }
  | { key: string; label: string; type: "date"; op: "gte" | "lte" }
  | { key: string; label: string; type: "search"; columns: string[] };

const fmt = (c: Col, v: unknown) =>
  c.type === "currency" ? rupiah(v) : c.type === "float" ? number(v)
  : c.type === "date" ? tanggal(v) : c.type === "datetime" ? waktu(v) : v === null || v === undefined ? "" : String(v);

export function Report({ title, source, columns, filters = [], order, initial = {}, extra, totals = [] }: {
  title: string; source: string; columns: Col[]; filters?: Filter[];
  order?: { column: string; ascending: boolean }[]; initial?: Record<string, unknown>;
  extra?: (q: any) => any; totals?: string[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const [f, setF] = useState<Record<string, unknown>>(initial);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      let q = supabaseBrowser().from(source).select("*");
      for (const fl of filters) {
        const v = f[fl.key];
        if (v === null || v === undefined || v === "") continue;
        if (fl.type === "link") q = q.eq(fl.key, v);
        if (fl.type === "date") q = fl.op === "gte" ? q.gte(fl.key.replace(/_(from|to)$/, ""), v) : q.lte(fl.key.replace(/_(from|to)$/, ""), v);
        if (fl.type === "search") q = q.or(fl.columns.map((c) => `${c}.ilike.%${String(v).replace(/[,()]/g, " ")}%`).join(","));
      }
      if (extra) q = extra(q);
      for (const o of order ?? []) q = q.order(o.column, { ascending: o.ascending });
      const { data, error } = await q.limit(2000);
      setErr(error ? errMsg(error) : "");
      setRows((data as Row[]) ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps

  function csv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const text = [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    a.download = `${title}.csv`;
    a.click();
  }

  return (
    <div className="pb-10">
      <PageHeader title={title} sub={loading ? "Memuat…" : `${rows.length} baris`}>
        <Button variant="outline" onClick={csv}><Download size={14} /> Export CSV</Button>
      </PageHeader>
      {filters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {filters.map((fl) => (
            <div key={fl.key} className="w-56">
              <label className="mb-1 block text-xs text-zinc-500">{fl.label}</label>
              {fl.type === "link" ? (
                <LinkField target={fl.target} value={f[fl.key]} label={String(f[`${fl.key}__label`] ?? "")}
                  onChange={(v, r) => setF({ ...f, [fl.key]: v, [`${fl.key}__label`]: r ? `${r.code ?? r.name}` : "" })} />
              ) : (
                <Input type={fl.type === "date" ? "date" : "text"} value={String(f[fl.key] ?? "")}
                       onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      )}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>{columns.map((c) => <Th key={c.key} className={["float", "currency"].includes(c.type ?? "") ? "text-right" : ""}>{c.label}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-zinc-50", r.is_cancelled ? "text-zinc-400 line-through" : "")}>
                {columns.map((c) => {
                  const href = c.href?.(r);
                  const v = c.display ? c.display(r) : fmt(c, r[c.key]);
                  return (
                    <Td key={c.key} className={cn(["float", "currency"].includes(c.type ?? "") && "text-right tabular-nums", c.tone?.(r))}>
                      {href ? <Link href={href} className="hover:underline">{v}</Link> : v}
                    </Td>
                  );
                })}
              </tr>
            ))}
            {!loading && !rows.length && <tr><Td colSpan={columns.length} className="py-10 text-center text-zinc-400">Tidak ada data</Td></tr>}
          </tbody>
          {totals.length > 0 && rows.length > 0 && (
            <tfoot><tr className="font-semibold">
              {columns.map((c, i) => (
                <Td key={c.key} className={cn("bg-zinc-50", ["float", "currency"].includes(c.type ?? "") && "text-right tabular-nums")}>
                  {totals.includes(c.key) ? fmt(c, rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0)) : i === 0 ? "Total" : ""}
                </Td>
              ))}
            </tr></tfoot>
          )}
        </table>
      </Card>
    </div>
  );
}
