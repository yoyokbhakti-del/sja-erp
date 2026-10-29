"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { byKey, docUrl, linkText } from "@/lib/doctypes";
import { cn } from "@/lib/format";

type Row = Record<string, unknown>;

export function LinkField({ target, value, label, onChange, disabled, className, placeholder, filters }: {
  target: string;
  value: unknown;
  label?: string;                    // teks tampilan untuk nilai saat ini
  onChange: (value: unknown, row: Row | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  filters?: Record<string, unknown>;
}) {
  const dt = byKey[target];
  const valueField = dt.valueField ?? "id";
  const [text, setText] = useState(label ?? "");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(label ?? ""), [label]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const sb = supabaseBrowser();
      const cols = Array.from(new Set([valueField, ...(dt.linkLabel ?? [dt.titleField]), dt.titleField]));
      let q = sb.from(dt.key).select("*").limit(15);
      const term = text.trim();
      if (term && term !== label) q = q.or(dt.searchFields.map((f) => `${f}.ilike.%${term.replace(/[,()]/g, " ")}%`).join(","));
      if (dt.fields.some((f) => f.name === "disabled")) q = q.eq("disabled", false);
      if (dt.submittable) q = q.eq("docstatus", 1);
      const f = filters ?? (target === "accounts" ? { is_group: false } : {});
      for (const [k, v] of Object.entries(f)) q = q.eq(k, v as string);
      q = dt.orderBy ? q.order(dt.orderBy.column, { ascending: dt.orderBy.ascending }) : q.order(cols[1] ?? valueField);
      const { data } = await q;
      setRows((data as Row[]) ?? []);
      setHi(0);
    }, 200);
    return () => clearTimeout(t);
  }, [open, text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setText(label ?? ""); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [label]);

  const pick = (r: Row | null) => {
    onChange(r ? r[valueField] : null, r);
    setText(r ? linkText(dt, r) : "");
    setOpen(false);
  };

  if (disabled) {
    return (
      <div className={cn("flex h-8 items-center gap-1 rounded-md bg-zinc-100 px-2.5 text-sm", className)}>
        <span className="truncate">{label || "—"}</span>
        {value && valueField === "id" ? (
          <Link href={docUrl(target, String(value))} className="ml-auto text-zinc-400 hover:text-zinc-700"><ExternalLink size={12} /></Link>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <input
        value={text}
        placeholder={placeholder ?? `Pilih ${dt.label}…`}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value) onChange(null, null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { setHi((h) => Math.min(h + 1, rows.length - 1)); e.preventDefault(); }
          if (e.key === "ArrowUp") { setHi((h) => Math.max(h - 1, 0)); e.preventDefault(); }
          if (e.key === "Enter" && open && rows[hi]) { pick(rows[hi]); e.preventDefault(); }
          if (e.key === "Escape") { setOpen(false); setText(label ?? ""); }
        }}
        className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white"
      />
      {open && (
        <div className="absolute left-0 top-9 z-30 max-h-64 w-full min-w-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
          {rows.length === 0 && <div className="px-3 py-2 text-xs text-zinc-400">Tidak ada hasil</div>}
          {rows.map((r, i) => (
            <button type="button" key={String(r[valueField])} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}
              className={cn("block w-full px-3 py-1.5 text-left text-sm", i === hi ? "bg-zinc-100" : "hover:bg-zinc-50")}>
              <div className="font-medium">{String(r[dt.titleField] ?? "")}</div>
              {dt.subtitleField && dt.subtitleField !== dt.titleField && !String(dt.subtitleField).endsWith("_id") && (
                <div className="text-xs text-zinc-500">{String(r[dt.subtitleField] ?? "")}</div>
              )}
            </button>
          ))}
          <Link href={docUrl(target, "new")} target="_blank"
            className="block border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50">+ Buat {dt.label} baru</Link>
        </div>
      )}
    </div>
  );
}
