"use client";
// =====================================================================
// Pencetak berbasis Desain Cetakan (tata letak bebas). Elemen diletakkan
// dengan koordinat mm di bagian Kop (atas) dan Bawah; tabel barang berada
// di antaranya dan tingginya mengikuti jumlah baris.
// Komponen yang sama dipakai untuk cetak, pratinjau, dan editor kanvas.
// =====================================================================
import type React from "react";
import { Printer, X } from "lucide-react";
import type { DocType } from "@/lib/doctypes";
import { TOTAL_DEFS, buildVars, colDef, resolveText, type Band, type DesignConfig, type El } from "@/lib/print-design";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FONTS = {
  sans: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

// Antarmuka editor kanvas (opsional): tanpa ini komponen hanya mencetak
export type EditApi = {
  sel: string | null;                    // id elemen | "table" | null
  zoom: number;
  grid: number;
  guide: { band: Band; x?: number; y?: number } | null;
  onDown: (e: React.PointerEvent, id: string, mode: string) => void;
  onTable: () => void;
  onBlank: () => void;
  onBandResize: (e: React.PointerEvent, band: Band) => void;
};

function css(d: DesignConfig, scoped: boolean) {
  const p = d.paper;
  const fs = d.font.size;
  const t = d.table;
  const tfs = t.size > 0 ? t.size : fs;
  const line = t.border === "none" ? "none" : "0.6pt solid #000";
  return `
${scoped ? "" : `@page { size: ${p.w}mm ${p.h}mm; margin: ${p.mt}mm ${p.mr}mm ${p.mb}mm ${p.ml}mm; }`}
.dp-root { color: #000; ${scoped ? "" : "min-height: 100vh; background: #e5e5e5; padding: 18px 0 40px;"}
  font-family: ${FONTS[d.font.family]}; font-size: ${fs}pt; line-height: 1.3;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.dp-toolbar { margin: 0 auto 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: ${p.w}mm; max-width: 100%; }
.dp-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #000; background: #fff; color: #000;
  padding: 6px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; font-family: system-ui, sans-serif; }
.dp-primary { background: #000; color: #fff; }
.dp-hint { font-size: 11.5px; color: #555; font-family: system-ui, sans-serif; }
.dp-select { border: 1px solid #000; background: #fff; padding: 5px 8px; border-radius: 4px; font-size: 13px; font-family: system-ui, sans-serif; }
.dp-sheet { position: relative; margin: 0 auto; background: #fff; box-shadow: 0 1px 10px rgba(0,0,0,.15);
  display: flex; flex-direction: column; overflow: hidden; width: ${p.w}mm; min-height: ${p.h}mm;
  padding: ${p.mt}mm ${p.mr}mm ${p.mb}mm ${p.ml}mm; box-sizing: border-box; }
.dp-watermark { position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 80pt; font-weight: 700;
  letter-spacing: .08em; color: transparent; -webkit-text-stroke: 1.5px rgba(0,0,0,.12); pointer-events: none; white-space: nowrap; z-index: 0; }
.dp-band { position: relative; width: 100%; flex-shrink: 0; z-index: 1; break-inside: avoid; }
.dp-band.pin { margin-top: auto; }
.dp-el { position: absolute; box-sizing: border-box; }
.dp-items { width: 100%; border-collapse: collapse; position: relative; z-index: 1; table-layout: fixed; flex-shrink: 0; font-size: ${tfs}pt; }
.dp-items th, .dp-items td { ${t.border === "none" ? "" : t.border === "horizontal" ? "border-top: 0.6pt solid #000; border-bottom: 0.6pt solid #000;" : `border: ${line};`}
  padding: ${t.pad}mm ${Math.max(t.pad + 0.5, 1)}mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.dp-items thead th { font-weight: 700; font-size: ${Math.max(tfs - 1, 6)}pt; ${t.headUpper ? "text-transform: uppercase;" : ""} ${t.headBg ? "background: #e5e7eb;" : ""} }
.dp-items thead { display: table-header-group; }
.dp-items tr { break-inside: avoid; }
.dp-items .fill td { height: 6.5mm; }
.dp-r { text-align: right !important; } .dp-c { text-align: center !important; }
.dp-strong { font-weight: 700; } .dp-tiny { font-size: ${Math.max(tfs - 1.7, 5.5)}pt; }
${scoped ? "" : `@media print {
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .dp-root { background: #fff; padding: 0; min-height: 0; }
  .dp-sheet { box-shadow: none; margin: 0; width: auto; min-height: ${Math.max(p.h - p.mt - p.mb - 2, 10)}mm; padding: 0; overflow: visible; }
}`}`;
}

const mm = (n: number) => `${n}mm`;

// Isi satu elemen (tanpa posisi)
function ElBody({ el, vars, d, doc, rows, dtKey }: { el: El; vars: Record<string, string>; d: DesignConfig; doc: Row; rows: Row[]; dtKey: string }) {
  const size = el.size ?? d.font.size;
  const color = el.color || "#000";
  switch (el.type) {
    case "text": {
      const txt = resolveText(el.text ?? "", vars);
      return (
        <div style={{
          width: "100%", height: "100%", display: "flex", alignItems: el.valign === "m" ? "center" : el.valign === "b" ? "flex-end" : "flex-start",
          fontSize: `${size}pt`, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? "italic" : "normal",
          textDecoration: el.underline ? "underline" : "none", textTransform: el.upper ? "uppercase" : "none",
          textAlign: el.align === "c" ? "center" : el.align === "r" ? "right" : "left", color,
          letterSpacing: el.spacing ? mm(el.spacing) : undefined, fontFamily: el.family ? FONTS[el.family] : undefined,
        }}>
          <div style={{ width: "100%", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{txt}</div>
        </div>
      );
    }
    case "kv": {
      const items = (el.rows ?? []).map((r) => ({ label: r.label, value: vars[r.v] ?? "" })).filter((r) => r.value);
      return (
        <div style={{ fontSize: `${size}pt`, color, width: "100%" }}>
          {items.map((r, i) => (
            <div key={i} style={{ display: "flex", padding: "0.6mm 0" }}>
              <span style={{ width: mm(el.labelW ?? 30), flexShrink: 0, display: "flex", justifyContent: "space-between", paddingRight: "2mm" }}>
                <span>{r.label}</span><span>:</span>
              </span>
              <span style={{ flex: 1, overflowWrap: "anywhere" }}>{r.value}</span>
            </div>
          ))}
        </div>
      );
    }
    case "totals": {
      const items = (el.keys ?? []).map((k) => TOTAL_DEFS.find((t) => t.key === k))
        .filter((t): t is NonNullable<typeof t> => !!t).filter((t) => !t.only || t.only(dtKey, doc));
      return (
        <div style={{ fontSize: `${size}pt`, color, width: "100%" }}>
          {items.map((t) => (
            <div key={t.key} style={t.grand
              ? { display: "flex", justifyContent: "space-between", gap: "4mm", borderTop: "1px solid #000", borderBottom: "3px double #000", fontWeight: 700, padding: "1.5mm 0", fontSize: `${size + 1}pt` }
              : { display: "flex", justifyContent: "space-between", gap: "4mm", padding: "1mm 0" }}>
              <span>{t.label(doc)}</span><span>{t.get(doc, rows)}</span>
            </div>
          ))}
        </div>
      );
    }
    case "rect":
      return <div style={{
        width: "100%", height: "100%", boxSizing: "border-box", border: el.stroke ? `${mm(el.stroke)} ${el.dash ? "dashed" : "solid"} ${color}` : "none",
        background: el.fill || "transparent", borderRadius: mm(el.radius ?? 0),
      }} />;
    case "line": {
      const v = el.dir === "v";
      const st = `${mm(el.stroke ?? 0.25)} ${el.dash ? "dashed" : "solid"} ${color}`;
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={v ? { height: "100%", borderLeft: st } : { width: "100%", borderTop: st }} />
        </div>
      );
    }
    case "image": {
      const src = resolveText(el.src ?? "", vars);
      // eslint-disable-next-line @next/next/no-img-element
      return src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left top", display: "block" }} /> : null;
    }
  }
}

const HANDLES: { m: string; l: string; t: string; c: string }[] = [
  { m: "nw", l: "0%", t: "0%", c: "nwse-resize" }, { m: "n", l: "50%", t: "0%", c: "ns-resize" }, { m: "ne", l: "100%", t: "0%", c: "nesw-resize" },
  { m: "e", l: "100%", t: "50%", c: "ew-resize" }, { m: "se", l: "100%", t: "100%", c: "nwse-resize" }, { m: "s", l: "50%", t: "100%", c: "ns-resize" },
  { m: "sw", l: "0%", t: "100%", c: "nesw-resize" }, { m: "w", l: "0%", t: "50%", c: "ew-resize" },
];

export function DesignSheet({ dt, doc, rows, company, maker, printedBy, design, edit }: {
  dt: Pick<DocType, "key" | "label" | "printTitle">; doc: Row; rows: Row[]; company: Row; maker: string; printedBy: string; design: DesignConfig;
  edit?: EditApi;
}) {
  const watermark = !design.watermark ? "" : doc.docstatus === 0 ? "DRAFT" : doc.docstatus === 2 ? "DIBATALKAN" : "";
  const autoTitle = typeof dt.printTitle === "function" ? dt.printTitle(doc) : (dt.printTitle ?? dt.label.toUpperCase());
  const vars = buildVars({ dtKey: dt.key, title: autoTitle, doc, rows, company, maker, printedBy });
  const cols = design.table.columns.map((c) => ({ cfg: c, def: colDef(c.key)! })).filter((c) => c.def);
  const fill = Math.max(0, design.table.minRows - rows.length);
  const z = edit?.zoom ?? 1;
  const px = (n: number) => `${n / z}px`;

  const band = (b: Band) => {
    const h = b === "head" ? design.head.h : design.foot.h;
    const list = design.els.filter((e) => e.band === b);
    const grid = edit && edit.grid > 0 ? edit.grid : 0;
    return (
      <div className={`dp-band ${b === "foot" && design.foot.pin ? "pin" : ""}`} data-band={b}
        style={{
          height: mm(h),
          ...(edit ? {
            outline: `${px(1)} dashed #60a5fa`,
            backgroundImage: grid ? "radial-gradient(circle, rgba(37,99,235,.28) 0.35px, transparent 0.6px)" : undefined,
            backgroundSize: grid ? `${grid}mm ${grid}mm` : undefined,
          } : {}),
        }}>
        {list.map((el) => {
          const hiddenInPrint = !!el.hidden || (!!el.showIf && !vars[el.showIf]);
          if (hiddenInPrint && !edit) return null;
          const selected = edit?.sel === el.id;
          return (
            <div key={el.id} className="dp-el" data-id={el.id}
              style={{
                left: mm(el.x), top: mm(el.y), width: mm(el.w), height: mm(el.h),
                ...(edit ? {
                  cursor: "move", touchAction: "none", opacity: hiddenInPrint ? 0.3 : 1,
                  outline: selected ? `${px(1.5)} solid #2563eb` : `${px(0.5)} solid rgba(37,99,235,.25)`,
                } : {}),
              }}
              onPointerDown={edit ? (e) => { e.stopPropagation(); edit.onDown(e, el.id, "move"); } : undefined}>
              <ElBody el={el} vars={vars} d={design} doc={doc} rows={rows} dtKey={dt.key} />
              {edit && selected && !el.hidden && HANDLES.filter((h) => !(el.type === "line" && (el.dir === "v" ? ["e", "w", "ne", "nw", "se", "sw"] : ["n", "s", "ne", "nw", "se", "sw"]).includes(h.m))).map((h) => (
                <div key={h.m} onPointerDown={(e) => { e.stopPropagation(); edit.onDown(e, el.id, h.m); }}
                  style={{ position: "absolute", left: h.l, top: h.t, width: px(9), height: px(9), marginLeft: px(-4.5), marginTop: px(-4.5), background: "#fff",
                    border: `${px(1.5)} solid #2563eb`, borderRadius: px(2), cursor: h.c, touchAction: "none", zIndex: 5 }} />
              ))}
            </div>
          );
        })}
        {edit && edit.guide && edit.guide.band === b && <>
          {edit.guide.x !== undefined && <div style={{ position: "absolute", left: mm(edit.guide.x), top: 0, bottom: 0, borderLeft: `${px(1)} solid #ef4444`, zIndex: 6, pointerEvents: "none" }} />}
          {edit.guide.y !== undefined && <div style={{ position: "absolute", top: mm(edit.guide.y), left: 0, right: 0, borderTop: `${px(1)} solid #ef4444`, zIndex: 6, pointerEvents: "none" }} />}
        </>}
        {edit && (
          <>
            <div style={{ position: "absolute", left: 0, top: px(-14), fontSize: px(10), fontFamily: "system-ui, sans-serif", color: "#2563eb", pointerEvents: "none", whiteSpace: "nowrap", background: "rgba(255,255,255,.85)", padding: `0 ${px(4)}`, zIndex: 8 }}>
              {b === "head" ? "KOP / ATAS" : "BAWAH"} · tinggi {h} mm
            </div>
            <div onPointerDown={(e) => { e.stopPropagation(); edit.onBandResize(e, b); }}
              style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: px(8), cursor: "ns-resize", touchAction: "none", zIndex: 7 }}>
              <div style={{ margin: `${px(4)} auto 0`, width: px(36), height: px(3), background: "#60a5fa", borderRadius: px(2) }} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="dp-sheet" onPointerDown={edit ? () => edit.onBlank() : undefined}>
      {watermark && <div className="dp-watermark">{watermark}</div>}
      {band("head")}

      <table className="dp-items"
        style={edit ? { cursor: "pointer", outline: edit.sel === "table" ? `${px(2)} solid #2563eb` : `${px(0.5)} solid rgba(37,99,235,.25)` } : undefined}
        onPointerDown={edit ? (e) => { e.stopPropagation(); edit.onTable(); } : undefined}>
        <colgroup>{cols.map((c) => <col key={c.cfg.key} style={c.cfg.width ? { width: `${c.cfg.width}mm` } : undefined} />)}</colgroup>
        <thead>
          <tr>{cols.map((c) => <th key={c.cfg.key} className={c.def.align === "r" ? "dp-r" : c.def.align === "c" ? "dp-c" : ""}>{c.cfg.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {cols.map((c) => {
                const cls = c.def.align === "r" ? "dp-r" : c.def.align === "c" ? "dp-c" : "";
                const val = c.def.get(r, i, doc);
                if (c.cfg.key === "item_name" && design.table.itemSubline) {
                  const sub = [r.item?.code, r.item?.reg_number && `No. Reg. ${r.item.reg_number}`].filter(Boolean).join(" · ");
                  return <td key={c.cfg.key} className={cls}><div className="dp-strong">{val}</div>{sub && <div className="dp-tiny">{sub}</div>}</td>;
                }
                return <td key={c.cfg.key} className={cls}>{val}</td>;
              })}
            </tr>
          ))}
          {Array.from({ length: fill }).map((_, i) => (
            <tr key={`f${i}`} className="fill">{cols.map((c) => <td key={c.cfg.key} />)}</tr>
          ))}
        </tbody>
      </table>

      {band("foot")}
    </div>
  );
}

// Halaman cetak penuh (toolbar + lembar)
export function DesignPrint({ dt, doc, rows, company, maker, printedBy, design, designs, currentId, onPick }: {
  dt: DocType; doc: Row; rows: Row[]; company: Row; maker: string; printedBy: string; design: DesignConfig;
  designs: { id: string; name: string }[]; currentId: string; onPick: (id: string) => void;
}) {
  const p = design.paper;
  return (
    <div className="dp-root">
      <style>{css(design, false)}</style>
      <div className="dp-toolbar no-print">
        <button className="dp-btn dp-primary" onClick={() => window.print()}><Printer size={15} /> Cetak / Simpan PDF</button>
        <button className="dp-btn" onClick={() => window.close()}><X size={15} /> Tutup</button>
        {designs.length > 0 && (
          <select className="dp-select" value={currentId} onChange={(e) => onPick(e.target.value)} title="Pilih desain cetakan">
            {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="bawaan">Tata letak bawaan</option>
          </select>
        )}
        <span className="dp-hint">Kertas: <b>{p.w} × {p.h} mm</b>. Di jendela cetak pilih ukuran kertas yang sama, Margins: <i>Default</i>, Scale: <i>100</i>, dan matikan &ldquo;Headers and footers&rdquo;.</span>
      </div>
      <DesignSheet dt={dt} doc={doc} rows={rows} company={company} maker={maker} printedBy={printedBy} design={design} />
    </div>
  );
}

// Pratinjau / kanvas editor: lembar saja, gaya dibatasi pada elemen pembungkus
export function DesignPreview(props: Parameters<typeof DesignSheet>[0]) {
  return (
    <div className="dp-root dp-scoped">
      <style>{css(props.design, true)}</style>
      <DesignSheet {...props} />
    </div>
  );
}
