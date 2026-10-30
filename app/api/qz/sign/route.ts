import { createSign } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

// Menandatangani permintaan cetak QZ Tray dengan kunci privat (env QZ_PRIVATE_KEY).
// Hanya untuk pengguna yang sudah login.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = (process.env.QZ_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!key) return new Response("", { status: 204 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const toSign = await req.text();
  if (!toSign || toSign.length > 10000) return new Response("bad request", { status: 400 });
  const signer = createSign("RSA-SHA512");
  signer.update(toSign);
  return new Response(signer.sign(key, "base64"), { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
