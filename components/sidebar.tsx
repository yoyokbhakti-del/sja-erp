"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Landmark, LayoutDashboard, LogOut, Settings, ShoppingCart, Truck } from "lucide-react";
import { DOCTYPES, MODULES, docUrl } from "@/lib/doctypes";
import { cn } from "@/lib/format";
import { usePerms } from "@/components/perms";
import { supabaseBrowser } from "@/lib/supabase/client";

const ICONS = { Stok: Boxes, Pembelian: ShoppingCart, Penjualan: Truck, Akuntansi: Landmark, Pengaturan: Settings };

export function Sidebar() {
  const path = usePathname();
  const { can, email } = usePerms();
  const item = (href: string, label: string) => (
    <Link key={href} href={href}
      className={cn("block rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        (path === href || path.startsWith(href + "/")) && "bg-zinc-100 font-medium text-zinc-900")}>
      {label}
    </Link>
  );

  return (
    <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="text-sm font-bold">SJA ERP</div>
        <div className="truncate text-xs text-zinc-500">CV. Sekar Jaya Abadi</div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        <Link href="/" className={cn("flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-100", path === "/" && "bg-zinc-100 font-medium")}>
          <LayoutDashboard size={15} /> Dashboard
        </Link>
        {MODULES.map((m) => {
          const Icon = ICONS[m.name];
          const docs = DOCTYPES.filter((d) => d.module === m.name && can(d.key, "read"));
          const reports = (m.reports ?? []).filter((r) => can(r.perm, "read"));
          if (!docs.length && !reports.length) return null;
          return (
            <div key={m.name}>
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <Icon size={13} /> {m.name}
              </div>
              <div className="space-y-0.5">
                {docs.map((d) => item(docUrl(d.key), d.label))}
                {reports.length > 0 && docs.length > 0 && <div className="my-1 border-t border-dashed border-zinc-200" />}
                {reports.map((r) => item(r.href, r.label))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-xs">
        <span className="flex-1 truncate text-zinc-500">{email}</span>
        <button title="Keluar" className="text-zinc-400 hover:text-zinc-900"
          onClick={async () => { await supabaseBrowser().auth.signOut(); window.location.href = "/login"; }}>
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
