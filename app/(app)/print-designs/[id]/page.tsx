"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Printer, Save, Star, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DOCTYPES } from "@/lib/doctypes";
import { cn, errMsg } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Textarea } from "@/components/ui";
import { usePerms } from "@/components/perms";
import { DesignPreview } from "@/components/design-print";
import { loadPrintData } from "@/lib/print-data";
import {
  COLUMN_DEFS, META_FIELDS, PAPERS, SAMPLE_COMPANY, TOTAL_DEFS, colDef, designDocLabel, mergeDesign, sampleData,
  type DesignConfig,
} from "@/lib/print-design";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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
const Num = ({ value, onChange, min = 0, max = 500, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) => (
  <Input type="number" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step}
    onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
);

export default function PrintDesignEditor() {
  const { id } = useParams<{ id: string }>();
  const sb = supabaseBrowser();
  const { can } = usePerms();
  const canEdit = can("print_designs", "write");

  const [row, setRow] = useState<Row | null>(null);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<DesignConfig | null>(null);
  const [saved, setSaved] = useState("");              // snapshot yang sudah tersimpan
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  // data pratinjau
  const [useSample, setUseSample] = useState(false);
  const [live, setLive] = useState<{ doc: Row; rows: Row[]; maker: string; printedBy: string; id: string } | null>(null);
  const [company, setCompany] = useState<Row>(SAMPLE_COMPANY);

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

  // skala pratinjau mengikuti lebar area
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

  if (missing) return <div className="p-10 text-sm text-zinc-500">Desain tidak ditemukan. <Link className="underline" href="/print-designs">Kembali ke daftar</Link></div>;
  if (!row || !cfg || !dt) return <div className="p-10 text-sm text-zinc-500">{err || "Memuat…"}</div>;

  const upd = (fn: (c: DesignConfig) => void) => setCfg((prev) => { const n = structuredClone(prev!); fn(n); return n; });

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
  const px = cfg.paper.w * 3.7795;
  const zoom = Math.min(1, Math.max(0.3, (boxW - 24) / px));

  const usedCols = new Set(cfg.table.columns.map((c) => c.key));
  const freeCols = COLUMN_DEFS.filter((c) => !usedCols.has(c.key));
  const moveCol = (i: number, d: number) => upd((c) => {
    const j = i + d;
    if (j < 0 || j >= c.table.columns.length) return;
    [c.table.columns[i], c.table.columns[j]] = [c.table.columns[j], c.table.columns[i]];
  });
  const toggleIn = (list: string[], key: string, on: boolean) => (on ? [...list.filter((k) => k !== key), key] : list.filter((k) => k !== key));

  return (
    <div className="pb-10">
      <PageHeader title={<span className="flex items-center gap-2">
          <Link href="/print-designs" className="text-zinc-400 hover:text-zinc-700"><ArrowLeft size={16} /></Link>
          {name || "Desain Cetakan"}
          {row.is_default && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Default</span>}
          {dirty && <span className="text-xs font-normal text-amber-600">• belum disimpan</span>}
        </span>}
        sub={`${designDocLabel(row.doctype)} · cetak grafis`}>
        {canEdit && <>
          {!row.is_default && <Button variant="outline" onClick={makeDefault}><Star size={14} /> Jadikan Default</Button>}
          <Button variant="outline" onClick={testPrint}><Printer size={14} /> Uji Cetak</Button>
          <Button variant="primary" onClick={save} disabled={!dirty}><Save size={14} /> Simpan</Button>
        </>}
      </PageHeader>

      {err && <div className="mb-3"><Alert onClose={() => setErr("")}>{err}</Alert></div>}
      {msg && !err && <div className="mb-3"><Alert kind="success" onClose={() => setMsg("")}>{msg}</Alert></div>}
      {!canEdit && <div className="mb-3"><Alert kind="info">Anda hanya punya izin melihat desain ini.</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* ------------------------- pengaturan ------------------------- */}
        <fieldset disabled={!canEdit} className="min-w-0 space-y-3 lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto lg:pr-1">
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
                <F label="Lebar (mm)"><Num value={cfg.paper.w} min={50} max={600} onChange={(v) => upd((c) => { c.paper.w = v; })} /></F>
                <F label="Tinggi (mm)"><Num value={cfg.paper.h} min={50} max={900} onChange={(v) => upd((c) => { c.paper.h = v; })} /></F>
              </div>
            )}
            <div className="grid grid-cols-4 gap-2">
              <F label="Atas"><Num value={cfg.paper.mt} max={60} onChange={(v) => upd((c) => { c.paper.mt = v; })} /></F>
              <F label="Kanan"><Num value={cfg.paper.mr} max={60} onChange={(v) => upd((c) => { c.paper.mr = v; })} /></F>
              <F label="Bawah"><Num value={cfg.paper.mb} max={60} onChange={(v) => upd((c) => { c.paper.mb = v; })} /></F>
              <F label="Kiri"><Num value={cfg.paper.ml} max={60} onChange={(v) => upd((c) => { c.paper.ml = v; })} /></F>
            </div>
            <div className="text-xs text-zinc-400">Margin dalam mm.</div>
            <div className="grid grid-cols-2 gap-2">
              <F label="Jenis huruf">
                <Sel value={cfg.font.family} onChange={(v) => upd((c) => { c.font.family = v as DesignConfig["font"]["family"]; })}>
                  <option value="sans">Sans (Arial)</option><option value="serif">Serif (Times)</option><option value="mono">Monospace (Courier)</option>
                </Sel>
              </F>
              <F label="Ukuran (pt)"><Num value={cfg.font.size} min={6} max={16} step={0.5} onChange={(v) => upd((c) => { c.font.size = v; })} /></F>
            </div>
          </Sec>

          <Sec title="Kop Dokumen">
            <Chk checked={cfg.header.showCompany} onChange={(v) => upd((c) => { c.header.showCompany = v; })} label="Tampilkan nama perusahaan" />
            <div className="grid grid-cols-3 gap-2">
              <Chk checked={cfg.header.showAddress} onChange={(v) => upd((c) => { c.header.showAddress = v; })} label="Alamat" />
              <Chk checked={cfg.header.showPhone} onChange={(v) => upd((c) => { c.header.showPhone = v; })} label="Telp." />
              <Chk checked={cfg.header.showNpwp} onChange={(v) => upd((c) => { c.header.showNpwp = v; })} label="NPWP" />
            </div>
            <F label="Posisi judul">
              <Sel value={cfg.header.align} onChange={(v) => upd((c) => { c.header.align = v as "split" | "center"; })}>
                <option value="split">Perusahaan kiri, judul kanan</option><option value="center">Semua di tengah</option>
              </Sel>
            </F>
            <F label="Judul dokumen (kosong = otomatis)">
              <Input value={cfg.header.title} placeholder="mis. FAKTUR PENJUALAN" onChange={(e) => upd((c) => { c.header.title = e.target.value; })} />
            </F>
            <div className="grid grid-cols-2 gap-2">
              <Chk checked={cfg.header.showDocNo} onChange={(v) => upd((c) => { c.header.showDocNo = v; })} label="Nomor dokumen" />
              <Chk checked={cfg.header.rule} onChange={(v) => upd((c) => { c.header.rule = v; })} label="Garis pemisah" />
            </div>
          </Sec>

          <Sec title="Informasi Dokumen">
            <Chk checked={cfg.info.showParty} onChange={(v) => upd((c) => { c.info.showParty = v; })} label="Kotak customer / supplier" />
            {cfg.info.showParty && <>
              <F label="Judul kotak"><Input value={cfg.info.partyLabel} onChange={(e) => upd((c) => { c.info.partyLabel = e.target.value; })} /></F>
              <Chk checked={cfg.info.showContact} onChange={(v) => upd((c) => { c.info.showContact = v; })} label="Tampilkan u.p. (kontak)" />
            </>}
            <Chk checked={cfg.info.showRemarks} onChange={(v) => upd((c) => { c.info.showRemarks = v; })} label="Tampilkan keterangan dokumen" />
            <div className="text-xs text-zinc-500">Data di sisi kanan (urut sesuai dicentang):</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {META_FIELDS.map((m) => (
                <Chk key={m.key} checked={cfg.info.fields.includes(m.key)} label={m.label}
                  onChange={(v) => upd((c) => { c.info.fields = toggleIn(c.info.fields, m.key, v); })} />
              ))}
            </div>
          </Sec>

          <Sec title="Tabel Barang">
            <div className="space-y-1.5">
              {cfg.table.columns.map((c, i) => (
                <div key={c.key} className="grid grid-cols-[1fr_62px_auto] items-center gap-1.5 rounded-md border border-zinc-200 p-1.5">
                  <div>
                    <Input value={c.label} title={colDef(c.key)?.label} onChange={(e) => upd((x) => { x.table.columns[i].label = e.target.value; })} />
                    <div className="mt-0.5 text-[10px] text-zinc-400">{colDef(c.key)?.label} · {c.key}</div>
                  </div>
                  <Input type="number" min={5} max={200} placeholder="auto" value={c.width ?? ""} title="Lebar kolom (mm), kosong = otomatis"
                    onChange={(e) => upd((x) => { x.table.columns[i].width = e.target.value ? Number(e.target.value) : null; })} />
                  <div className="flex">
                    <button type="button" className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30" disabled={i === 0} onClick={() => moveCol(i, -1)}><ArrowUp size={13} /></button>
                    <button type="button" className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30" disabled={i === cfg.table.columns.length - 1} onClick={() => moveCol(i, 1)}><ArrowDown size={13} /></button>
                    <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" disabled={cfg.table.columns.length <= 1}
                      onClick={() => upd((x) => { x.table.columns.splice(i, 1); })}><X size={13} /></button>
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
            <div className="text-xs text-zinc-400">Lebar kolom dalam mm; kosongkan agar otomatis (sisa lebar).</div>
            <div className="grid grid-cols-2 gap-2">
              <F label="Garis tabel">
                <Sel value={cfg.table.border} onChange={(v) => upd((c) => { c.table.border = v as DesignConfig["table"]["border"]; })}>
                  <option value="full">Penuh (kotak)</option><option value="horizontal">Garis datar saja</option><option value="none">Tanpa garis</option>
                </Sel>
              </F>
              <F label="Baris minimal"><Num value={cfg.table.minRows} max={40} onChange={(v) => upd((c) => { c.table.minRows = v; })} /></F>
            </div>
            <Chk checked={cfg.table.itemSubline} onChange={(v) => upd((c) => { c.table.itemSubline = v; })} label="Kode & No. Reg. di bawah nama barang" />
          </Sec>

          <Sec title="Total & Terbilang">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {TOTAL_DEFS.map((t) => (
                <Chk key={t.key} checked={cfg.totals.show.includes(t.key)}
                  label={t.key === "ppn" ? "PPN" : t.key === "total" ? "Total" : t.label({})}
                  onChange={(v) => upd((c) => { c.totals.show = toggleIn(c.totals.show, t.key, v); })} />
              ))}
            </div>
            <Chk checked={cfg.totals.words} onChange={(v) => upd((c) => { c.totals.words = v; })} label="Tampilkan terbilang" />
          </Sec>

          <Sec title="Catatan & Tanda Tangan">
            <F label="Catatan di bawah tabel">
              <Textarea value={cfg.footer.note} onChange={(e) => upd((c) => { c.footer.note = e.target.value; })} />
            </F>
            <F label="Kolom tanda tangan (satu per baris)">
              <Textarea value={cfg.footer.signs.join("\n")} className="min-h-16"
                onChange={(e) => upd((c) => { c.footer.signs = e.target.value.split("\n"); })} />
            </F>
            <div className="grid grid-cols-2 gap-2">
              <F label="Tinggi ruang TTD (mm)"><Num value={cfg.footer.signHeight} max={60} onChange={(v) => upd((c) => { c.footer.signHeight = v; })} /></F>
              <div className="space-y-1 pt-4">
                <Chk checked={cfg.footer.showSignDate} onChange={(v) => upd((c) => { c.footer.showSignDate = v; })} label="Baris tanggal TTD" />
                <Chk checked={cfg.footer.showPrinted} onChange={(v) => upd((c) => { c.footer.showPrinted = v; })} label="Footer “Dicetak dari…”" />
              </div>
            </div>
          </Sec>
        </fieldset>

        {/* ------------------------- pratinjau ------------------------- */}
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>Pratinjau: <b>{!useSample && live ? `dokumen ${live.doc.name}` : "data contoh"}</b></span>
            {live && <Chk checked={useSample} onChange={setUseSample} label="Pakai data contoh" />}
            <span className="text-zinc-400">{cfg.paper.w} × {cfg.paper.h} mm</span>
          </div>
          <div ref={boxRef} className={cn("overflow-auto rounded-lg bg-zinc-200 p-3 lg:max-h-[calc(100vh-150px)]")}>
            <div style={{ zoom }}>
              <DesignPreview dt={dt} doc={data.doc} rows={data.rows} company={company} maker={data.maker} printedBy={data.printedBy} design={cfg} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
