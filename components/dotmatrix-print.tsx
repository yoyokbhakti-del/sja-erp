"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Printer, RefreshCw, X, FileText } from "lucide-react";
import { buildPages, buildTestPage, toEscP, COLS, LINES, type EscOpts } from "@/lib/escp";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QZ = any;

declare global {
  interface Window { qz?: QZ }
}

const LS_PRINTER = "sja.dm.printer";
const LS_OPTS = "sja.dm.opts";

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } }

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Muat qz-tray.js (disalin ke /public) sekali saja, lalu siapkan keamanan. */
let qzReady: Promise<QZ> | null = null;
function loadQz(): Promise<QZ> {
  if (qzReady) return qzReady;
  qzReady = new Promise<QZ>((resolve, reject) => {
    if (window.qz) return resolve(window.qz);
    const s = document.createElement("script");
    s.src = "/qz-tray.js";
    s.async = true;
    s.onload = () => (window.qz ? resolve(window.qz) : reject(new Error("qz-tray.js gagal dimuat")));
    s.onerror = () => reject(new Error("qz-tray.js gagal dimuat"));
    document.head.appendChild(s);
  }).then((qz) => {
    qz.api.setPromiseType((resolver: (res: (v?: unknown) => void, rej: (e?: unknown) => void) => void) => new Promise(resolver));
    // Sertifikat & tanda tangan opsional (env QZ_CERTIFICATE + QZ_PRIVATE_KEY di Vercel).
    // Bila tidak diisi, QZ Tray tetap mencetak tetapi menampilkan dialog "Allow".
    let cert: string | null = null;
    qz.security.setCertificatePromise((resolve: (v?: string) => void) => {
      fetch("/api/qz/cert", { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .then((t) => { cert = t || null; resolve(t || undefined); })
        .catch(() => resolve(undefined));
    });
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise((toSign: string) => (resolve: (v?: string) => void) => {
      if (!cert) return resolve(undefined);
      fetch("/api/qz/sign", { method: "POST", body: toSign, cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .then((t) => resolve(t || undefined))
        .catch(() => resolve(undefined));
    });
    return qz;
  });
  qzReady.catch(() => { qzReady = null; });
  return qzReady;
}

async function connectQz(): Promise<QZ> {
  const qz = await loadQz();
  if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
  return qz;
}

export function DotMatrixPrint({ dtKey, doc, rows, company, onGraphic }: {
  dtKey: string; doc: Row; rows: Row[]; company: Row; onGraphic: () => void;
}) {
  const [opts, setOpts] = useState<Required<EscOpts>>(() => {
    const d = { nlq: true, dark: true, topMm: 0, roman: false };
    try { return { ...d, ...JSON.parse(lsGet(LS_OPTS) || "{}") }; } catch { return d; }
  });
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const pages = useMemo(() => buildPages(dtKey, doc, rows, company), [dtKey, doc, rows, company]);

  useEffect(() => { lsSet(LS_OPTS, JSON.stringify(opts)); }, [opts]);
  useEffect(() => { document.title = `${doc.name} – cetak dot-matrix`; }, [doc.name]);

  async function findPrinters() {
    setBusy(true);
    setStatus({ kind: "info", text: "Menghubungi QZ Tray…" });
    try {
      const qz = await connectQz();
      const list: string[] = await qz.printers.find();
      setPrinters(list);
      const saved = lsGet(LS_PRINTER);
      const pick = (saved && list.includes(saved) && saved)
        || list.find((p) => /LX-?310/i.test(p)) || list.find((p) => /EPSON/i.test(p)) || list[0] || "";
      setPrinter(pick);
      setStatus({ kind: "ok", text: `QZ Tray tersambung. ${list.length} printer ditemukan.` });
    } catch (e) {
      setStatus({ kind: "err", text: "QZ Tray belum berjalan di komputer ini. Pasang/jalankan QZ Tray (qz.io/download), lalu klik \"Cari printer\". Sementara itu bisa pakai \"Unduh .prn\"." });
      console.error(e);
    } finally { setBusy(false); }
  }

  // coba sambung otomatis sekali (tanpa mengganggu bila QZ belum terpasang)
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    findPrinters();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function print(test = false) {
    if (!printer) return findPrinters();
    setBusy(true);
    setStatus({ kind: "info", text: `Mengirim ke ${printer}…` });
    try {
      const qz = await connectQz();
      lsSet(LS_PRINTER, printer);
      const cfg = qz.configs.create(printer);
      const data = toBase64(toEscP(test ? buildTestPage() : pages, opts));
      await qz.print(cfg, [{ type: "raw", format: "command", flavor: "base64", data }]);
      setStatus({ kind: "ok", text: test ? `Lembar uji terkirim ke ${printer}.` : `Terkirim ke ${printer} (${pages.length} lembar).` });
    } catch (e) {
      setStatus({ kind: "err", text: `Gagal mencetak: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setBusy(false); }
  }

  function download() {
    const bytes = toEscP(pages, opts);
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name}.prn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const set = <K extends keyof EscOpts>(k: K, v: Required<EscOpts>[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="dm-root">
      <style>{CSS}</style>
      <div className="dm-bar">
        <div className="dm-row">
          <button className="dm-btn dm-primary" disabled={busy} onClick={() => print()}><Printer size={15} /> Cetak ke printer</button>
          <select className="dm-sel" value={printer} onChange={(e) => setPrinter(e.target.value)} disabled={!printers.length}>
            {!printers.length && <option value="">— printer belum ditemukan —</option>}
            {printers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="dm-btn" disabled={busy} onClick={findPrinters}><RefreshCw size={14} /> Cari printer</button>
          <button className="dm-btn" disabled={busy} onClick={() => print(true)}>Cetak lembar uji</button>
          <button className="dm-btn" onClick={download}><Download size={14} /> Unduh .prn</button>
          <button className="dm-btn" onClick={onGraphic}><FileText size={14} /> Cetak grafis (PDF)</button>
          <button className="dm-btn" onClick={() => window.close()}><X size={14} /> Tutup</button>
        </div>
        <div className="dm-row dm-opts">
          <label><input type="radio" checked={opts.nlq} onChange={() => set("nlq", true)} /> NLQ (tajam)</label>
          <label><input type="radio" checked={!opts.nlq} onChange={() => set("nlq", false)} /> Draft (cepat)</label>
          <span className="dm-sep" />
          <label><input type="checkbox" checked={opts.dark} onChange={(e) => set("dark", e.target.checked)} /> Huruf tebal/hitam (cetak dobel)</label>
          <label><input type="checkbox" checked={opts.roman} onChange={(e) => set("roman", e.target.checked)} /> Huruf Roman</label>
          <span className="dm-sep" />
          <label>Geser ke bawah
            <input type="number" min={0} max={7} step={0.5} value={opts.topMm}
              onChange={(e) => set("topMm", Math.max(0, Math.min(7, Number(e.target.value) || 0)))} /> mm</label>
        </div>
        {status && <div className={`dm-status dm-${status.kind}`}>{status.text}</div>}
        <div className="dm-hint">
          Kertas continuous form <b>9,5 × 11 inci</b> · {COLS} kolom × {LINES} baris (12 cpi, 1/8&Prime;) · {pages.length} lembar.
          Sebelum mencetak, posisikan tepi atas lembar pertama tepat di garis awal cetak printer (tombol <i>Load/Eject</i>). Pergeseran kiri–kanan diatur dari posisi traktor kiri.
        </div>
      </div>

      <div className="dm-pages">
        {pages.map((cv, i) => (
          <div key={i} className="dm-paper">
            <pre>{cv.ch.map((line, r) => <div key={r}>{segments(line, cv.bold[r])}</div>)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// Garis kotak digambar dengan CSS agar pratinjau tersambung rapat seperti hasil printer
const ARMS: Record<string, string> = { // u=atas d=bawah l=kiri r=kanan
  "─": "lr", "│": "ud", "┌": "dr", "┐": "dl", "└": "ur", "┘": "ul",
  "├": "udr", "┤": "udl", "┬": "dlr", "┴": "ulr", "┼": "udlr",
};
const ARM_BG: Record<string, string> = {
  l: "linear-gradient(#111,#111) left center / 52% 1.4px no-repeat",
  r: "linear-gradient(#111,#111) right center / 52% 1.4px no-repeat",
  u: "linear-gradient(#111,#111) center top / 1.4px 52% no-repeat",
  d: "linear-gradient(#111,#111) center bottom / 1.4px 52% no-repeat",
};
function segments(line: string[], bold: boolean[]) {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < line.length) {
    const arms = ARMS[line[i]];
    if (arms) {
      out.push(<span key={i} className="bx" style={{ background: [...arms].map((a) => ARM_BG[a]).join(",") }} />);
      i++;
      continue;
    }
    const b = bold[i];
    let j = i;
    while (j < line.length && bold[j] === b && !ARMS[line[j]]) j++;
    const t = line.slice(i, j).join("");
    const st = { width: `${(j - i) * 2.1167}mm` };
    out.push(b ? <b key={i} className="tx" style={st}>{t}</b> : <span key={i} className="tx" style={st}>{t}</span>);
    i = j;
  }
  return out.length ? out : " ";
}

const CSS = `
.dm-root { min-height: 100vh; background: #e4e4e7; font-family: system-ui, sans-serif; color: #18181b; padding-bottom: 40px; }
.dm-bar { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid #d4d4d8; padding: 10px 16px; display: grid; gap: 8px; }
.dm-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dm-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #a1a1aa; background: #fff; border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.dm-btn:disabled { opacity: .5; cursor: wait; }
.dm-primary { background: #18181b; color: #fff; border-color: #18181b; }
.dm-sel { border: 1px solid #a1a1aa; border-radius: 6px; padding: 6px 8px; font-size: 13px; min-width: 220px; background: #fff; }
.dm-opts { font-size: 13px; gap: 14px; }
.dm-opts label { display: inline-flex; align-items: center; gap: 5px; }
.dm-opts input[type=number] { width: 56px; border: 1px solid #a1a1aa; border-radius: 4px; padding: 2px 4px; margin-left: 4px; }
.dm-sep { width: 1px; height: 18px; background: #d4d4d8; }
.dm-status { font-size: 13px; padding: 6px 10px; border-radius: 6px; }
.dm-info { background: #f4f4f5; } .dm-ok { background: #ecfdf5; color: #065f46; } .dm-err { background: #fef2f2; color: #991b1b; }
.dm-hint { font-size: 12px; color: #52525b; }
.dm-pages { display: grid; gap: 18px; justify-content: center; padding: 20px 8px; overflow-x: auto; }
.dm-paper { background: #fff; width: 241.3mm; height: 279.4mm; box-shadow: 0 1px 4px rgba(0,0,0,.25); padding: 0 6.35mm; box-sizing: border-box; overflow: hidden;
  background-image: radial-gradient(circle, #d4d4d8 1.6mm, transparent 1.7mm), radial-gradient(circle, #d4d4d8 1.6mm, transparent 1.7mm);
  background-size: 12.7mm 12.7mm; background-position: -3.2mm 0, calc(100% + 3.2mm) 0; background-repeat: repeat-y; }
.dm-paper pre div { height: 3.175mm; line-height: 3.175mm; white-space: pre; }
.dm-paper pre .tx { display: inline-block; vertical-align: top; height: 3.175mm; }
.dm-paper pre .bx { display: inline-block; width: 2.1167mm; height: 3.175mm; vertical-align: top; }
.dm-paper pre b { font-weight: 700; }
.dm-paper pre { margin: 0 auto; width: 203.2mm; font-family: "Courier New", Courier, monospace; font-size: 3.53mm; line-height: 3.175mm; letter-spacing: 0; white-space: pre; color: #111;
  /* 12 cpi: tiap karakter 2,117 mm; Courier lebar 0,6 em -> font-size 3,53 mm */ }
`;
