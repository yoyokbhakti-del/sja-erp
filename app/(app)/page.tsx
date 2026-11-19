"use client";
// =====================================================================
// Dasbor bergaya Accurate: kumpulan widget yang bisa ditambah, dihapus,
// diubah ukurannya, dan diurutkan (seret). Susunan disimpan per pengguna.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, GripVertical, LayoutGrid, Plus, RotateCcw, Search, Settings2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/format";
import { Button, PageHeader } from "@/components/ui";
import { usePerms } from "@/components/perms";
import {
  DEFAULT_LAYOUT, SummaryCtx, WIDGETS, WIDGET_BY_TYPE, type Size, type Summary, type WidgetDef, type WidgetInst,
} from "@/components/dashboard-widgets";

const LS = "sja.dashboard";
const SPAN: Record<Size, string> = {
  S: "col-span-12 sm:col-span-6 xl:col-span-3",
  M: "col-span-12 xl:col-span-6",
  L: "col-span-12",
};
const SIZE_LABEL: Record<Size, string> = { S: "Kecil", M: "Sedang", L: "Lebar" };
const uid = () => Math.random().toString(36).slice(2, 9);

function sanitize(raw: unknown): WidgetInst[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((w) => w && typeof w === "object" && WIDGET_BY_TYPE[(w as WidgetInst).type])
    .map((w) => {
      const x = w as WidgetInst;
      const def = WIDGET_BY_TYPE[x.type];
      return { id: String(x.id || uid()), type: x.type, size: def.sizes.includes(x.size) ? x.size : def.size, ...(x.text ? { text: String(x.text) } : {}) };
    });
}

