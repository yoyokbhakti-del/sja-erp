"use client";
// Komponen dasar bergaya shadcn/ui (ditulis langsung agar tanpa dependensi tambahan)
import * as React from "react";
import { cn, statusColor } from "@/lib/format";

type BtnVariant = "default" | "primary" | "danger" | "ghost" | "outline";
export const Button = React.forwardRef<HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }>(
  ({ className, variant = "default", size = "md", ...p }, ref) => (
    <button ref={ref} {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "default" && "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
        variant === "outline" && "border border-zinc-200 bg-white hover:bg-zinc-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "hover:bg-zinc-100",
        className)} />
  ));
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input ref={ref} {...p}
      className={cn("h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white disabled:bg-zinc-100 disabled:text-zinc-600 read-only:bg-zinc-100", className)} />
  ));
Input.displayName = "Input";

export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cn("min-h-20 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400 focus:bg-white disabled:bg-zinc-100", p.className)} />
);

export const Select = ({ options, className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: string[] }) => (
  <select {...p} className={cn("h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm outline-none focus:border-zinc-400 disabled:bg-zinc-100", className)}>
    {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
  </select>
);

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={cn("rounded-lg border border-zinc-200 bg-white", className)} />
);

export const Badge = ({ status, docstatus, className }: { status?: string | null; docstatus?: number | null; className?: string }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", statusColor(status, docstatus), className)}>
    {status ?? "Draft"}
  </span>
);

export function Alert({ kind = "error", children, onClose }: { kind?: "error" | "success" | "info"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm",
      kind === "error" && "bg-red-50 text-red-800 ring-1 ring-red-200",
      kind === "success" && "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
      kind === "info" && "bg-blue-50 text-blue-800 ring-1 ring-blue-200")}>
      <div className="whitespace-pre-wrap">{children}</div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100">✕</button>}
    </div>
  );
}

export const PageHeader = ({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) => (
  <div className="sticky top-0 z-10 -mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/90 px-6 py-3 backdrop-blur">
    <div className="min-w-0">
      <h1 className="truncate text-lg font-semibold">{title}</h1>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th {...p} className={cn("whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-medium text-zinc-500", className)} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...p} className={cn("border-b border-zinc-100 px-3 py-2 text-sm", className)} />
);
