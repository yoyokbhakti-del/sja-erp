"use client";
// =====================================================================
// Menu kiri bergaya Accurate: lajur ikon modul berwarna biru tua,
// klik modul -> panel menu (Data Master / Transaksi / Laporan) di sebelahnya.
// =====================================================================
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, BookOpen, Boxes, Building, ChartColumn, ChartPie, ChevronRight, ClipboardCheck, ClipboardList,
  Factory, FileText, FlaskConical, HandCoins, Hourglass, Landmark, LayoutDashboard, Layers, Library, ListTree,
  LogOut, NotebookPen, Package, PackageCheck, Printer, Receipt, Ruler, Scale, ScrollText, Settings, Shield,
  ShoppingBag, ShoppingCart, Store, Tags, Truck, Undo2, UserRound, Users, Wallet, Warehouse, X,
  type LucideIcon,
} from "lucide-react";
import { DOCTYPES, MODULES, docUrl, type DocType } from "@/lib/doctypes";
import { cn } from "@/lib/format";
import { usePerms } from "@/components/perms";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";

type Mod = DocType["module"];
const MOD_ICON: Record<Mod, LucideIcon> = {
  Stok: Boxes, Produksi: Factory, Pembelian: ShoppingCart, Penjualan: Truck, Akuntansi: Landmark, Pengaturan: Settings,
};
const MOD_LABEL: Record<Mod, string> = {
  Stok: "Persediaan", Produksi: "Produksi", Pembelian: "Pembelian", Penjualan: "Penjualan", Akuntansi: "Akuntansi", Pengaturan: "Pengaturan",
};
const DOC_ICON: Record<string, LucideIcon> = {
  items: Package, warehouses: Warehouse, stock_entries: ArrowLeftRight, stock_reconciliations: ClipboardCheck,
  boms: FlaskConical, work_orders: Factory,
  suppliers: Store, purchase_orders: ClipboardList, purchase_receipts: PackageCheck, purchase_invoices: Receipt, purchase_returns: Undo2,
  customers: UserRound, sales_orders: ShoppingBag, delivery_notes: Truck, sales_invoices: FileText, sales_returns: Undo2,
  payment_entries: HandCoins, journal_entries: NotebookPen, accounts: ListTree,
  uoms: Ruler, item_groups: Tags, companies: Building,
};
const REPORT_ICON: Record<string, LucideIcon> = {
  "/reports/stock-balance": Layers, "/reports/batch-stock": Hourglass, "/reports/stock-ledger": BookOpen,
  "/reports/payable": Wallet, "/reports/receivable": Wallet,
  "/reports/general-ledger": Library, "/reports/trial-balance": Scale, "/reports/profit-loss": ChartColumn, "/reports/balance-sheet": ChartPie,
  "/users": Users, "/print-designs": Printer, "/audit-log": ScrollText,
};

type Entry = { href: string; label: string; Icon: LucideIcon };
type Group = { title: string; entries: Entry[] };

