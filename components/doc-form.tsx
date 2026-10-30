"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, Printer, Save, Send, Trash2, Undo2, Plus, X, BookOpen } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { byKey, defaultsFor, docUrl, linkText, selectWithLinks, type DocType, type Field } from "@/lib/doctypes";
import { cn, errMsg, number, rupiah, waktu } from "@/lib/format";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { LinkField } from "@/components/link-field";
import { usePerms } from "@/components/perms";

type Row = Record<string, unknown>;
const NUMERIC = ["int", "float", "currency", "percent"];
// Jumlah baris = qty x harga x (1 - diskon%), dibulatkan 2 desimal (sama dengan rumus di database)
const lineAmount = (r: Row) =>
  Math.round(Number(r.qty ?? 0) * Number(r.rate ?? r.basic_rate ?? 0) * (1 - Number(r.discount_percent ?? 0) / 100) * 100) / 100;
const ZERO_IF_EMPTY = ["float", "currency", "percent"];   // kolom angka NOT NULL: kosong = 0

function childSelect(fields: Field[]) {
  const parts = ["*"];
  for (const f of fields) {
    if (f.type !== "link") continue;
    const t = byKey[f.link!];
    const extra = f.link === "items" ? ",stock_uom,standard_buying_rate,standard_selling_rate,has_batch" : "";
    parts.push(`${f.name}__l:${t.key}!${f.name}(${t.valueField ?? "id"},${(t.linkLabel ?? [t.titleField]).join(",")}${extra})`);
  }
  return parts.join(",");
}

function FieldInput({ f, value, row, onChange, disabled }: {
  f: Field; value: unknown; row: Row; onChange: (v: unknown, linkRow?: Row | null) => void; disabled: boolean;
}) {
  const ro = disabled || f.readOnly;
  if (f.type === "link") {
    return <LinkField target={f.link!} value={value} disabled={ro} filters={f.linkFilters}
                      label={linkText(byKey[f.link!], row[`${f.name}__l`] as Row)}
                      onChange={(v, r) => onChange(v, r)} />;
  }
  if (f.type === "check") {
    return (
      <label className="flex h-8 items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value} disabled={ro} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-zinc-900" />
        {f.label}
      </label>
    );
  }
  if (f.type === "select") {
    return <Select value={String(value ?? "")} disabled={ro} options={f.required ? f.options! : ["", ...f.options!]}
                   onChange={(e) => onChange(e.target.value || null)} />;
  }
  if (f.type === "text") {
    return <Textarea value={String(value ?? "")} disabled={ro} onChange={(e) => onChange(e.target.value)} />;
  }
  if (ro && f.type === "currency") return <Input readOnly value={rupiah(value)} className="text-right tabular-nums" />;
  if (ro && NUMERIC.includes(f.type)) return <Input readOnly value={number(value)} className="text-right tabular-nums" />;
  return (
    <Input
      type={f.type === "date" ? "date" : NUMERIC.includes(f.type) ? "number" : "text"}
      step={f.type === "int" ? 1 : "any"}
      value={value === null || value === undefined ? "" : String(value)}
      readOnly={ro}
      placeholder={ro && f.type === "data" ? "Dibuat otomatis saat disimpan" : undefined}
      className={NUMERIC.includes(f.type) ? "text-right tabular-nums" : ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : NUMERIC.includes(f.type) ? Number(v) : v);
      }}
    />
  );
}

