// Sertifikat publik untuk QZ Tray (opsional). Isi env QZ_CERTIFICATE di Vercel
// supaya QZ Tray tidak menampilkan dialog "Allow" setiap kali mencetak.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const cert = (process.env.QZ_CERTIFICATE ?? "").replace(/\\n/g, "\n").trim();
  return new Response(cert, { status: cert ? 200 : 204, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
