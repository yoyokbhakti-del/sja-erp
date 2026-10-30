"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/format";

type Theme = "light" | "dark" | "system";

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// Dipasang di <head> supaya tema sudah benar sebelum halaman tampil (tidak berkedip)
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try { setTheme((localStorage.getItem("theme") as Theme) || "system"); } catch {}
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  const choose = (t: Theme) => {
    setTheme(t);
    try { localStorage.setItem("theme", t); } catch {}
  };

  const opts: { v: Theme; label: string; Icon: typeof Sun }[] = [
    { v: "light", label: "Terang", Icon: Sun },
    { v: "dark", label: "Gelap", Icon: Moon },
    { v: "system", label: "Otomatis", Icon: Monitor },
  ];
  return (
    <div className={cn("grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-0.5", className)} role="radiogroup" aria-label="Tampilan">
      {opts.map(({ v, label, Icon }) => (
        <button key={v} role="radio" aria-checked={theme === v} title={label} onClick={() => choose(v)}
          className={cn("flex items-center justify-center gap-1 rounded px-1 py-1 text-[11px]",
            theme === v ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
}
