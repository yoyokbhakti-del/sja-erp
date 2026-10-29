"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DOCTYPES } from "@/lib/doctypes";
import { cn, errMsg } from "@/lib/format";
import { Alert, Card, PageHeader, Td, Th } from "@/components/ui";
import { usePerms } from "@/components/perms";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACTIONS = ["can_read", "can_write", "can_submit", "can_cancel"] as const;
const EXTRA = [
  { key: "stock_ledger", label: "Laporan Stok" }, { key: "gl_entries", label: "Laporan Keuangan (Buku Besar, Neraca, L/R)" },
  { key: "users", label: "Pengguna & Role" },
  { key: "audit_log", label: "Audit Trail" },
];

export default function UsersPage() {
  const sb = supabaseBrowser();
  const { can } = usePerms();
  const canEdit = can("users", "write");
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [users, setUsers] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [ur, setUr] = useState<Row[]>([]);
  const [perms, setPerms] = useState<Row[]>([]);
  const [role, setRole] = useState("pembelian");
  const [err, setErr] = useState("");

  async function load() {
    const [u, r, x, p] = await Promise.all([
      sb.from("profiles").select("*").order("created_at"),
      sb.from("roles").select("*").order("id"),
      sb.from("user_roles").select("*"),
      sb.from("permissions").select("*"),
    ]);
    setUsers(u.data ?? []); setRoles(r.data ?? []); setUr(x.data ?? []); setPerms(p.data ?? []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) setErr(errMsg(error)); else setErr(""); await load(); };

  const toggleRole = (userId: string, roleId: string, on: boolean) =>
    run(on ? sb.from("user_roles").insert({ user_id: userId, role_id: roleId })
           : sb.from("user_roles").delete().eq("user_id", userId).eq("role_id", roleId));

  const togglePerm = (doctype: string, action: string, on: boolean) => {
    const existing = perms.find((p) => p.role_id === role && p.doctype === doctype);
    const row = { role_id: role, doctype, can_read: false, can_write: false, can_submit: false, can_cancel: false, ...existing, [action]: on };
    if (on && action !== "can_read") row.can_read = true;
    const empty = ACTIONS.every((a) => !row[a]);
    return run(empty ? sb.from("permissions").delete().eq("role_id", role).eq("doctype", doctype)
                     : sb.from("permissions").upsert(row));
  };

  const doctypes = [...DOCTYPES.map((d) => ({ key: d.key, label: d.label, submittable: !!d.submittable })), ...EXTRA.map((e) => ({ ...e, submittable: false }))];
  const rolePerm = (dt: string) => perms.find((p) => p.role_id === role && p.doctype === dt);
  const wildcard = perms.find((p) => p.role_id === role && p.doctype === "*");

  return (
    <div className="pb-10">
      <PageHeader title="Pengguna & Role" sub="User baru mendaftar lewat halaman login dan otomatis mendapat role “Hanya Lihat”.">
        {(["users", "roles"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-zinc-900 text-white" : "bg-zinc-100")}>
            {t === "users" ? "Pengguna" : "Izin per Role"}
          </button>
        ))}
      </PageHeader>
      {err && <div className="mb-3"><Alert onClose={() => setErr("")}>{err}</Alert></div>}

      {tab === "users" ? (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><Th>Nama</Th><Th>Email</Th><Th>Aktif</Th>{roles.map((r) => <Th key={r.id} className="text-center">{r.name}</Th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.full_name}</Td>
                  <Td>{u.email}</Td>
                  <Td><input type="checkbox" className="size-4 accent-zinc-900" disabled={!canEdit} checked={u.is_active}
                             onChange={(e) => run(sb.from("profiles").update({ is_active: e.target.checked }).eq("id", u.id))} /></Td>
                  {roles.map((r) => (
                    <Td key={r.id} className="text-center">
                      <input type="checkbox" className="size-4 accent-zinc-900" disabled={!canEdit}
                             checked={ur.some((x) => x.user_id === u.id && x.role_id === r.id)}
                             onChange={(e) => toggleRole(u.id, r.id, e.target.checked)} />
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {roles.map((r) => (
              <button key={r.id} onClick={() => setRole(r.id)}
                className={cn("rounded-md border px-3 py-1 text-sm", role === r.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white")}>
                {r.name}
              </button>
            ))}
          </div>
          {wildcard && <div className="mb-3"><Alert kind="info">Role ini punya izin “*” (berlaku untuk semua dokumen): baca{wildcard.can_write ? ", tulis" : ""}{wildcard.can_submit ? ", submit" : ""}{wildcard.can_cancel ? ", cancel" : ""}.</Alert></div>}
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Dokumen</Th><Th className="text-center">Baca</Th><Th className="text-center">Tulis</Th><Th className="text-center">Submit</Th><Th className="text-center">Cancel</Th></tr></thead>
              <tbody>
                {doctypes.map((d) => {
                  const p = rolePerm(d.key);
                  return (
                    <tr key={d.key}>
                      <Td>{d.label}</Td>
                      {ACTIONS.map((a) => (
                        <Td key={a} className="text-center">
                          {(a === "can_submit" || a === "can_cancel") && !d.submittable ? <span className="text-zinc-300">—</span> : (
                            <input type="checkbox" className="size-4 accent-zinc-900" disabled={!canEdit || role === "admin"}
                                   checked={!!p?.[a]} onChange={(e) => togglePerm(d.key, a, e.target.checked)} />
                          )}
                        </Td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
