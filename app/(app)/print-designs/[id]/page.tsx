"use client";
// Editor Desain Cetakan: kanvas bebas. Elemen (teks, data, total, kotak, garis, gambar)
// diseret / diubah ukurannya langsung di atas kertas; tabel barang berada di antara
// bagian Kop dan Bawah. Satuan posisi: mm.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  ArrowDown, ArrowLeft, ArrowUp, Bold, Copy, Eye, EyeOff, Image as ImageIcon, Italic, List, Minus, PenLine, Plus, Printer,
  Redo2, Save, Sigma, Square, Star, Trash2, Type, Underline, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DOCTYPES } from "@/lib/doctypes";
import { cn, errMsg } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Textarea } from "@/components/ui";
import { usePerms } from "@/components/perms";
import { DesignPreview, type EditApi } from "@/components/design-print";
import { loadPrintData } from "@/lib/print-data";
import {
  COLUMN_DEFS, type FontFam, isCustomCol, PAPERS, SAMPLE_COMPANY, TOTAL_DEFS, VAR_CATALOG, colDef, defaultDesign, designDocLabel, mergeDesign, newEl, sampleData, signGroup,
  type Band, type DesignConfig, type El, type ElType,
} from "@/lib/print-design";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PX_MM = 3.7795;
const r2 = (n: number) => Math.round(n * 100) / 100;
const TYPE_LABEL: Record<ElType, string> = { text: "Teks", kv: "Data dokumen", totals: "Blok total", rect: "Kotak", line: "Garis", image: "Gambar" };

