"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { byKey, docUrl, linkText, selectWithLinks, type DocType, type Field } from "@/lib/doctypes";
import { number, rupiah, tanggal, errMsg } from "@/lib/format";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Td, Th } from "@/components/ui";
import { usePerms } from "@/components/perms";

type Row = Record<string, unknown>;
const PAGE = 50;

export function cellValue(f: Field, row: Row) {
  const v = row[f.name];
  switch (f.type) {
    case "link": return linkText(byKey[f.link!], row[`${f.name}__l`] as Row) || "";
    case "currency": return rupiah(v);
    case "float": case "int": return number(v);
    case "percent": return v === null || v === undefined ? "" : `${number(v)}%`;
    case "date": return tanggal(v);
    case "check": return v ? "✓" : "";
    default: return v === null || v === undefined ? "" : String(v);
  }
}

export function DocList({ dt }: { dt: DocType }) {
  const router = useRouter();
  const { can } = usePerms();
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const cols = dt.fields.filter((f) => f.inList);
  const key = dt.valueField ?? "id";

  async function load() {
    setLoading(true); setErr("");
    let query = supabaseBrowser().from(dt.key).select(selectWithLinks(dt, true), { count: "exact" });
    const term = q.trim().replace(/[,()]/g, " ");
    if (term) query = query.or(dt.searchFields.map((f) => `${f}.ilike.%${term}%`).join(","));
    if (status === "Draft") query = query.eq("docstatus", 0);
    else if (status === "Dibatalkan") query = query.eq("docstatus", 2);
    else if (status) query = query.eq("status", status);
    if (dt.orderBy) query = query.order(dt.orderBy.column, { ascending: dt.orderBy.ascending });
    const { data, count: c, error } = await query.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) setErr(errMsg(error));
    setRows((data as unknown as Row[]) ?? []);
    setCount(c ?? 0);
    setLoading(false);
  }

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOptions = dt.key === "purchase_orders" ? ["Menunggu Penerimaan", "Diterima Sebagian", "Selesai"]
    : dt.key === "sales_orders" ? ["Menunggu Pengiriman", "Terkirim Sebagian", "Selesai"]
    : dt.key.endsWith("invoices") ? ["Belum Dibayar"] : ["Submitted"];

  return (
    <div>
      <PageHeader title={dt.label} sub={`${count} data`}>
        <Button variant="ghost" onClick={load} title="Muat ulang"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></Button>
        {can(dt.key, "write") && (
          <Button variant="primary" onClick={() => router.push(docUrl(dt.key, "new"))}><Plus size={14} /> Tambah {dt.label}</Button>
        )}
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-72">
          <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
          <Input className="pl-8" placeholder={`Cari ${dt.searchFields.join(" / ")}…`} value={q}
                 onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        {dt.submittable && (
          <Select className="w-52" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
                  options={["", "Draft", ...statusOptions, "Dibatalkan"]} />
        )}
      </div>

      {err && <div className="mb-3"><Alert>{err}</Alert></div>}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>{cols.map((f) => <Th key={f.name} className={["currency", "float", "int", "percent"].includes(f.type) ? "text-right" : ""}>{f.label}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[key])} className="cursor-pointer hover:bg-zinc-50" onClick={() => router.push(docUrl(dt.key, String(r[key])))}>
                {cols.map((f) => (
                  <Td key={f.name} className={["currency", "float", "int", "percent"].includes(f.type) ? "text-right tabular-nums" : ""}>
                    {f.name === "status" ? <Badge status={r.status as string} docstatus={r.docstatus as number} />
                      : f.name === dt.titleField ? <Link href={docUrl(dt.key, String(r[key]))} className="font-medium hover:underline">{cellValue(f, r)}</Link>
                      : cellValue(f, r)}
                  </Td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><Td colSpan={cols.length} className="py-10 text-center text-zinc-400">Belum ada data</Td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {count > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-zinc-500">
          <span>{page * PAGE + 1}–{Math.min(count, (page + 1) * PAGE)} dari {count}</span>
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)}>›</Button>
        </div>
      )}
    </div>
  );
}
