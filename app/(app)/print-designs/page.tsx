"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg, tanggal } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Td, Th } from "@/components/ui";
import { usePerms } from "@/components/perms";
import { DESIGN_DOCS, PAPERS, defaultDesign, designDocLabel, mergeDesign } from "@/lib/print-design";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function PrintDesignsPage() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const { can } = usePerms();
  const canEdit = can("print_designs", "write");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [doctype, setDoctype] = useState<string>(DESIGN_DOCS[0].key);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("print_designs").select("*").order("doctype").order("name");
    if (error) setErr(errMsg(error));
    setRows(data ?? []);
    setLoaded(true);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    const n = name.trim();
    if (!n) return setErr("Nama desain wajib diisi.");
    const hasDefault = rows.some((r) => r.doctype === doctype && r.is_default);
    const { data, error } = await sb.from("print_designs")
      .insert({ name: n, doctype, config: defaultDesign(doctype), is_default: !hasDefault })
      .select("id").single();
    if (error) return setErr(errMsg(error));
    router.push(`/print-designs/${data!.id}`);
  }

  async function duplicate(r: Row) {
    const { error } = await sb.from("print_designs")
      .insert({ name: `${r.name} (salinan)`, doctype: r.doctype, config: r.config, is_default: false });
    if (error) setErr(errMsg(error)); else { setErr(""); load(); }
  }

  async function makeDefault(r: Row) {
    const off = await sb.from("print_designs").update({ is_default: false }).eq("doctype", r.doctype).neq("id", r.id);
    if (off.error) return setErr(errMsg(off.error));
    const on = await sb.from("print_designs").update({ is_default: true }).eq("id", r.id);
    if (on.error) setErr(errMsg(on.error)); else { setErr(""); load(); }
  }

  async function remove(r: Row) {
    if (!confirm(`Hapus desain “${r.name}”?`)) return;
    const { error } = await sb.from("print_designs").delete().eq("id", r.id);
    if (error) setErr(errMsg(error)); else { setErr(""); load(); }
  }

  const shown = rows.filter((r) => !filter || r.doctype === filter);

  return (
    <div className="pb-10">
      <PageHeader title="Desain Cetakan" sub="Atur tata letak cetak grafis tiap dokumen. Dokumen tanpa desain memakai tata letak bawaan aplikasi.">
        {canEdit && <Button variant="primary" onClick={() => setAdding((v) => !v)}><Plus size={14} /> Desain Baru</Button>}
      </PageHeader>

      {err && <div className="mb-3"><Alert onClose={() => setErr("")}>{err}</Alert></div>}

      {adding && canEdit && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_260px_auto] sm:items-end">
            <label className="block text-xs text-zinc-500">Nama Desain
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Invoice - Kop Besar" autoFocus
                onKeyDown={(e) => e.key === "Enter" && create()} />
            </label>
            <label className="block text-xs text-zinc-500">Tipe Dokumen
              <select value={doctype} onChange={(e) => setDoctype(e.target.value)}
                className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm outline-none focus:border-zinc-400">
                {DESIGN_DOCS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="primary" onClick={create}>Buat &amp; Atur</Button>
              <Button variant="outline" onClick={() => setAdding(false)}>Batal</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-zinc-500">Tipe dokumen:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm outline-none">
          <option value="">Semua</option>
          {DESIGN_DOCS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr><Th>Nama Desain</Th><Th>Tipe Dokumen</Th><Th>Kertas</Th><Th>Default</Th><Th>Diubah</Th><Th className="text-right">Aksi</Th></tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const c = mergeDesign(r.doctype, r.config);
              return (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <Td><Link href={`/print-designs/${r.id}`} className="font-medium hover:underline">{r.name}</Link></Td>
                  <Td>{designDocLabel(r.doctype)}</Td>
                  <Td className="text-xs text-zinc-600">{c.paper.preset === "custom" ? "Khusus" : (PAPERS[c.paper.preset]?.label ?? "")} ({c.paper.w} × {c.paper.h} mm)</Td>
                  <Td>{r.is_default ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Default</span> : ""}</Td>
                  <Td className="text-xs text-zinc-500">{tanggal(r.updated_at)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Link href={`/print-designs/${r.id}`}><Button size="sm" variant="outline"><Pencil size={12} /> {canEdit ? "Atur" : "Lihat"}</Button></Link>
                      {canEdit && <>
                        {!r.is_default && <Button size="sm" variant="outline" title="Jadikan default" onClick={() => makeDefault(r)}><Star size={12} /></Button>}
                        <Button size="sm" variant="outline" title="Duplikat" onClick={() => duplicate(r)}><Copy size={12} /></Button>
                        <Button size="sm" variant="outline" title="Hapus" onClick={() => remove(r)}><Trash2 size={12} className="text-red-600" /></Button>
                      </>}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {loaded && shown.length === 0 && (
              <tr><Td colSpan={6} className="py-10 text-center text-zinc-500">
                Belum ada desain. {canEdit ? "Klik “Desain Baru” untuk membuatnya." : ""} Sementara itu cetak memakai tata letak bawaan.
              </Td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
