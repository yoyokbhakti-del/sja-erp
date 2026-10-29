"use client";
import { createContext, useContext } from "react";

export type Perm = { doctype: string; can_read: boolean; can_write: boolean; can_submit: boolean; can_cancel: boolean };
export type Action = "read" | "write" | "submit" | "cancel";

const Ctx = createContext<{ perms: Perm[]; email: string }>({ perms: [], email: "" });

export function PermProvider({ perms, email, children }: { perms: Perm[]; email: string; children: React.ReactNode }) {
  return <Ctx.Provider value={{ perms, email }}>{children}</Ctx.Provider>;
}

export function usePerms() {
  const { perms, email } = useContext(Ctx);
  const can = (doctype: string, action: Action) =>
    perms.some((p) => (p.doctype === doctype || p.doctype === "*") && p[`can_${action}`]);
  return { can, email };
}