export function DocForm({ dt, id }: { dt: DocType; id: string }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const { can } = usePerms();
  const isNew = id === "new";
  const keyField = dt.valueField ?? "id";

  const [doc, setDoc] = useState<Row>(() => (isNew ? defaultsFor(dt.fields) : {}));
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [usedBy, setUsedBy] = useState<Row[] | null>(null);
  const [activity, setActivity] = useState<Row[]>([]);
  const [connections, setConnections] = useState<{ dt: DocType; rows: Row[] }[]>([]);
  const [loaded, setLoaded] = useState(isNew);

  const docstatus = Number(doc.docstatus ?? 0);
  const editable = can(dt.key, "write") && (dt.isMaster || docstatus === 0);

  const load = useCallback(async () => {
    if (isNew) return;
    const { data, error } = await sb.from(dt.key).select(selectWithLinks(dt)).eq(keyField, id).single();
    if (error) { setErr(errMsg(error)); setLoaded(true); return; }
    setDoc(data as unknown as Row);
    if (dt.child) {
      const { data: ch } = await sb.from(dt.child.table).select(childSelect(dt.child.fields)).eq("parent_id", id).order("idx");
      setRows((ch as unknown as Row[]) ?? []);
    }
    setRemoved([]); setDirty(false); setLoaded(true);

    const { data: act } = await sb.from("audit_log").select("at,user_email,action,changed")
      .eq("table_name", dt.key).eq("record_id", id).order("at", { ascending: false }).limit(20);
    setActivity((act as Row[]) ?? []);

    if (dt.makes) {
      const conns = [];
      for (const m of dt.makes) {
        const target = byKey[m.target];
        const fk = target.fields.find((f) => f.link === dt.key);
        if (!fk) continue;
        const { data: c } = await sb.from(target.key).select("id,name,status,docstatus,grand_total").eq(fk.name, id).order("created_at");
        conns.push({ dt: target, rows: (c as Row[]) ?? [] });
      }
      if (dt.key === "sales_invoices" || dt.key === "purchase_invoices") {
        const fk = dt.key === "sales_invoices" ? "sales_invoice_id" : "purchase_invoice_id";
        const { data: refs } = await sb.from("payment_entry_references")
          .select("allocated_amount, pe:payment_entries!parent_id(id,name,status,docstatus,paid_amount)").eq(fk, id);
        const pays = ((refs as Row[]) ?? []).map((r) => ({ ...(r.pe as Row), grand_total: r.allocated_amount }));
        conns.push({ dt: byKey.payment_entries, rows: pays });
      }
      setConnections(conns);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const setField = (name: string, v: unknown, linkRow?: Row | null) => {
    setDoc((d) => ({ ...d, [name]: v, ...(linkRow !== undefined ? { [`${name}__l`]: linkRow } : {}) }));
    setDirty(true);
  };

  const setCell = (i: number, f: Field, v: unknown, linkRow?: Row | null) => {
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const next: Row = { ...r, [f.name]: v };
      if (linkRow !== undefined) next[`${f.name}__l`] = linkRow;
      if (f.name === "item_id" && linkRow) {
        for (const cf of dt.child!.fields) if (cf.fetchFrom && !r[cf.name]) next[cf.name] = linkRow[cf.fetchFrom];
      }
      return next;
    }));
    setDirty(true);
  };

  const addRow = () => {
    const wh = doc.set_warehouse_id ?? null;
    const whLabel = doc.set_warehouse_id__l ?? null;
    setRows((rs) => [...rs, {
      id: crypto.randomUUID(), __new: true, qty: 1,
      ...(dt.child!.fields.some((f) => f.name === "warehouse_id") ? { warehouse_id: wh, warehouse_id__l: whLabel } : {}),
    }]);
    setDirty(true);
  };

  // Total live (sebelum disimpan) untuk dokumen jual/beli
  const live = useMemo(() => {
    if (!dt.child || docstatus !== 0) return {};
    if (dt.liveTotals) return dt.liveTotals(doc, rows);
    const qty = rows.reduce((s, r) => s + Number(r.qty ?? 0), 0);
    const amt = rows.reduce((s, r) => s + lineAmount(r), 0);
    const tax = Math.round(amt * Number(doc.ppn_percent ?? 0)) / 100;
    return { total_qty: qty, net_total: amt, tax_amount: tax, grand_total: amt + tax, total_amount: amt, outstanding_amount: amt + tax };
  }, [rows, doc, docstatus, dt]);

  function validate() {
    const missing = dt.fields.filter((f) => f.required && !f.readOnly && (doc[f.name] === null || doc[f.name] === undefined || doc[f.name] === "")
      && (!f.dependsOn || f.dependsOn(doc))).map((f) => f.label);
    if (dt.child) {
      rows.forEach((r, i) => dt.child!.fields.forEach((f) => {
        if (f.required && (r[f.name] === null || r[f.name] === undefined || r[f.name] === "")) missing.push(`Baris ${i + 1}: ${f.label}`);
      }));
    }
    if (missing.length) throw new Error(`Wajib diisi: ${missing.join(", ")}`);
  }

  async function save(): Promise<string | null> {
    setErr(""); setMsg("");
    try {
      validate();
      setBusy(true);
      const payload: Row = {};
      for (const f of dt.fields) {
        if (f.readOnly) continue;
        if (!isNew && f.name === keyField) continue;
        if (doc[f.name] !== undefined) payload[f.name] = doc[f.name] === null && ZERO_IF_EMPTY.includes(f.type) ? 0 : doc[f.name];
      }
      let docId = isNew ? null : id;
      if (isNew) {
        const { data, error } = await sb.from(dt.key).insert(payload).select(keyField).single();
        if (error) throw error;
        docId = String((data as unknown as Row)[keyField]);
      } else {
        const { error } = await sb.from(dt.key).update(payload).eq(keyField, id);
        if (error) throw error;
      }
      if (dt.child) {
        if (removed.length) {
          const { error } = await sb.from(dt.child.table).delete().in("id", removed);
          if (error) throw error;
        }
        const editableCols = dt.child.fields.filter((f) => !f.readOnly).map((f) => f.name);
        const keepCols = ["po_item_id", "so_item_id"];
        const childPayload = rows.map((r, i) => {
          const o: Row = { id: r.id, parent_id: docId, idx: i + 1 };
          for (const f of dt.child!.fields) {
            if (!editableCols.includes(f.name) && !keepCols.includes(f.name)) continue;
            // semua baris harus punya kolom yang sama (PostgREST bulk upsert mengisi kolom hilang dengan NULL)
            const v = r[f.name] === "" || r[f.name] === undefined ? null : r[f.name];
            o[f.name] = v === null && ZERO_IF_EMPTY.includes(f.type) ? 0 : v;
          }
          return o;
        });
        if (childPayload.length) {
          const { error } = await sb.from(dt.child.table).upsert(childPayload);
          if (error) throw error;
        }
      }
      setDirty(false);
      if (isNew) { router.replace(docUrl(dt.key, docId!)); }
      else { await load(); setMsg("Tersimpan"); }
      return docId;
    } catch (e) {
      setErr(errMsg(e));
      return null;
    } finally { setBusy(false); }
  }

  async function rpc(fn: string, args: Row, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return null;
    setErr(""); setMsg(""); setBusy(true);
    const { data, error } = await sb.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(errMsg(error)); return null; }
    return data ?? true;
  }

  async function submit() {
    if (dirty && !(await save())) return;
    if (await rpc("submit_doc", { p_doctype: dt.key, p_id: id },
      `Submit ${doc.name}? Setelah submit dokumen tidak bisa diubah${["stock_entries", "purchase_receipts", "delivery_notes"].includes(dt.key) ? " dan stok akan langsung bergerak" : ""}.`)) {
      await load(); setMsg("Dokumen berhasil disubmit");
    }
  }
  async function cancelDoc() {
    if (await rpc("cancel_doc", { p_doctype: dt.key, p_id: id }, `Batalkan ${doc.name}? Pergerakan stok akan dibalik.`)) {
      await load(); setMsg("Dokumen dibatalkan");
    }
  }
  async function duplicate() {
    const newId = await rpc("duplicate_doc", { p_doctype: dt.key, p_id: id });
    if (newId) router.push(docUrl(dt.key, String(newId)));
  }
  async function remove() {
    const label = String(doc[dt.titleField] ?? "");
    const extra = docstatus === 2 ? "\nDokumen batal ini akan dihapus permanen (riwayatnya tetap ada di Audit Trail)." : "";
    if (!confirm(`Hapus ${label}?${extra}`)) return;
    setErr(""); setUsedBy(null); setBusy(true);
    const { error } = await sb.from(dt.key).delete().eq(keyField, id);
    if (error && /foreign key/i.test(error.message)) {
      const { data } = await sb.rpc("where_used", { p_table: dt.key, p_id: String(doc[keyField] ?? id) });
      setBusy(false);
      setUsedBy((data as Row[]) ?? []);
      return;
    }
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(docUrl(dt.key));
  }

  if (!loaded) return <div className="p-10 text-center text-sm text-zinc-400">Memuat…</div>;

  // Kelompokkan field per section
  const sections: { title?: string; fields: Field[] }[] = [{ fields: [] }];
  for (const f of dt.fields) {
    if (f.section) sections.push({ title: f.section, fields: [] });
    sections[sections.length - 1].fields.push(f);
  }
  // Pada dokumen transaksi, "name" = nomor dokumen otomatis -> disembunyikan saat baru. Pada master, "name" = nama yang wajib diisi.
  const visible = (f: Field) => (!f.dependsOn || f.dependsOn(doc)) && !(isNew && dt.submittable && (f.name === "name" || f.name === "status"));
  const valueOf = (f: Field) => (f.name in live && docstatus === 0 ? (live as Row)[f.name] : doc[f.name]);

  const title = isNew ? `${dt.label} Baru` : String(doc[dt.titleField] ?? "");
  return (
    <div className="pb-16">
      <PageHeader
        title={<span className="flex items-center gap-2">{title}
          {dt.submittable && !isNew && <Badge status={doc.status as string} docstatus={docstatus} />}
          {dirty && <span className="rounded bg-amber-100 px-1.5 text-xs font-normal text-amber-800">Belum disimpan</span>}</span>}
        sub={<Link href={docUrl(dt.key)} className="hover:underline">{dt.label}</Link>}>
        {!isNew && dt.submittable && (
          <Link href={`/print/${dt.slug}/${id}`} target="_blank"><Button variant="outline"><Printer size={14} /> Cetak</Button></Link>
        )}
        {!isNew && ["stock_entries", "purchase_receipts", "delivery_notes"].includes(dt.key) && docstatus > 0 && (
          <Link href={`/reports/stock-ledger?voucher=${id}`}><Button variant="outline"><BookOpen size={14} /> Ledger</Button></Link>
        )}
        {!isNew && docstatus > 0 && !["purchase_orders", "sales_orders"].includes(dt.key) && dt.submittable && (
          <Link href={`/reports/general-ledger?voucher=${id}`}><Button variant="outline">Jurnal</Button></Link>
        )}
        {!isNew && can(dt.key, "write") && (!dt.submittable || docstatus !== 1) && (
          <Button variant="ghost" onClick={remove} disabled={busy} title="Hapus"><Trash2 size={14} /></Button>
        )}
        {!isNew && dt.submittable && docstatus === 2 && can(dt.key, "write") && (
          <Button variant="outline" onClick={duplicate} disabled={busy}><Copy size={14} /> Amend / Duplikat</Button>
        )}
        {docstatus === 1 && dt.makes?.filter((m) => !m.when || m.when(doc)).map((m) => can(m.target, "write") && (
          <Button key={m.rpc} variant="outline" disabled={busy} onClick={async () => {
            const newId = await rpc(m.rpc, { [m.arg]: id });
            if (newId) router.push(docUrl(m.target, String(newId)));
          }}>Buat {m.label} <ArrowRight size={14} /></Button>
        ))}
        {!isNew && docstatus === 0 && editable && dt.actions?.filter((a) => !a.when || a.when(doc)).map((a) => (
          <Button key={a.rpc} variant="outline" disabled={busy} onClick={async () => {
            if (dirty && !(await save())) return;
            if (await rpc(a.rpc, { [a.arg]: id })) { await load(); setMsg(`${a.label}: selesai`); }
          }}>{a.label}</Button>
        ))}
        {docstatus === 1 && can(dt.key, "cancel") && (
          <Button variant="outline" onClick={cancelDoc} disabled={busy}><Undo2 size={14} /> Cancel</Button>
        )}
        {editable && (dirty || isNew || !dt.submittable) && (
          <Button variant="primary" onClick={save} disabled={busy}><Save size={14} /> Simpan</Button>
        )}
        {!isNew && dt.submittable && docstatus === 0 && !dirty && can(dt.key, "submit") && (
          <Button variant="primary" onClick={submit} disabled={busy}><Send size={14} /> Submit</Button>
        )}
      </PageHeader>

      <div className="space-y-3">
        {err && <Alert onClose={() => setErr("")}>{err}</Alert>}
        {usedBy && (
          <Alert onClose={() => setUsedBy(null)}>
            <b>{String(doc[dt.titleField] ?? "")} tidak bisa dihapus karena masih dipakai di:</b>
            <ul className="mt-1 list-disc pl-5">
              {usedBy.map((u, i) => {
                const target = byKey[String(u.doctype)];
                const isHist = !target;
                return (
                  <li key={i}>
                    {isHist ? <>{String(u.doctype)} ({String(u.doc_name)})</> : (
                      <><span className="text-red-900/70">{target.label}</span>{" "}
                        <Link className="font-medium underline" href={`${docUrl(target.key)}?q=${encodeURIComponent(String(u.doc_name))}`}>{String(u.doc_name)}</Link>
                        {u.status ? <> ({String(u.status)})</> : null}</>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-2">
              {usedBy.some((u) => !byKey[String(u.doctype)] || ["Submitted", "Selesai", "Lunas", "Dibayar Sebagian", "Belum Dibayar", "Menunggu Penerimaan", "Menunggu Pengiriman", "Diterima Sebagian", "Terkirim Sebagian"].includes(String(u.status)))
                ? <>Data ini sudah dipakai di transaksi yang sah, jadi tidak boleh dihapus.{dt.fields.some((f) => f.name === "disabled") && <> Centang <b>Nonaktif</b> lalu Simpan supaya tidak muncul lagi di pilihan.</>}</>
                : <>Hapus dulu dokumen Draft/Dibatalkan di atas (buka dokumennya → ikon tempat sampah), lalu coba hapus lagi.</>}
            </div>
          </Alert>
        )}
        {msg && <Alert kind="success" onClose={() => setMsg("")}>{msg}</Alert>}
        {docstatus === 2 && <Alert kind="info">Dokumen ini sudah dibatalkan. Gunakan “Amend / Duplikat” untuk membuat versi baru.</Alert>}

        {sections.map((s, si) => {
          const fs = s.fields.filter(visible);
          if (!fs.length) return null;
          const isTotals = s.title === "Total";
          return (
            <div key={si}>
              {isTotals && dt.child && (
                <ChildTable dt={dt} rows={rows} editable={editable}
                  onCell={setCell} onAdd={addRow}
                  onRemove={(i) => { const r = rows[i]; if (!r.__new) setRemoved((x) => [...x, String(r.id)]); setRows(rows.filter((_, j) => j !== i)); setDirty(true); }} />
              )}
              <Card className={cn("p-4", isTotals && dt.child && "mt-3")}>
                {s.title && <h3 className="mb-3 text-sm font-semibold text-zinc-700">{s.title}</h3>}
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                  {fs.map((f) => (
                    <div key={f.name} className={cn(f.type === "text" && "md:col-span-2", isTotals && f.name === "grand_total" && "font-semibold")}>
                      {f.type !== "check" && <label className="mb-1 block text-xs text-zinc-500">{f.label}{f.required && !f.readOnly && <span className="text-red-500"> *</span>}</label>}
                      <FieldInput f={f} value={valueOf(f)} row={doc} disabled={!editable || (!isNew && f.name === keyField && keyField !== "id")}
                                  onChange={(v, r) => setField(f.name, v, r)} />
                    </div>
                  ))}
                </div>
              </Card>
              {si === sections.length - 1 && !sections.some((x) => x.title === "Total") && dt.child && (
                <div className="mt-3"><ChildTable dt={dt} rows={rows} editable={editable} onCell={setCell} onAdd={addRow}
                  onRemove={(i) => { const r = rows[i]; if (!r.__new) setRemoved((x) => [...x, String(r.id)]); setRows(rows.filter((_, j) => j !== i)); setDirty(true); }} /></div>
              )}
            </div>
          );
        })}

        {connections.some((c) => c.rows.length) && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-zinc-700">Dokumen Terkait</h3>
            {connections.map((c) => c.rows.map((r) => (
              <Link key={String(r.id)} href={docUrl(c.dt.key, String(r.id))} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-zinc-50">
                <span className="w-36 text-zinc-500">{c.dt.label}</span>
                <span className="font-medium">{String(r.name)}</span>
                <Badge status={r.status as string} docstatus={r.docstatus as number} />
                <span className="ml-auto tabular-nums">{rupiah(r.grand_total)}</span>
              </Link>
            )))}
          </Card>
        )}

        {!isNew && activity.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-zinc-700">Aktivitas</h3>
            <ul className="space-y-1.5 text-xs text-zinc-600">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-36 shrink-0 text-zinc-400">{waktu(a.at)}</span>
                  <span><b>{String(a.user_email ?? "sistem")}</b> {({ INSERT: "membuat", UPDATE: "mengubah", SUBMIT: "men-submit", CANCEL: "membatalkan", DELETE: "menghapus" } as Record<string, string>)[String(a.action)] ?? a.action}
                    {a.action === "UPDATE" && a.changed ? <span className="text-zinc-400"> — {Object.keys(a.changed as object).join(", ")}</span> : null}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function ChildTable({ dt, rows, editable, onCell, onAdd, onRemove }: {
  dt: DocType; rows: Row[]; editable: boolean;
  onCell: (i: number, f: Field, v: unknown, r?: Row | null) => void; onAdd: () => void; onRemove: (i: number) => void;
}) {
  const fields = dt.child!.fields.filter((f) => f.width !== "hidden");
  return (
    <Card className="overflow-x-auto">
      <div className="flex items-center justify-between px-4 pt-3 text-sm font-semibold text-zinc-700">{dt.child!.label}</div>
      <table className="mt-2 w-full">
        <thead>
          <tr>
            <th className="w-8 border-b border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-500">#</th>
            {fields.map((f) => <th key={f.name} className={cn("whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-2 py-2 text-left text-xs font-medium text-zinc-500", f.width)}>{f.label}{f.required && <span className="text-red-500"> *</span>}</th>)}
            <th className="w-8 border-b border-zinc-200 bg-zinc-50" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id)} className="align-top">
              <td className="px-2 py-1.5 text-center text-xs text-zinc-400">{i + 1}</td>
              {fields.map((f) => (
                <td key={f.name} className={cn("px-1 py-1", f.width)}>
                  {f.name === "amount" ? (
                    <div className="flex h-8 items-center justify-end px-2 text-sm tabular-nums">{rupiah(lineAmount(r))}</div>
                  ) : f.readOnly ? (
                    <div className={cn("flex h-8 items-center px-2 text-xs text-zinc-600", NUMERIC.includes(f.type) && "justify-end tabular-nums")}>{f.type === "currency" ? rupiah(r[f.name]) : NUMERIC.includes(f.type) ? number(r[f.name]) : String(r[f.name] ?? "")}</div>
                  ) : (
                    <>
                      <FieldInput f={f} value={r[f.name]} row={r} disabled={!editable} onChange={(v, lr) => onCell(i, f, v, lr)} />
                      {f.name === "qty" && (r.item_id__l as Row)?.stock_uom ? (
                        <div className="px-1 pt-0.5 text-[10px] text-zinc-400">{String((r.item_id__l as Row).stock_uom)}</div>
                      ) : null}
                    </>
                  )}
                </td>
              ))}
              <td className="px-1 py-1">
                {editable && <button onClick={() => onRemove(i)} className="flex h-8 w-6 items-center justify-center text-zinc-400 hover:text-red-600"><X size={14} /></button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={fields.length + 2} className="py-6 text-center text-sm text-zinc-400">Belum ada item</td></tr>}
        </tbody>
      </table>
      {editable && <div className="p-2"><Button size="sm" variant="outline" onClick={onAdd}><Plus size={12} /> Tambah Baris</Button></div>}
    </Card>
  );
}
