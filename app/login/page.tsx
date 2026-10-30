"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Alert, Button, Card, Input } from "@/components/ui";
import { errMsg } from "@/lib/format";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "daftar">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("confirmed")) setInfo("Email sudah dikonfirmasi. Silakan masuk.");
  }, []);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setInfo(""); setBusy(true);
    const sb = supabaseBrowser();
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setErr(error.message === "Invalid login credentials" ? "Email atau password salah" : errMsg(error));
      else window.location.href = "/";
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) setErr(errMsg(error));
      else if (data.session) window.location.href = "/";
      else setInfo("Akun dibuat. Cek email untuk konfirmasi, lalu login. Minta admin memberikan role yang sesuai.");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">CV. Sekar Jaya Abadi</div>
          <h1 className="text-xl font-semibold">{mode === "login" ? "Masuk ke SJA ERP" : "Daftar Akun"}</h1>
        </div>
        <form onSubmit={go} className="space-y-3">
          {mode === "daftar" && (
            <div><label className="mb-1 block text-xs text-zinc-500">Nama Lengkap</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
          )}
          <div><label className="mb-1 block text-xs text-zinc-500">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
          <div><label className="mb-1 block text-xs text-zinc-500">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
          {err && <Alert>{err}</Alert>}
          {info && <Alert kind="success">{info}</Alert>}
          <Button variant="primary" className="w-full" disabled={busy}>{mode === "login" ? "Masuk" : "Daftar"}</Button>
        </form>
        <button className="mt-4 w-full text-center text-xs text-zinc-500 hover:underline"
          onClick={() => setMode(mode === "login" ? "daftar" : "login")}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
        <ThemeToggle className="mt-4" />
      </Card>
    </div>
  );
}