export default function Dashboard() {
  const { can } = usePerms();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [layout, setLayout] = useState<WidgetInst[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "local">("");
  const dbOk = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowed = useCallback((d: WidgetDef) => !d.perm || can(d.perm, "read"), [can]);

  // muat ringkasan & susunan
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.rpc("dashboard_summary").then(({ data }) => setSummary(data as Summary));
    sb.from("user_dashboards").select("widgets").maybeSingle().then(({ data, error }) => {
      if (error) dbOk.current = false;
      let local: unknown = null;
      try { local = JSON.parse(localStorage.getItem(LS) || "null"); } catch { /* abaikan */ }
      setLayout(sanitize(data?.widgets) ?? sanitize(local) ?? DEFAULT_LAYOUT);
    });
  }, []);

  // simpan (ditunda sebentar supaya tidak menyimpan tiap klik)
  const persist = useCallback((next: WidgetInst[]) => {
    try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* abaikan */ }
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(async () => {
      if (!dbOk.current) { setSaveState("local"); return; }
      const { error } = await supabaseBrowser().from("user_dashboards").upsert({ widgets: next, updated_at: new Date().toISOString() });
      if (error) { dbOk.current = false; setSaveState("local"); } else setSaveState("saved");
    }, 600);
  }, []);

  const update = (fn: (l: WidgetInst[]) => WidgetInst[]) => setLayout((l) => {
    const next = fn(l ?? []);
    persist(next);
    return next;
  });

  const visible = useMemo(() => (layout ?? []).filter((w) => allowed(WIDGET_BY_TYPE[w.type])), [layout, allowed]);

  const move = (id: string, dir: -1 | 1) => update((l) => {
    const i = l.findIndex((w) => w.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    update((l) => {
      const from = l.findIndex((w) => w.id === dragId), to = l.findIndex((w) => w.id === targetId);
      if (from < 0 || to < 0) return l;
      const n = [...l]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n;
    });
  };
  const add = (d: WidgetDef) => {
    const id = uid();
    update((l) => [...l, { id, type: d.type, size: d.size }]);
    setTimeout(() => document.getElementById(`w-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  };

  return (
    <SummaryCtx.Provider value={summary}>
      <div className="pb-12">
        <PageHeader title="Dasbor" sub={new Date().toLocaleDateString("id-ID", { dateStyle: "full" })}>
          {saveState && (
            <span className="text-xs text-zinc-400">
              {saveState === "saving" ? "Menyimpan…" : saveState === "saved" ? "Susunan tersimpan" : "Tersimpan di perangkat ini"}
            </span>
          )}
          {editing && (
            <Button variant="ghost" onClick={() => { if (confirm("Kembalikan susunan dasbor bawaan?")) update(() => DEFAULT_LAYOUT.map((w) => ({ ...w, id: uid() }))); }}>
              <RotateCcw size={14} /> Bawaan
            </Button>
          )}
          <Button variant="outline" onClick={() => setAdding(true)}><Plus size={14} /> Tambah Widget</Button>
          <Button variant={editing ? "primary" : "outline"} onClick={() => setEditing(!editing)}>
            {editing ? <><Check size={14} /> Selesai</> : <><Settings2 size={14} /> Atur Dasbor</>}
          </Button>
        </PageHeader>

        {editing && (
          <div className="mb-4 rounded-lg border border-dashed border-[#9cc0f0] bg-[#eaf1fb] px-4 py-2.5 text-sm text-[#123d73] dark:border-zinc-300 dark:bg-zinc-100 dark:text-[#9cc0f0]">
            Seret widget lewat <GripVertical size={14} className="inline" /> untuk memindah urutan, pilih ukuran Kecil/Sedang/Lebar, atau klik <X size={13} className="inline" /> untuk menghapus.
          </div>
        )}

        {!layout ? (
          <div className="grid grid-cols-12 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className={cn(SPAN[i < 4 ? "S" : "M"], "h-36 animate-pulse rounded-xl bg-zinc-100")} />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500">
            <LayoutGrid size={28} className="text-zinc-300" />
            Dasbor masih kosong.
            <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> Tambah Widget</Button>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4">
            {visible.map((w, idx) => {
              const def = WIDGET_BY_TYPE[w.type];
              const Icon = def.icon;
              return (
                <section key={w.id} id={`w-${w.id}`}
                  draggable={editing}
                  onDragStart={(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => { if (editing && dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                  onDrop={(e) => { e.preventDefault(); dropOn(w.id); setDragId(null); }}
                  className={cn(SPAN[w.size], "flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm transition",
                    editing && "ring-1 ring-[#9cc0f0] dark:ring-zinc-300", dragId === w.id && "opacity-40")}>
                  <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
                    {editing && <GripVertical size={16} className="-ml-1 shrink-0 cursor-grab text-zinc-400" />}
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#eaf1fb] text-[#1d5fb4] dark:bg-zinc-100 dark:text-[#8fb6ea]"><Icon size={15} /></span>
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">{def.title}</h3>
                    {editing && (
                      <div className="flex shrink-0 items-center gap-1">
                        {def.sizes.length > 1 && (
                          <div className="flex overflow-hidden rounded-md border border-zinc-200 text-[11px]">
                            {def.sizes.map((sz) => (
                              <button key={sz} type="button" title={SIZE_LABEL[sz]} onClick={() => update((l) => l.map((x) => x.id === w.id ? { ...x, size: sz } : x))}
                                className={cn("px-1.5 py-0.5", w.size === sz ? "bg-[#1d5fb4] text-[#fff]" : "text-zinc-500 hover:bg-zinc-100")}>{sz}</button>
                            ))}
                          </div>
                        )}
                        <button type="button" title="Geser ke kiri/atas" disabled={idx === 0} onClick={() => move(w.id, -1)}
                          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30"><ChevronLeft size={15} /></button>
                        <button type="button" title="Geser ke kanan/bawah" disabled={idx === visible.length - 1} onClick={() => move(w.id, 1)}
                          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30"><ChevronRight size={15} /></button>
                        <button type="button" title="Hapus widget" onClick={() => update((l) => l.filter((x) => x.id !== w.id))}
                          className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button>
                      </div>
                    )}
                  </header>
                  <div className={cn("flex-1 p-4", editing && "pointer-events-none select-none")}>
                    {def.render({ w, can, editing, setText: (t) => update((l) => l.map((x) => x.id === w.id ? { ...x, text: t } : x)) })}
                  </div>
                </section>
              );
            })}
            {editing && (
              <button type="button" onClick={() => setAdding(true)}
                className={cn(SPAN.S, "flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-[#1d5fb4] hover:text-[#1d5fb4]")}>
                <Plus size={22} /> Tambah Widget
              </button>
            )}
          </div>
        )}

        {adding && <AddWidget onClose={() => setAdding(false)} onAdd={add} installed={new Set(visible.map((w) => w.type))} allowed={allowed} />}
      </div>
    </SummaryCtx.Provider>
  );
}

function AddWidget({ onClose, onAdd, installed, allowed }: {
  onClose: () => void; onAdd: (d: WidgetDef) => void; installed: Set<string>; allowed: (d: WidgetDef) => boolean;
}) {
  const [q, setQ] = useState("");
  const [justAdded, setJustAdded] = useState<string[]>([]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const list = WIDGETS.filter(allowed).filter((d) => !q || `${d.title} ${d.desc}`.toLowerCase().includes(q.toLowerCase()));
  const groups = ["Ringkasan", "Grafik & Laporan", "Daftar", "Lainnya"] as const;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-base font-semibold">Tambah Widget</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X size={18} /></button>
        </div>
        <div className="p-5">
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-2.5 text-zinc-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari widget…"
              className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1d5fb4]" />
          </div>
          <div className="space-y-5">
            {groups.map((g) => {
              const items = list.filter((d) => d.group === g);
              if (!items.length) return null;
              return (
                <div key={g}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((d) => {
                      const Icon = d.icon;
                      const has = installed.has(d.type) && !d.multi;
                      const added = justAdded.includes(d.type);
                      return (
                        <div key={d.type} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eaf1fb] text-[#1d5fb4] dark:bg-zinc-100 dark:text-[#8fb6ea]"><Icon size={17} /></span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{d.title}</div>
                            <div className="text-xs text-zinc-500">{d.desc}</div>
                          </div>
                          <button type="button" disabled={has}
                            onClick={() => { onAdd(d); setJustAdded((a) => [...a, d.type]); }}
                            className={cn("shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
                              has ? "bg-zinc-100 text-zinc-400" : "bg-[#1d5fb4] text-[#fff] hover:bg-[#174e95]")}>
                            {has ? (added ? "Ditambahkan" : "Terpasang") : <span className="flex items-center gap-1"><Plus size={12} /> Tambah</span>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!list.length && <div className="py-8 text-center text-sm text-zinc-400">Widget tidak ditemukan</div>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