const isOn = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Sidebar() {
  const path = usePathname();
  const { can, email } = usePerms();
  const [open, setOpen] = useState<Mod | "akun" | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);

  // menu per modul, sesuai hak akses
  const mods = MODULES.map((m) => {
    const docs = DOCTYPES.filter((d) => d.module === m.name && can(d.key, "read"));
    const toEntry = (d: DocType): Entry => ({ href: docUrl(d.key), label: d.label, Icon: DOC_ICON[d.key] ?? FileText });
    const reports = (m.reports ?? []).filter((r) => can(r.perm, "read"))
      .map((r): Entry => ({ href: r.href, label: r.label, Icon: REPORT_ICON[r.href] ?? ChartColumn }));
    const groups: Group[] = [
      { title: "Data Master", entries: docs.filter((d) => d.isMaster).map(toEntry) },
      { title: "Transaksi", entries: docs.filter((d) => !d.isMaster).map(toEntry) },
      { title: m.name === "Pengaturan" ? "Sistem" : "Laporan", entries: reports },
    ].filter((g) => g.entries.length);
    return { name: m.name, groups };
  }).filter((m) => m.groups.length);

  const activeMod = mods.find((m) => m.groups.some((g) => g.entries.some((e) => isOn(path, e.href))))?.name;

  // tutup panel saat pindah halaman, klik di luar, atau tekan Esc
  useEffect(() => { setOpen(null); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || railRef.current?.contains(t)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const railBtn = (key: Mod | "akun" | "home", label: string, Icon: LucideIcon, active: boolean, onClick?: () => void, href?: string) => {
    const cls = cn(
      "group relative flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[10.5px] leading-tight text-[#c9d8ee] transition-colors hover:bg-[#ffffff1a] hover:text-[#fff]",
      active && "bg-[#ffffff26] text-[#fff]",
      open === key && "bg-white text-[#123d73] hover:bg-white hover:text-[#123d73] dark:text-[#9cc0f0] dark:hover:text-[#9cc0f0]",
    );
    const inner = <>
      {active && open !== key && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#fbbf24]" />}
      <Icon size={21} strokeWidth={1.8} />
      <span className="w-full truncate text-center">{label}</span>
    </>;
    return href
      ? <Link key={key} href={href} className={cls} title={label}>{inner}</Link>
      : <button key={key} type="button" className={cls} title={label} onClick={onClick}>{inner}</button>;
  };

  const current = mods.find((m) => m.name === open);

  return (
    <>
      <aside ref={railRef}
        className="no-print sticky top-0 z-40 flex h-screen h-dvh w-[78px] shrink-0 flex-col bg-[#123d73] text-[#fff] shadow-[1px_0_0_rgba(0,0,0,.08)] dark:bg-[#0d2a50]">
        <Link href="/" className="flex flex-col items-center border-b border-[#ffffff1a] py-3" title="SJA ERP">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#fff] text-[13px] font-extrabold tracking-tight text-[#123d73]">SJA</span>
          <span className="mt-1 text-[10px] font-semibold tracking-wide text-[#c9d8ee]">ERP</span>
        </Link>
        <nav className="flex-1 overflow-y-auto py-1 [scrollbar-width:none]">
          {railBtn("home", "Beranda", LayoutDashboard, path === "/", undefined, "/")}
          {mods.map((m) => railBtn(m.name, MOD_LABEL[m.name], MOD_ICON[m.name], activeMod === m.name,
            () => setOpen(open === m.name ? null : m.name)))}
        </nav>
        <div className="border-t border-[#ffffff1a] py-1">
          <button type="button" title={email} onClick={() => setOpen(open === "akun" ? null : "akun")}
            className={cn("flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[10.5px] text-[#c9d8ee] hover:bg-[#ffffff1a] hover:text-[#fff]",
              open === "akun" && "bg-white text-[#123d73] hover:bg-white hover:text-[#123d73] dark:text-[#9cc0f0] dark:hover:text-[#9cc0f0]")}>
            <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold uppercase",
              open === "akun" ? "bg-[#123d73] text-[#fff]" : "bg-[#ffffff33] text-[#fff]")}>{email.slice(0, 1)}</span>
            Akun
          </button>
        </div>
      </aside>

      {open && (
        <div ref={panelRef}
          className="no-print fixed bottom-0 left-[78px] top-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              {current ? <>{(() => { const I = MOD_ICON[current.name]; return <I size={16} className="text-[#123d73] dark:text-[#9cc0f0]" />; })()} {MOD_LABEL[current.name]}</>
                : <><Shield size={16} className="text-[#123d73] dark:text-[#9cc0f0]" /> Akun</>}
            </div>
            <button type="button" onClick={() => setOpen(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700" title="Tutup (Esc)">
              <X size={16} />
            </button>
          </div>

          {current ? (
            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              {current.groups.map((g) => (
                <div key={g.title}>
                  <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.title}</div>
                  <div className="space-y-0.5">
                    {g.entries.map(({ href, label, Icon }) => (
                      <Link key={href} href={href}
                        className={cn("group flex items-center gap-3 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-[#eaf1fb] hover:text-[#123d73] dark:hover:bg-zinc-100 dark:hover:text-[#9cc0f0]",
                          isOn(path, href) && "bg-[#eaf1fb] font-medium text-[#123d73] dark:bg-zinc-100 dark:text-[#9cc0f0]")}>
                        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 group-hover:bg-white group-hover:text-[#123d73] dark:group-hover:text-[#9cc0f0]",
                          isOn(path, href) && "bg-white text-[#123d73] dark:text-[#9cc0f0]")}>
                          <Icon size={15} />
                        </span>
                        <span className="flex-1 truncate">{label}</span>
                        <ChevronRight size={14} className="text-zinc-300 opacity-0 group-hover:opacity-100" />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 space-y-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#123d73] text-sm font-semibold uppercase text-[#fff]">
                  {email.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-800" title={email}>{email}</div>
                  <div className="text-xs text-zinc-500">CV. Sekar Jaya Abadi</div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Tampilan</div>
                <ThemeToggle />
              </div>
              <button
                onClick={async () => {
                  if (!confirm("Keluar dari SJA ERP?")) return;
                  await supabaseBrowser().auth.signOut();
                  window.location.href = "/login";
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                <LogOut size={14} /> Keluar
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