// ----------------------------- kontrol kecil ---------------------------
const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card className="p-3">
    <div className="mb-2 text-sm font-semibold">{title}</div>
    <div className="space-y-2">{children}</div>
  </Card>
);
const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-xs text-zinc-500">{label}<div className="mt-0.5">{children}</div></label>
);
const Chk = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5" /> {label}
  </label>
);
const Sel = ({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm outline-none focus:border-zinc-400 disabled:bg-zinc-100">
    {children}
  </select>
);
// Input angka yang nyaman untuk desimal (0,5 mm dst.)
function NumInput({ value, onChange, min = -1000, max = 1000, step = 0.5 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const [txt, setTxt] = useState(String(r2(value)));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setTxt(String(r2(value))); }, [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <Input type="text" inputMode="decimal" value={txt}
      onFocus={() => { focus.current = true; }}
      onBlur={() => { focus.current = false; setTxt(String(r2(value))); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const n = clamp(r2(value + (e.key === "ArrowUp" ? step : -step)));
          setTxt(String(n)); onChange(n);
        }
      }}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = parseFloat(e.target.value.replace(",", "."));
        if (Number.isFinite(n)) onChange(clamp(n));
      }} />
  );
}
const IconBtn = ({ active, onClick, title, children, disabled }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) => (
  <button type="button" title={title} onClick={onClick} disabled={disabled}
    className={cn("inline-flex size-7 items-center justify-center rounded-md border text-zinc-600 hover:bg-zinc-100 disabled:opacity-30",
      active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white")}>
    {children}
  </button>
);
const VarSelect = ({ value, onChange, empty }: { value: string; onChange: (v: string) => void; empty: string }) => {
  const groups = Array.from(new Set(VAR_CATALOG.map((v) => v.group)));
  return (
    <Sel value={value} onChange={onChange}>
      <option value="">{empty}</option>
      {groups.map((g) => <optgroup key={g} label={g}>{VAR_CATALOG.filter((v) => v.group === g).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>)}
    </Sel>
  );
};

async function fileToImage(file: File): Promise<{ url: string; ratio: number }> {
  const src = URL.createObjectURL(file);
  const img = new window.Image();
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("Gambar tidak bisa dibaca.")); img.src = src; });
  const sc = Math.min(1, 700 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let url = c.toDataURL("image/png");
  if (url.length > 350_000) {
    ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    url = c.toDataURL("image/jpeg", 0.85);
  }
  URL.revokeObjectURL(src);
  return { url, ratio: img.height / img.width };
}

export default function PrintDesignEditor() {
  const { id } = useParams<{ id: string }>();
  const sb = supabaseBrowser();
  const { can } = usePerms();
  const canEdit = can("print_designs", "write");

  const [row, setRow] = useState<Row | null>(null);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<DesignConfig | null>(null);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  const [useSample, setUseSample] = useState(false);
  const [live, setLive] = useState<{ doc: Row; rows: Row[]; maker: string; printedBy: string; id: string } | null>(null);
  const [company, setCompany] = useState<Row>(SAMPLE_COMPANY);

  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"prop" | "page" | "layers">("page");
  const [addBand, setAddBand] = useState<Band>("head");
  const [grid, setGrid] = useState(1);
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [guide, setGuide] = useState<EditApi["guide"]>(null);

  // ---- muat desain
  useEffect(() => {
    (async () => {
      const { data, error } = await sb.from("print_designs").select("*").eq("id", id).maybeSingle();
      if (error) return setErr(errMsg(error));
      if (!data) return setMissing(true);
      const c = mergeDesign(data.doctype, data.config);
      setRow(data); setName(data.name); setCfg(c);
      setSaved(JSON.stringify({ n: data.name, c }));
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const docKey: string | undefined = row?.doctype;
  const dt = useMemo(() => DOCTYPES.find((d) => d.key === docKey), [docKey]);

  useEffect(() => {
    if (!dt) return;
    (async () => {
      const co = await sb.from("companies").select("*").order("created_at").limit(1).maybeSingle();
      if (co.data) setCompany(co.data as Row);
      const last = await sb.from(dt.key).select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!last.data) return;
      try {
        const r = await loadPrintData(sb, dt, (last.data as Row).id);
        if (r.doc) setLive({ ...r, doc: r.doc, id: (last.data as Row).id });
      } catch { /* pakai data contoh */ }
    })();
  }, [dt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!cfg && JSON.stringify({ n: name, c: cfg }) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ---- ukuran area kanvas
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(700);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [cfg === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- riwayat (undo / redo)
  const cfgRef = useRef<DesignConfig | null>(null);
  cfgRef.current = cfg;
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const lastKey = useRef({ k: "", t: 0 });
  const [, bump] = useState(0);
  const push = (key?: string) => {
    const now = Date.now();
    if (key && lastKey.current.k === key && now - lastKey.current.t < 1200) { lastKey.current.t = now; return; }
    lastKey.current = { k: key ?? "", t: now };
    if (!cfgRef.current) return;
    undoRef.current.push(JSON.stringify(cfgRef.current));
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    bump((n) => n + 1);
  };
  const set = (fn: (c: DesignConfig) => void, key?: string) => {
    push(key);
    setCfg((prev) => { const n = structuredClone(prev!); fn(n); return n; });
  };
  const undo = () => {
    const s = undoRef.current.pop();
    if (!s || !cfgRef.current) return;
    redoRef.current.push(JSON.stringify(cfgRef.current));
    lastKey.current = { k: "", t: 0 };
    setCfg(JSON.parse(s)); bump((n) => n + 1);
  };
  const redo = () => {
    const s = redoRef.current.pop();
    if (!s || !cfgRef.current) return;
    undoRef.current.push(JSON.stringify(cfgRef.current));
    lastKey.current = { k: "", t: 0 };
    setCfg(JSON.parse(s)); bump((n) => n + 1);
  };

  const W = cfg ? cfg.paper.w - cfg.paper.ml - cfg.paper.mr : 186;
  const zoom = cfg ? (zoomMode === "fit" ? Math.min(1.6, Math.max(0.3, (boxW - 24) / (cfg.paper.w * PX_MM))) : zoomMode) : 1;
  const zoomRef = useRef(1); zoomRef.current = zoom;
  const gridRef = useRef(1); gridRef.current = grid;
  const selEl = cfg && sel && sel !== "table" ? cfg.els.find((e) => e.id === sel) ?? null : null;

  const patch = (elId: string, p: Partial<El>, key?: string) => set((c) => {
    const e = c.els.find((x) => x.id === elId);
    if (e) Object.assign(e, p);
  }, key ?? `p:${elId}:${Object.keys(p).join(",")}`);

  const select = (v: string | null) => { setSel(v); if (v) setTab("prop"); };

  // ---- seret & ubah ukuran
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<null | { kind: "el" | "band"; id: string; mode: string; sx: number; sy: number; orig: El | null; origH: number; band: Band; moved: boolean }>(null);

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    const c = cfgRef.current;
    if (!d || !c) return;
    const k = PX_MM * zoomRef.current;
    const dx = (e.clientX - d.sx) / k;
    const dy = (e.clientY - d.sy) / k;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.sx) < 2 && Math.abs(e.clientY - d.sy) < 2) return;
      d.moved = true; push();
    }
    const g = gridRef.current;
    const snap = (v: number) => (g > 0 ? Math.round(v / g) * g : v);
    const Wc = c.paper.w - c.paper.ml - c.paper.mr;

    if (d.kind === "band") {
      const h = Math.max(5, Math.round(d.origH + dy));
      setCfg((prev) => { const n = structuredClone(prev!); if (d.band === "head") n.head.h = h; else n.foot.h = h; return n; });
      return;
    }
    const o = d.orig!;
    const Hc = d.band === "head" ? c.head.h : c.foot.h;
    let { x, y, w, h } = o;
    let gd: EditApi["guide"] = null;
    if (d.mode === "move") {
      x = o.x + dx; y = o.y + dy;
      // magnet ke tepi/tengah elemen lain & tepi bagian
      const th = 5 / k;
      const others = c.els.filter((q) => q.id !== o.id && q.band === d.band && !q.hidden);
      const xs = [0, Wc / 2, Wc, ...others.flatMap((q) => [q.x, q.x + q.w / 2, q.x + q.w])];
      const ys = [0, Hc / 2, Hc, ...others.flatMap((q) => [q.y, q.y + q.h / 2, q.y + q.h])];
      const best = (mine: number[], cand: number[]) => {
        let b: { d: number; at: number } | null = null;
        for (const m of mine) for (const t of cand) { const df = t - m; if (Math.abs(df) <= th && (!b || Math.abs(df) < Math.abs(b.d))) b = { d: df, at: t }; }
        return b;
      };
      const bx = best([x, x + w / 2, x + w], xs);
      const by = best([y, y + h / 2, y + h], ys);
      if (bx) { x += bx.d; gd = { band: d.band, x: bx.at }; } else x = snap(x);
      if (by) { y += by.d; gd = { ...(gd ?? { band: d.band }), y: by.at }; } else y = snap(y);
      x = Math.min(Math.max(0, x), Math.max(0, Wc - w));
      y = Math.min(Math.max(0, y), Math.max(0, Hc - h));
    } else {
      const m = d.mode;
      const minW = 1, minH = o.type === "line" ? 0.5 : 1;
      if (m.includes("e")) w = Math.max(minW, snap(o.x + o.w + dx) - o.x);
      if (m.includes("s")) h = Math.max(minH, snap(o.y + o.h + dy) - o.y);
      if (m.includes("w")) { const nx = Math.min(snap(o.x + dx), o.x + o.w - minW); w = o.x + o.w - nx; x = nx; }
      if (m.includes("n")) { const ny = Math.min(snap(o.y + dy), o.y + o.h - minH); h = o.y + o.h - ny; y = ny; }
    }
    setGuide(gd);
    setCfg((prev) => {
      const n = structuredClone(prev!);
      const t = n.els.find((q) => q.id === o.id);
      if (t) { t.x = r2(x); t.y = r2(y); t.w = r2(w); t.h = r2(h); }
      return n;
    });
  };
  const onUp = () => {
    dragRef.current = null; setGuide(null);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.userSelect = "";
  };
  const startDrag = (e: React.PointerEvent, d: NonNullable<typeof dragRef.current>) => {
    e.preventDefault();
    dragRef.current = d;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  useEffect(() => () => { document.body.style.userSelect = ""; }, []);

  const edit: EditApi = {
    sel, zoom, grid, guide,
    onDown: (e, elId, mode) => {
      if (!canEdit) { select(elId); return; }
      const el = cfgRef.current?.els.find((x) => x.id === elId);
      if (!el) return;
      select(elId);
      startDrag(e, { kind: "el", id: elId, mode, sx: e.clientX, sy: e.clientY, orig: { ...el }, origH: 0, band: el.band, moved: false });
    },
    onTable: () => { select("table"); },
    onBlank: () => { setSel(null); setTab("page"); },
    onBandResize: (e, band) => {
      if (!canEdit || !cfgRef.current) return;
      startDrag(e, { kind: "band", id: band, mode: "h", sx: e.clientX, sy: e.clientY, orig: null, origH: band === "head" ? cfgRef.current.head.h : cfgRef.current.foot.h, band, moved: false });
    },
  };

  // ---- aksi elemen
  const addElement = (type: ElType) => {
    if (!cfg) return;
    const e = newEl(type, addBand, cfg.font.size, W);
    set((c) => { c.els.push(e); });
    select(e.id);
  };
  const addSign = () => {
    if (!cfg) return;
    const g = signGroup("foot", Math.max(0, W - 52), Math.max(0, cfg.foot.h - 36), "Disetujui oleh", cfg.font.size);
    set((c) => { c.els.push(...g); });
    select(g[0].id);
    setMsg("Blok tanda tangan ditambahkan di bagian Bawah (3 elemen). Geser, ubah teks, atau hapus sesuai kebutuhan.");
  };
  const del = (elId: string) => { set((c) => { c.els = c.els.filter((e) => e.id !== elId); }); setSel(null); };
  const dup = (elId: string) => {
    const src = cfg?.els.find((e) => e.id === elId);
    if (!src) return;
    const copy: El = { ...structuredClone(src), id: Math.random().toString(36).slice(2, 9), x: Math.min(src.x + 3, Math.max(0, W - src.w)), y: src.y + 3, name: src.name ? `${src.name} (salinan)` : undefined };
    set((c) => { c.els.push(copy); });
    select(copy.id);
  };
  const order = (elId: string, dir: 1 | -1) => set((c) => {
    const i = c.els.findIndex((e) => e.id === elId), j = i + dir;
    if (i < 0 || j < 0 || j >= c.els.length) return;
    [c.els[i], c.els[j]] = [c.els[j], c.els[i]];
  });
  const alignEl = (elId: string, how: "l" | "c" | "r" | "t" | "m" | "b") => set((c) => {
    const e = c.els.find((x) => x.id === elId);
    if (!e) return;
    const Wc = c.paper.w - c.paper.ml - c.paper.mr, Hc = e.band === "head" ? c.head.h : c.foot.h;
    if (how === "l") e.x = 0; if (how === "c") e.x = r2((Wc - e.w) / 2); if (how === "r") e.x = r2(Wc - e.w);
    if (how === "t") e.y = 0; if (how === "m") e.y = r2((Hc - e.h) / 2); if (how === "b") e.y = r2(Hc - e.h);
  });

  // ---- papan ketik
  const kbRef = useRef<(e: KeyboardEvent) => void>(() => {});
  kbRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (!canEdit) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (!selEl) return;
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dup(selEl.id); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(selEl.id); return; }
    const step = (grid > 0 ? grid : 0.5) * (e.shiftKey ? 5 : 1);
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) {
      e.preventDefault();
      const [dx, dy] = mv[e.key];
      patch(selEl.id, { x: r2(Math.max(0, selEl.x + dx)), y: r2(Math.max(0, selEl.y + dy)) }, `kb:${selEl.id}`);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => kbRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (missing) return <div className="p-10 text-sm text-zinc-500">Desain tidak ditemukan. <Link className="underline" href="/print-designs">Kembali ke daftar</Link></div>;
  if (!row || !cfg || !dt) return <div className="p-10 text-sm text-zinc-500">{err || "Memuat…"}</div>;

  async function save(): Promise<boolean> {
    if (!name.trim()) { setErr("Nama desain wajib diisi."); return false; }
    const { error } = await sb.from("print_designs").update({ name: name.trim(), config: cfg }).eq("id", id);
    if (error) { setErr(errMsg(error)); setMsg(""); return false; }
    setErr(""); setMsg("Desain tersimpan.");
    setSaved(JSON.stringify({ n: name, c: cfg }));
    return true;
  }
  async function makeDefault() {
    if (!(await save())) return;
    const off = await sb.from("print_designs").update({ is_default: false }).eq("doctype", row!.doctype).neq("id", id);
    if (off.error) return setErr(errMsg(off.error));
    const on = await sb.from("print_designs").update({ is_default: true }).eq("id", id);
    if (on.error) return setErr(errMsg(on.error));
    setRow({ ...row!, is_default: true });
    setMsg("Dijadikan desain default untuk " + designDocLabel(row!.doctype) + ".");
  }
  async function testPrint() {
    if (dirty && !(await save())) return;
    if (!live) return setErr("Belum ada dokumen untuk diuji cetak. Buat satu dokumen dulu, atau lihat pratinjau di layar ini.");
    window.open(`/print/${dt!.slug}/${live.id}?design=${id}`, "_blank");
  }

  const sample = sampleData(row.doctype);
  const data = !useSample && live ? live : { doc: sample.doc, rows: sample.rows, maker: "Nama Pembuat", printedBy: "user@contoh.com", id: "" };
  const upd = set;
  const usedCols = new Set(cfg.table.columns.map((c) => c.key));
  const freeCols = COLUMN_DEFS.filter((c) => !usedCols.has(c.key));
  const moveCol = (i: number, d: number) => upd((c) => {
    const j = i + d;
    if (j < 0 || j >= c.table.columns.length) return;
    [c.table.columns[i], c.table.columns[j]] = [c.table.columns[j], c.table.columns[i]];
  });

  // ------------------------------ panel: halaman ------------------------------
  const pagePanel = (
    <div className="space-y-3">
      <Sec title="Umum">
        <F label="Nama Desain"><Input value={name} onChange={(e) => setName(e.target.value)} /></F>
        <F label="Tipe Dokumen"><Input value={designDocLabel(row.doctype)} disabled /></F>
      </Sec>
      <Sec title="Kertas & Huruf">
        <F label="Ukuran kertas">
          <Sel value={cfg.paper.preset} onChange={(v) => upd((c) => { c.paper.preset = v; if (v !== "custom") { c.paper.w = PAPERS[v].w; c.paper.h = PAPERS[v].h; } })}>
            {Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </Sel>
        </F>
        {cfg.paper.preset === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <F label="Lebar (mm)"><NumInput value={cfg.paper.w} min={50} max={600} onChange={(v) => upd((c) => { c.paper.w = v; }, "pw")} /></F>
            <F label="Tinggi (mm)"><NumInput value={cfg.paper.h} min={50} max={900} onChange={(v) => upd((c) => { c.paper.h = v; }, "ph")} /></F>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2">
          <F label="Atas"><NumInput value={cfg.paper.mt} min={0} max={60} onChange={(v) => upd((c) => { c.paper.mt = v; }, "mt")} /></F>
          <F label="Kanan"><NumInput value={cfg.paper.mr} min={0} max={60} onChange={(v) => upd((c) => { c.paper.mr = v; }, "mr")} /></F>
          <F label="Bawah"><NumInput value={cfg.paper.mb} min={0} max={60} onChange={(v) => upd((c) => { c.paper.mb = v; }, "mb")} /></F>
          <F label="Kiri"><NumInput value={cfg.paper.ml} min={0} max={60} onChange={(v) => upd((c) => { c.paper.ml = v; }, "ml")} /></F>
        </div>
        <div className="text-xs text-zinc-400">Margin dalam mm. Lebar area desain: {r2(W)} mm. Mengubah ukuran kertas tidak menggeser elemen; atur ulang posisinya bila perlu.</div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Jenis huruf dasar">
            <Sel value={cfg.font.family} onChange={(v) => upd((c) => { c.font.family = v as DesignConfig["font"]["family"]; })}>
              <option value="sans">Sans (Arial)</option><option value="serif">Serif (Times)</option><option value="mono">Monospace (Courier)</option>
            </Sel>
          </F>
          <F label="Ukuran dasar (pt)"><NumInput value={cfg.font.size} min={6} max={16} step={0.5} onChange={(v) => upd((c) => { c.font.size = v; }, "fs")} /></F>
        </div>
        <Chk checked={cfg.watermark} onChange={(v) => upd((c) => { c.watermark = v; })} label="Watermark DRAFT / DIBATALKAN" />
      </Sec>
      <Sec title="Bagian Kop & Bawah">
        <div className="grid grid-cols-2 gap-2">
          <F label="Tinggi Kop (mm)"><NumInput value={cfg.head.h} min={5} max={400} step={1} onChange={(v) => upd((c) => { c.head.h = v; }, "hh")} /></F>
          <F label="Tinggi Bawah (mm)"><NumInput value={cfg.foot.h} min={5} max={400} step={1} onChange={(v) => upd((c) => { c.foot.h = v; }, "fh")} /></F>
        </div>
        <Chk checked={cfg.foot.pin} onChange={(v) => upd((c) => { c.foot.pin = v; })} label="Bagian Bawah menempel di dasar kertas" />
        <div className="text-xs text-zinc-400">Kop tampil di atas tabel, Bawah tampil di bawah tabel (mengikuti tabel, atau menempel di dasar kertas bila dicentang). Tinggi juga bisa diubah dengan menyeret garis biru di bawah tiap bagian.</div>
      </Sec>
      <Sec title="Mulai dari awal">
        <Button variant="outline" onClick={() => { if (confirm("Kembalikan tata letak ke bawaan? Semua elemen yang sudah Anda atur akan diganti.")) { upd((c) => { const d = defaultDesign(row!.doctype); c.els = d.els; c.head = d.head; c.foot = d.foot; c.table = d.table; }); setSel(null); } }}>
          Kembalikan tata letak bawaan
        </Button>
        <Button variant="outline" onClick={() => { if (confirm("Kosongkan Kop dan Bawah? Tabel barang tetap ada.")) { upd((c) => { c.els = []; }); setSel(null); } }}>
          Kosongkan kanvas (desain dari nol)
        </Button>
      </Sec>
    </div>
  );

  // ------------------------------ panel: tabel ------------------------------
  const tablePanel = (
    <div className="space-y-3">
      <Sec title="Tabel Barang">
        <div className="text-xs text-zinc-400">Tabel selalu berada di antara Kop dan Bawah; tingginya mengikuti jumlah baris.</div>
        <div className="space-y-1.5">
          {cfg.table.columns.map((c, i) => (
            <div key={c.key} className="grid grid-cols-[1fr_62px_auto] items-center gap-1.5 rounded-md border border-zinc-200 p-1.5">
              <div>
                <Input value={c.label} onChange={(e) => upd((x) => { x.table.columns[i].label = e.target.value; }, `col${i}`)} />
                {isCustomCol(c.key)
                  ? <Input className="mt-1" placeholder="Isi tetap tiap baris (kosong = untuk tulis tangan)" value={c.text ?? ""} onChange={(e) => upd((x) => { x.table.columns[i].text = e.target.value; }, `coltx${i}`)} />
                  : <div className="mt-0.5 text-[10px] text-zinc-400">{colDef(c.key)?.label} · {c.key}</div>}
              </div>
              <Input type="number" min={5} max={200} placeholder="auto" value={c.width ?? ""} title="Lebar kolom (mm), kosong = otomatis"
                onChange={(e) => upd((x) => { x.table.columns[i].width = e.target.value ? Number(e.target.value) : null; }, `colw${i}`)} />
              <div className="flex">
                <button type="button" className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30" disabled={i === 0} onClick={() => moveCol(i, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30" disabled={i === cfg.table.columns.length - 1} onClick={() => moveCol(i, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" disabled={cfg.table.columns.length <= 1}
                  onClick={() => upd((x) => { x.table.columns.splice(i, 1); })}><X size={13} /></button>
              </div>
              <div className="col-span-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-zinc-200 pt-1.5">
                <select className="h-7 rounded-md border border-zinc-200 bg-white px-1 text-xs" title="Jenis huruf kolom" value={c.fam ?? ""}
                  onChange={(e) => upd((x) => { const k = x.table.columns[i]; if (e.target.value) k.fam = e.target.value as FontFam; else delete k.fam; })}>
                  <option value="">Huruf: ikut tabel</option>
                  <option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
                </select>
                <input type="number" min={0} max={30} step={0.5} placeholder="pt" title="Ukuran huruf kolom (pt), kosong = ikut tabel"
                  className="h-7 w-14 rounded-md border border-zinc-200 bg-white px-1.5 text-xs" value={c.size ?? ""}
                  onChange={(e) => upd((x) => { const k = x.table.columns[i]; if (Number(e.target.value) > 0) k.size = Number(e.target.value); else delete k.size; }, `colsz${i}`)} />
                <IconBtn title="Tebal" active={c.bold} onClick={() => upd((x) => { const k = x.table.columns[i]; if (k.bold) delete k.bold; else k.bold = true; })}><span className="text-[11px] font-bold">B</span></IconBtn>
                <IconBtn title="Miring" active={c.italic} onClick={() => upd((x) => { const k = x.table.columns[i]; if (k.italic) delete k.italic; else k.italic = true; })}><span className="text-[11px] italic">I</span></IconBtn>
                {(["l", "c", "r"] as const).map((a) => (
                  <IconBtn key={a} title={{ l: "Rata kiri", c: "Tengah", r: "Rata kanan" }[a]} active={(c.align ?? colDef(c.key)?.align ?? "l") === a}
                    onClick={() => upd((x) => { x.table.columns[i].align = a; })}>
                    <span className="text-[10px] font-bold">{a === "l" ? "◧" : a === "c" ? "▣" : "◨"}</span>
                  </IconBtn>
                ))}
              </div>
            </div>
          ))}
        </div>
        {freeCols.length > 0 && (
          <Sel value="" onChange={(v) => v && upd((c) => { const d = colDef(v)!; c.table.columns.push({ key: v, label: d.label, width: d.width }); })}>
            <option value="">+ Tambah kolom…</option>
            {freeCols.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
          </Sel>
        )}
        <Button variant="outline" onClick={() => upd((c) => { c.table.columns.push({ key: `custom_${Date.now().toString(36)}`, label: "Kolom baru", width: null }); })}>
          <Plus size={13} /> Tambah kolom kosong / teks tetap
        </Button>
        <div className="text-xs text-zinc-400">Lebar kolom dalam mm; kosongkan agar otomatis (sisa lebar).</div>
      </Sec>
      <Sec title="Gaya Tabel">
        <div className="grid grid-cols-2 gap-2">
          <F label="Garis tabel">
            <Sel value={cfg.table.border} onChange={(v) => upd((c) => { c.table.border = v as DesignConfig["table"]["border"]; })}>
              <option value="full">Penuh (semua kotak)</option><option value="box">Kotak luar saja</option><option value="boxh">Kotak luar + garis datar</option><option value="horizontal">Garis datar saja</option><option value="none">Tanpa garis</option>
            </Sel>
          </F>
          <F label="Jenis huruf tabel">
            <Sel value={cfg.table.fam ?? ""} onChange={(v) => upd((c) => { if (v) c.table.fam = v as FontFam; else delete c.table.fam; })}>
              <option value="">Ikut dokumen</option><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
            </Sel>
          </F>
          <F label="Tebal garis (pt)"><NumInput value={cfg.table.lineW ?? 0.6} min={0.1} max={3} step={0.1} onChange={(v) => upd((c) => { c.table.lineW = v; }, "tlw")} /></F>
          <F label="Tambah baris kosong"><NumInput value={cfg.table.extraRows ?? 0} min={0} max={40} step={1} onChange={(v) => upd((c) => { c.table.extraRows = v; }, "xrows")} /></F>
          <F label="Baris minimal"><NumInput value={cfg.table.minRows} min={0} max={40} step={1} onChange={(v) => upd((c) => { c.table.minRows = v; }, "minrows")} /></F>
          <F label="Ukuran huruf (pt, 0 = dasar)"><NumInput value={cfg.table.size} min={0} max={16} step={0.5} onChange={(v) => upd((c) => { c.table.size = v; }, "tsize")} /></F>
          <F label="Jarak isi sel (mm)"><NumInput value={cfg.table.pad} min={0} max={6} step={0.25} onChange={(v) => upd((c) => { c.table.pad = v; }, "tpad")} /></F>
        </div>
        <Chk checked={cfg.table.headBg} onChange={(v) => upd((c) => { c.table.headBg = v; })} label="Latar abu-abu pada judul kolom" />
        <Chk checked={cfg.table.headUpper} onChange={(v) => upd((c) => { c.table.headUpper = v; })} label="Judul kolom HURUF BESAR" />
        <Chk checked={cfg.table.itemSubline} onChange={(v) => upd((c) => { c.table.itemSubline = v; })} label="Kode & No. Reg. di bawah nama barang" />
      </Sec>
    </div>
  );

  // ------------------------------ panel: elemen terpilih ------------------------------
  const E = selEl;
  const insertVar = (k: string) => {
    if (!E || !k) return;
    const ta = textRef.current;
    const cur = E.text ?? "";
    const pos = ta ? ta.selectionStart : cur.length;
    patch(E.id, { text: cur.slice(0, pos) + `{${k}}` + cur.slice(pos) }, `txt:${E.id}`);
  };
  const colorInput = (v: string | undefined, on: (c: string) => void) => (
    <input type="color" value={v || "#000000"} onChange={(e) => on(e.target.value)} className="h-8 w-full cursor-pointer rounded-md border border-zinc-200 bg-zinc-50 p-0.5" />
  );

  const elPanel = E && (
    <div className="space-y-3">
      <Sec title={`${TYPE_LABEL[E.type]}${E.name ? ` · ${E.name}` : ""}`}>
        <div className="flex flex-wrap gap-1">
          <IconBtn title="Salin (Ctrl+D)" onClick={() => dup(E.id)}><Copy size={14} /></IconBtn>
          <IconBtn title="Naikkan lapisan" onClick={() => order(E.id, 1)}><ArrowUp size={14} /></IconBtn>
          <IconBtn title="Turunkan lapisan" onClick={() => order(E.id, -1)}><ArrowDown size={14} /></IconBtn>
          <IconBtn title={E.hidden ? "Tampilkan" : "Sembunyikan"} active={E.hidden} onClick={() => patch(E.id, { hidden: !E.hidden })}>{E.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</IconBtn>
          <IconBtn title="Hapus (Delete)" onClick={() => del(E.id)}><Trash2 size={14} className="text-red-600" /></IconBtn>
        </div>
        <div className="flex flex-wrap gap-1">
          <IconBtn title="Rata kiri bagian" onClick={() => alignEl(E.id, "l")}><AlignHorizontalJustifyStart size={14} /></IconBtn>
          <IconBtn title="Tengah horizontal" onClick={() => alignEl(E.id, "c")}><AlignHorizontalJustifyCenter size={14} /></IconBtn>
          <IconBtn title="Rata kanan bagian" onClick={() => alignEl(E.id, "r")}><AlignHorizontalJustifyEnd size={14} /></IconBtn>
          <IconBtn title="Rata atas bagian" onClick={() => alignEl(E.id, "t")}><AlignVerticalJustifyStart size={14} /></IconBtn>
          <IconBtn title="Tengah vertikal" onClick={() => alignEl(E.id, "m")}><AlignVerticalJustifyCenter size={14} /></IconBtn>
          <IconBtn title="Rata bawah bagian" onClick={() => alignEl(E.id, "b")}><AlignVerticalJustifyEnd size={14} /></IconBtn>
        </div>
        <F label="Nama elemen (untuk daftar lapisan)"><Input value={E.name ?? ""} onChange={(e) => patch(E.id, { name: e.target.value }, `nm:${E.id}`)} /></F>
        <div className="grid grid-cols-2 gap-2">
          <F label="X (mm)"><NumInput value={E.x} min={-50} max={600} onChange={(v) => patch(E.id, { x: v })} /></F>
          <F label="Y (mm)"><NumInput value={E.y} min={-50} max={600} onChange={(v) => patch(E.id, { y: v })} /></F>
          <F label="Lebar (mm)"><NumInput value={E.w} min={0.5} max={600} onChange={(v) => patch(E.id, { w: v })} /></F>
          <F label="Tinggi (mm)"><NumInput value={E.h} min={0.1} max={600} onChange={(v) => patch(E.id, { h: v })} /></F>
        </div>
        <F label="Berada di bagian">
          <Sel value={E.band} onChange={(v) => patch(E.id, { band: v as Band, y: 0 })}>
            <option value="head">Kop / Atas (di atas tabel)</option><option value="foot">Bawah (di bawah tabel)</option>
          </Sel>
        </F>
        <F label="Tampilkan hanya jika data ini terisi">
          <VarSelect value={E.showIf ?? ""} onChange={(v) => patch(E.id, { showIf: v || undefined })} empty="Selalu tampil" />
        </F>
      </Sec>

      {E.type === "text" && (
        <Sec title="Teks">
          <F label="Isi teks (Enter = baris baru)">
            <Textarea ref={textRef} value={E.text ?? ""} className="min-h-20" onChange={(e) => patch(E.id, { text: e.target.value }, `txt:${E.id}`)} />
          </F>
          <F label="Sisipkan data di posisi kursor">
            <VarSelect value="" onChange={insertVar} empty="+ Sisipkan data…" />
          </F>
          <div className="text-[11px] text-zinc-400">Data ditulis seperti <code>{"{party.name}"}</code>. Baris yang datanya kosong otomatis hilang.</div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Ukuran (pt)"><NumInput value={E.size ?? cfg.font.size} min={4} max={60} step={0.5} onChange={(v) => patch(E.id, { size: v })} /></F>
            <F label="Huruf">
              <Sel value={E.family ?? ""} onChange={(v) => patch(E.id, { family: v as El["family"] })}>
                <option value="">Ikut dasar</option><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Monospace</option>
              </Sel>
            </F>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <IconBtn title="Tebal" active={E.bold} onClick={() => patch(E.id, { bold: !E.bold })}><Bold size={14} /></IconBtn>
            <IconBtn title="Miring" active={E.italic} onClick={() => patch(E.id, { italic: !E.italic })}><Italic size={14} /></IconBtn>
            <IconBtn title="Garis bawah" active={E.underline} onClick={() => patch(E.id, { underline: !E.underline })}><Underline size={14} /></IconBtn>
            <IconBtn title="HURUF BESAR" active={E.upper} onClick={() => patch(E.id, { upper: !E.upper })}><span className="text-[10px] font-bold">AA</span></IconBtn>
            <span className="mx-1 h-5 w-px bg-zinc-200" />
            {(["l", "c", "r"] as const).map((a) => <IconBtn key={a} title={{ l: "Rata kiri", c: "Tengah", r: "Rata kanan" }[a]} active={(E.align ?? "l") === a} onClick={() => patch(E.id, { align: a })}><span className="text-[10px] font-bold">{a === "l" ? "◧" : a === "c" ? "▣" : "◨"}</span></IconBtn>)}
            <span className="mx-1 h-5 w-px bg-zinc-200" />
            {(["t", "m", "b"] as const).map((a) => <IconBtn key={a} title={{ t: "Atas", m: "Tengah vertikal", b: "Bawah" }[a]} active={(E.valign ?? "t") === a} onClick={() => patch(E.id, { valign: a })}><span className="text-[10px] font-bold">{a === "t" ? "⊤" : a === "m" ? "⊕" : "⊥"}</span></IconBtn>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Warna">{colorInput(E.color, (c) => patch(E.id, { color: c }))}</F>
            <F label="Jarak huruf (mm)"><NumInput value={E.spacing ?? 0} min={0} max={5} step={0.1} onChange={(v) => patch(E.id, { spacing: v })} /></F>
          </div>
        </Sec>
      )}

      {E.type === "kv" && (
        <Sec title="Daftar Data (label : isi)">
          <div className="text-[11px] text-zinc-400">Baris yang datanya kosong otomatis tidak dicetak. Tiap baris punya pengaturan huruf sendiri; yang kosong mengikuti pengaturan elemen di bawah.</div>
          {(E.rows ?? []).map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
              <Input value={r.label} onChange={(e) => { const rows = structuredClone(E.rows!); rows[i].label = e.target.value; patch(E.id, { rows }, `kv:${E.id}:${i}`); }} />
              <VarSelect value={r.v} empty="Pilih data…" onChange={(v) => { const rows = structuredClone(E.rows!); rows[i].v = v; if (v && !rows[i].label) rows[i].label = VAR_CATALOG.find((x) => x.key === v)?.label ?? ""; patch(E.id, { rows }); }} />
              <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => patch(E.id, { rows: E.rows!.filter((_, j) => j !== i) })}><X size={13} /></button>
              <div className="col-span-3 flex flex-wrap items-center gap-1 pb-1">
                <select className="h-6 rounded border border-zinc-200 bg-white px-1 text-[11px]" title="Huruf baris ini" value={r.fam ?? ""}
                  onChange={(e) => { const rows = structuredClone(E.rows!); if (e.target.value) rows[i].fam = e.target.value as FontFam; else delete rows[i].fam; patch(E.id, { rows }); }}>
                  <option value="">Huruf: ikut elemen</option><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
                </select>
                <input type="number" min={4} max={30} step={0.5} placeholder="pt" title="Ukuran baris ini (pt)" value={r.size ?? ""}
                  className="h-6 w-14 rounded border border-zinc-200 bg-white px-1 text-[11px]"
                  onChange={(e) => { const rows = structuredClone(E.rows!); const n = parseFloat(e.target.value); if (n > 0) rows[i].size = n; else delete rows[i].size; patch(E.id, { rows }, `kvs:${E.id}:${i}`); }} />
                <IconBtn title="Tebal baris ini" active={r.bold} onClick={() => { const rows = structuredClone(E.rows!); rows[i].bold = !rows[i].bold; patch(E.id, { rows }); }}><span className="text-[11px] font-bold">B</span></IconBtn>
                <IconBtn title="Miring baris ini" active={r.italic} onClick={() => { const rows = structuredClone(E.rows!); rows[i].italic = !rows[i].italic; patch(E.id, { rows }); }}><span className="text-[11px] italic">I</span></IconBtn>
              </div>
            </div>
          ))}
          <Sel value="" onChange={(v) => { if (v) patch(E.id, { rows: [...(E.rows ?? []), { label: VAR_CATALOG.find((x) => x.key === v)?.label ?? "", v }] }); }}>
            <option value="">+ Tambah baris…</option>
            {VAR_CATALOG.map((v) => <option key={v.key} value={v.key}>{v.group} – {v.label}</option>)}
          </Sel>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="h-7 rounded-md border border-zinc-200 bg-white px-1 text-xs" title="Jenis huruf" value={E.family ?? ""}
              onChange={(e) => patch(E.id, { family: e.target.value as FontFam | "" })}>
              <option value="">Huruf: ikut dokumen</option><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
            </select>
            <IconBtn title="Tebal (seluruh isi)" active={E.bold} onClick={() => patch(E.id, { bold: !E.bold })}><span className="text-[11px] font-bold">B</span></IconBtn>
            <IconBtn title="Miring" active={E.italic} onClick={() => patch(E.id, { italic: !E.italic })}><span className="text-[11px] italic">I</span></IconBtn>
            <IconBtn title="Label tebal" active={E.labelBold} onClick={() => patch(E.id, { labelBold: !E.labelBold })}><span className="text-[10px] font-bold">Lbl B</span></IconBtn>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <F label="Lebar label (mm)"><NumInput value={E.labelW ?? 30} min={5} max={200} onChange={(v) => patch(E.id, { labelW: v })} /></F>
            <F label="Ukuran (pt)"><NumInput value={E.size ?? cfg.font.size} min={4} max={30} step={0.5} onChange={(v) => patch(E.id, { size: v })} /></F>
            <F label="Warna">{colorInput(E.color, (c) => patch(E.id, { color: c }))}</F>
          </div>
        </Sec>
      )}

      {E.type === "totals" && (
        <Sec title="Blok Total">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {TOTAL_DEFS.map((t) => (
              <Chk key={t.key} checked={(E.keys ?? []).includes(t.key)} label={t.key === "ppn" ? "PPN" : t.key === "total" ? "Total" : t.label({})}
                onChange={(v) => patch(E.id, { keys: TOTAL_DEFS.map((x) => x.key).filter((k) => (k === t.key ? v : (E.keys ?? []).includes(k))) })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="h-7 rounded-md border border-zinc-200 bg-white px-1 text-xs" title="Jenis huruf" value={E.family ?? ""}
              onChange={(e) => patch(E.id, { family: e.target.value as FontFam | "" })}>
              <option value="">Huruf: ikut dokumen</option><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
            </select>
            <IconBtn title="Tebal (seluruh isi)" active={E.bold} onClick={() => patch(E.id, { bold: !E.bold })}><span className="text-[11px] font-bold">B</span></IconBtn>
            <IconBtn title="Miring" active={E.italic} onClick={() => patch(E.id, { italic: !E.italic })}><span className="text-[11px] italic">I</span></IconBtn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Ukuran (pt)"><NumInput value={E.size ?? cfg.font.size} min={4} max={30} step={0.5} onChange={(v) => patch(E.id, { size: v })} /></F>
            <F label="Warna">{colorInput(E.color, (c) => patch(E.id, { color: c }))}</F>
          </div>
        </Sec>
      )}

      {(E.type === "rect" || E.type === "line") && (
        <Sec title={E.type === "rect" ? "Kotak" : "Garis"}>
          {E.type === "line" && (
            <F label="Arah">
              <Sel value={E.dir ?? "h"} onChange={(v) => { const dir = v as "h" | "v"; patch(E.id, dir === "v" ? { dir, w: 1, h: Math.max(E.w, 10) } : { dir, h: 1, w: Math.max(E.h, 10) }); }}>
                <option value="h">Mendatar</option><option value="v">Tegak</option>
              </Sel>
            </F>
          )}
          <div className="grid grid-cols-2 gap-2">
            <F label="Tebal garis (mm)"><NumInput value={E.stroke ?? 0.25} min={0} max={5} step={0.05} onChange={(v) => patch(E.id, { stroke: v })} /></F>
            <F label="Warna garis">{colorInput(E.color, (c) => patch(E.id, { color: c }))}</F>
          </div>
          <Chk checked={!!E.dash} onChange={(v) => patch(E.id, { dash: v })} label="Putus-putus" />
          {E.type === "rect" && <>
            <F label="Sudut membulat (mm)"><NumInput value={E.radius ?? 0} min={0} max={30} step={0.5} onChange={(v) => patch(E.id, { radius: v })} /></F>
            <div className="flex items-center gap-2">
              <Chk checked={!!E.fill} onChange={(v) => patch(E.id, { fill: v ? "#e5e7eb" : "" })} label="Isi warna" />
              {E.fill && <input type="color" value={E.fill} onChange={(e) => patch(E.id, { fill: e.target.value })} className="h-7 w-14 cursor-pointer rounded-md border border-zinc-200 p-0.5" />}
            </div>
          </>}
        </Sec>
      )}

      {E.type === "image" && (
        <Sec title="Gambar">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => patch(E.id, { src: "{logo}" })}>Logo perusahaan</Button>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50">
              Unggah gambar…
              <input type="file" accept="image/*" className="hidden" onChange={async (ev) => {
                const f = ev.target.files?.[0]; ev.target.value = "";
                if (!f) return;
                try {
                  const { url, ratio } = await fileToImage(f);
                  patch(E.id, { src: url, h: r2(E.w * ratio) });
                } catch (x) { setErr(errMsg(x)); }
              }} />
            </label>
          </div>
          <div className="text-[11px] text-zinc-400">{E.src === "{logo}" ? "Memakai logo perusahaan." : E.src ? "Memakai gambar unggahan (otomatis dikecilkan agar ringan)." : "Belum ada gambar."}</div>
        </Sec>
      )}
    </div>
  );

  // ------------------------------ panel: lapisan ------------------------------
  const layersPanel = (
    <Sec title="Daftar Lapisan">
      <div className="text-[11px] text-zinc-400">Paling atas = paling depan. Klik untuk memilih (berguna bila elemen tumpang tindih atau tersembunyi).</div>
      {(["head", "foot"] as Band[]).map((b) => (
        <div key={b}>
          <div className="mt-2 text-xs font-semibold text-zinc-500">{b === "head" ? "Kop / Atas" : "Bawah"}</div>
          <div className="mt-1 space-y-1">
            {cfg.els.filter((e) => e.band === b).slice().reverse().map((e) => (
              <div key={e.id} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", sel === e.id ? "border-blue-500 bg-blue-50" : "border-zinc-200")}>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => select(e.id)}>
                  <span className="text-zinc-400">{TYPE_LABEL[e.type]} · </span>{e.name || (e.type === "text" ? (e.text ?? "").split("\n")[0].slice(0, 30) : "")}
                </button>
                <button type="button" title={e.hidden ? "Tampilkan" : "Sembunyikan"} className="rounded p-0.5 hover:bg-zinc-100" onClick={() => patch(e.id, { hidden: !e.hidden })}>
                  {e.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            ))}
            {cfg.els.every((e) => e.band !== b) && <div className="text-xs text-zinc-400">Kosong.</div>}
          </div>
        </div>
      ))}
    </Sec>
  );

  const propContent = sel === "table" ? tablePanel : E ? elPanel : <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">Klik elemen di kertas untuk mengaturnya, atau tambahkan elemen baru dari tombol di atas kanvas.</div>;

  const palette: { t: ElType; icon: React.ReactNode; label: string }[] = [
    { t: "text", icon: <Type size={14} />, label: "Teks" },
    { t: "kv", icon: <List size={14} />, label: "Data" },
    { t: "totals", icon: <Sigma size={14} />, label: "Total" },
    { t: "rect", icon: <Square size={14} />, label: "Kotak" },
    { t: "line", icon: <Minus size={14} />, label: "Garis" },
    { t: "image", icon: <ImageIcon size={14} />, label: "Gambar" },
  ];

  return (
    <div className="pb-10">
      <PageHeader title={<span className="flex items-center gap-2">
          <Link href="/print-designs" className="text-zinc-400 hover:text-zinc-700"><ArrowLeft size={16} /></Link>
          {name || "Desain Cetakan"}
          {row.is_default && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Default</span>}
          {dirty && <span className="text-xs font-normal text-amber-600">• belum disimpan</span>}
        </span>}
        sub={`${designDocLabel(row.doctype)} · cetak grafis · kanvas bebas`}>
        {canEdit && <>
          {!row.is_default && <Button variant="outline" onClick={makeDefault}><Star size={14} /> Jadikan Default</Button>}
          <Button variant="outline" onClick={testPrint}><Printer size={14} /> Uji Cetak</Button>
          <Button variant="primary" onClick={save} disabled={!dirty}><Save size={14} /> Simpan</Button>
        </>}
      </PageHeader>

      {err && <div className="mb-3"><Alert onClose={() => setErr("")}>{err}</Alert></div>}
      {msg && !err && <div className="mb-3"><Alert kind="success" onClose={() => setMsg("")}>{msg}</Alert></div>}
      {!canEdit && <div className="mb-3"><Alert kind="info">Anda hanya punya izin melihat desain ini.</Alert></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ------------------------- kanvas ------------------------- */}
        <div className="min-w-0">
          {canEdit && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white p-2">
              <span className="text-xs text-zinc-500">Tambah ke</span>
              <select value={addBand} onChange={(e) => setAddBand(e.target.value as Band)} className="h-7 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-xs">
                <option value="head">Kop</option><option value="foot">Bawah</option>
              </select>
              {palette.map((p) => (
                <button key={p.t} type="button" onClick={() => addElement(p.t)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-100"><Plus size={11} />{p.icon}{p.label}</button>
              ))}
              <button type="button" onClick={addSign} className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-100"><Plus size={11} /><PenLine size={14} />Tanda tangan</button>
              <span className="mx-1 h-5 w-px bg-zinc-200" />
              <IconBtn title="Urungkan (Ctrl+Z)" onClick={undo} disabled={undoRef.current.length === 0}><Undo2 size={14} /></IconBtn>
              <IconBtn title="Ulangi (Ctrl+Y)" onClick={redo} disabled={redoRef.current.length === 0}><Redo2 size={14} /></IconBtn>
              <span className="mx-1 h-5 w-px bg-zinc-200" />
              <IconBtn title="Perkecil" onClick={() => setZoomMode(Math.max(0.3, r2(zoom * 0.87)))}><ZoomOut size={14} /></IconBtn>
              <button type="button" title="Pas lebar area" onClick={() => setZoomMode("fit")} className="h-7 min-w-12 rounded-md border border-zinc-200 bg-white px-1.5 text-xs hover:bg-zinc-100">{Math.round(zoom * 100)}%</button>
              <IconBtn title="Perbesar" onClick={() => setZoomMode(Math.min(3, r2(zoom * 1.15)))}><ZoomIn size={14} /></IconBtn>
              <span className="mx-1 h-5 w-px bg-zinc-200" />
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-500">Kisi
              <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className="h-7 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-xs">
                <option value={0}>Mati</option><option value={0.5}>0,5 mm</option><option value={1}>1 mm</option><option value={2}>2 mm</option><option value={5}>5 mm</option>
              </select></span>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>Pratinjau: <b>{!useSample && live ? `dokumen ${live.doc.name}` : "data contoh"}</b></span>
            {live && <Chk checked={useSample} onChange={setUseSample} label="Pakai data contoh" />}
            <span className="text-zinc-400">{cfg.paper.w} × {cfg.paper.h} mm · seret elemen untuk memindah, tarik kotak biru di tepinya untuk mengubah ukuran, tombol panah untuk menggeser halus</span>
          </div>
          <div ref={boxRef} className="overflow-auto rounded-lg bg-zinc-200 p-3 pt-6 xl:max-h-[calc(100vh-190px)]">
            <div style={{ zoom }}>
              <DesignPreview dt={dt} doc={data.doc} rows={data.rows} company={company} maker={data.maker} printedBy={data.printedBy} design={cfg} edit={edit} />
            </div>
          </div>
        </div>

        {/* ------------------------- panel ------------------------- */}
        <div className="min-w-0 xl:max-h-[calc(100vh-110px)] xl:overflow-y-auto xl:pr-1">
          <div className="mb-2 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
            {([["prop", sel === "table" ? "Tabel" : "Elemen"], ["page", "Halaman"], ["layers", "Lapisan"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={cn("flex-1 rounded-md px-2 py-1", tab === k ? "bg-white font-medium shadow-sm" : "text-zinc-500 hover:text-zinc-800")}>{l}</button>
            ))}
          </div>
          <fieldset disabled={!canEdit} className="min-w-0 space-y-3">
            {tab === "prop" ? propContent : tab === "page" ? pagePanel : layersPanel}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
