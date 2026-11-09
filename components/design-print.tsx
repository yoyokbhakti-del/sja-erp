"use client";
// =====================================================================
// Pencetak berbasis Desain Cetakan. Satu komponen untuk semua dokumen
// bertabel barang; tata letak diatur lewat DesignConfig (print_designs).
// =====================================================================
import { Printer, X } from "lucide-react";
import type { DocType } from "@/lib/doctypes";
import { terbilang, waktu } from "@/lib/format";
import { META_FIELDS, TOTAL_DEFS, colDef, type DesignConfig } from "@/lib/print-design";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FONTS = {
  sans: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

function css(d: DesignConfig, scoped: boolean) {
  const p = d.paper;
  const fs = d.font.size;
  const line = d.table.border === "none" ? "none" : "0.6pt solid #000";
  return `
${scoped ? "" : `@page { size: ${p.w}mm ${p.h}mm; margin: ${p.mt}mm ${p.mr}mm ${p.mb}mm ${p.ml}mm; }`}
.dp-root { color: #000; ${scoped ? "" : "min-height: 100vh; background: #e5e5e5; padding: 18px 0 40px;"}
  font-family: ${FONTS[d.font.family]}; font-size: ${fs}pt; line-height: 1.4; }
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
.dp-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; position: relative; z-index: 1; }
.dp-head.center { flex-direction: column; align-items: center; text-align: center; gap: 2mm; }
.dp-brand { flex: 1; min-width: 0; }
.dp-company { font-size: ${fs + 3.5}pt; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
.dp-small { font-size: ${Math.max(fs - 0.5, 6)}pt; }
.dp-titlebox { text-align: right; flex-shrink: 0; white-space: nowrap; }
.dp-head.center .dp-titlebox { text-align: center; }
.dp-title { font-size: ${fs + 4.5}pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.dp-docno { font-size: ${fs + 0.5}pt; margin-top: 1mm; }
.dp-chip { display: inline-block; margin-top: 1.5mm; padding: 0 2mm; border: 1px solid #000; font-size: ${Math.max(fs - 1.5, 6)}pt; font-weight: 700; text-transform: uppercase; }
.dp-rule { border-top: 2px solid #000; border-bottom: 0.5px solid #000; height: 1.2mm; margin: 3mm 0 5mm; }
.dp-gap { height: 4mm; }
.dp-info { display: grid; grid-template-columns: 1.1fr 1fr; gap: 8mm; margin-bottom: 5mm; position: relative; z-index: 1; }
.dp-info.single { grid-template-columns: 1fr; }
.dp-party-name { font-size: ${fs + 1}pt; font-weight: 700; }
.dp-label { font-size: ${Math.max(fs - 1.5, 6)}pt; font-weight: 700; text-transform: uppercase; margin-bottom: .8mm; }
.dp-meta { width: 100%; border-collapse: collapse; align-self: start; }
.dp-meta td { padding: .6mm 0; vertical-align: top; }
.dp-meta td:first-child { width: 40%; padding-right: 2mm; }
.dp-meta td:first-child::after { content: ":"; float: right; }
.dp-meta td:last-child { padding-left: 2mm; }
.dp-items { width: 100%; border-collapse: collapse; position: relative; z-index: 1; table-layout: fixed; }
.dp-items th, .dp-items td { ${d.table.border === "none" ? "" : d.table.border === "horizontal" ? "border-top: 0.6pt solid #000; border-bottom: 0.6pt solid #000;" : `border: ${line};`}
  padding: 1.5mm 2mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.dp-items thead th { font-weight: 700; font-size: ${Math.max(fs - 1, 6)}pt; text-transform: uppercase; }
.dp-items thead { display: table-header-group; }
.dp-items tr { break-inside: avoid; }
.dp-items .fill td { height: 6.5mm; }
.dp-r { text-align: right !important; } .dp-c { text-align: center !important; }
.dp-strong { font-weight: 700; } .dp-tiny { font-size: ${Math.max(fs - 1.7, 5.5)}pt; }
.dp-bottom { display: grid; grid-template-columns: 1fr 68mm; gap: 8mm; margin-top: 4mm; break-inside: avoid; position: relative; z-index: 1; }
.dp-bottom.no-totals { grid-template-columns: 1fr; }
.dp-notes { display: flex; flex-direction: column; gap: 3mm; }
.dp-note { font-size: ${Math.max(fs - 1, 6)}pt; white-space: pre-wrap; }
.dp-totals { align-self: start; }
.dp-totals > div { display: flex; justify-content: space-between; padding: 1mm 0; gap: 4mm; }
.dp-grand { border-top: 1px solid #000; border-bottom: 3px double #000; font-weight: 700; font-size: ${fs + 1}pt; padding: 1.5mm 0 !important; }
.dp-signs { display: grid; gap: 8mm; justify-content: space-between; margin-top: auto; padding-top: 10mm; break-inside: avoid; position: relative; z-index: 1; }
.dp-signs.one { justify-content: end; }
.dp-sign { text-align: center; }
.dp-sign-line { border-top: 1px solid #000; padding-top: 1mm; min-height: 5mm; }
.dp-sign-date { font-size: ${Math.max(fs - 1.5, 6)}pt; margin-top: 1mm; }
.dp-foot { display: flex; justify-content: space-between; margin-top: 6mm; padding-top: 1.5mm; border-top: 0.5px solid #000; font-size: ${Math.max(fs - 2, 5.5)}pt; position: relative; z-index: 1; }
${scoped ? "" : `@media print {
  .no-print { display: none !important; }
  html, body { background: #fff !important; }
  .dp-root { background: #fff; padding: 0; min-height: 0; }
  .dp-sheet { box-shadow: none; margin: 0; width: auto; min-height: ${Math.max(p.h - p.mt - p.mb - 2, 10)}mm; padding: 0; }
}`}`;
}

export function DesignSheet({ dt, doc, rows, company, maker, printedBy, design }: {
  dt: Pick<DocType, "key" | "label" | "printTitle">; doc: Row; rows: Row[]; company: Row; maker: string; printedBy: string; design: DesignConfig;
}) {
  const h = design.header;
  const watermark = doc.docstatus === 0 ? "DRAFT" : doc.docstatus === 2 ? "DIBATALKAN" : "";
  const autoTitle = typeof dt.printTitle === "function" ? dt.printTitle(doc) : (dt.printTitle ?? dt.label.toUpperCase());
  const title = h.title.trim() || autoTitle;
  const head = company.print_name || company.name || "";
  const addr = [company.address, company.city].filter(Boolean).join(", ");
  const p = doc.party as Row | undefined;

  const meta = design.info.fields
    .map((k) => META_FIELDS.find((m) => m.key === k))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => [m.label, m.get(doc)] as const)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as const);

  const cols = design.table.columns.map((c) => ({ cfg: c, def: colDef(c.key)! })).filter((c) => c.def);
  const fill = Math.max(0, design.table.minRows - rows.length);
  const totals = design.totals.show
    .map((k) => TOTAL_DEFS.find((t) => t.key === k))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .filter((t) => !t.only || t.only(dt.key, doc));
  const showInfoLeft = design.info.showParty;
  const hasInfo = showInfoLeft || meta.length > 0;
  const signs = design.footer.signs.map((s) => s.trim()).filter(Boolean);
  const showWords = design.totals.words && doc.grand_total !== undefined && doc.grand_total !== null;
  const hasBottom = showWords || totals.length > 0 || !!design.footer.note.trim() || (design.info.showRemarks && doc.remarks);

  return (
    <div className="dp-sheet">
      {watermark && <div className="dp-watermark">{watermark}</div>}

      <header className={`dp-head ${h.align === "center" ? "center" : ""}`}>
        {h.showCompany && (
          <div className="dp-brand">
            <div className="dp-company">{head}</div>
            {h.showAddress && addr && <div className="dp-small">{addr}</div>}
            {(h.showPhone || h.showNpwp) && (
              <div className="dp-small">
                {[h.showPhone && company.phone && `Telp. ${company.phone}`, h.showNpwp && company.npwp && `NPWP ${company.npwp}`].filter(Boolean).join("  ·  ")}
              </div>
            )}
          </div>
        )}
        <div className="dp-titlebox">
          <div className="dp-title">{title}</div>
          {h.showDocNo && <div className="dp-docno">{doc.name}</div>}
          {watermark && <div className="dp-chip">{watermark === "DRAFT" ? "Draft – belum sah" : "Dibatalkan"}</div>}
        </div>
      </header>
      {h.rule ? <div className="dp-rule" /> : <div className="dp-gap" />}

      {hasInfo && (
        <section className={`dp-info ${showInfoLeft && meta.length ? "" : "single"}`}>
          {showInfoLeft && (p ? (
            <div>
              <div className="dp-label">{design.info.partyLabel}</div>
              <div className="dp-party-name">{p.name}</div>
              {design.info.showContact && p.contact_person && <div>u.p. {p.contact_person}</div>}
              {p.address && <div>{p.address}</div>}
              {p.city && <div>{p.city}</div>}
              {(p.phone || p.npwp) && <div className="dp-small">{[p.phone && `Telp. ${p.phone}`, p.npwp && `NPWP ${p.npwp}`].filter(Boolean).join(" · ")}</div>}
            </div>
          ) : (
            <div><div className="dp-label">Keterangan</div><div>{doc.remarks || "—"}</div></div>
          ))}
          {meta.length > 0 && (
            <table className="dp-meta"><tbody>
              {meta.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
            </tbody></table>
          )}
        </section>
      )}

      <table className="dp-items">
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

      {hasBottom && (
        <section className={`dp-bottom ${totals.length ? "" : "no-totals"}`}>
          <div className="dp-notes">
            {showWords && <div><div className="dp-label">Terbilang</div><i>{terbilang(Number(doc.grand_total || 0))}</i></div>}
            {design.info.showRemarks && doc.remarks && p && <div><div className="dp-label">Keterangan</div><div>{doc.remarks}</div></div>}
            {design.footer.note.trim() && <div className="dp-note">{design.footer.note}</div>}
          </div>
          {totals.length > 0 && (
            <div className="dp-totals">
              {totals.map((t) => (
                <div key={t.key} className={t.grand ? "dp-grand" : ""}><span>{t.label(doc)}</span><span>{t.get(doc, rows)}</span></div>
              ))}
            </div>
          )}
        </section>
      )}

      {signs.length > 0 && (
        <section className={`dp-signs ${signs.length === 1 ? "one" : ""}`} style={{ gridTemplateColumns: `repeat(${signs.length}, 52mm)` }}>
          {signs.map((s, i) => (
            <div key={s + i} className="dp-sign">
              <div>{s}</div>
              <div style={{ height: `${design.footer.signHeight}mm` }} />
              <div className="dp-sign-line">{i === 0 && maker && ["Dibuat oleh", "Hormat kami"].includes(s) ? maker : " "}</div>
              {design.footer.showSignDate && <div className="dp-sign-date">Tgl. ____________</div>}
            </div>
          ))}
        </section>
      )}

      {design.footer.showPrinted && (
        <footer className="dp-foot">
          <span>Dicetak dari SJA ERP · {waktu(new Date().toISOString())}{printedBy ? ` · ${printedBy}` : ""}</span>
          <span>{doc.name}</span>
        </footer>
      )}
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

// Pratinjau di editor: lembar saja, gaya dibatasi pada elemen pembungkus
export function DesignPreview(props: Parameters<typeof DesignSheet>[0]) {
  return (
    <div className="dp-root dp-scoped">
      <style>{css(props.design, true)}</style>
      <DesignSheet {...props} />
    </div>
  );
}

