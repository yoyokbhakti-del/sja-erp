import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function configError() {
  const missing = [!URL_ && "NEXT_PUBLIC_SUPABASE_URL", !KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean).join(" dan ");
  return new NextResponse(
    `<!doctype html><html lang="id"><meta charset="utf-8"><title>SJA ERP - konfigurasi belum lengkap</title>
<body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 16px;line-height:1.5">
<h2>Konfigurasi belum lengkap</h2>
<p>Environment Variable <b>${missing}</b> belum terbaca.</p>
<ol><li>Vercel &rarr; Project sja-erp &rarr; Settings &rarr; Environment Variables: pastikan nama persis sama dan dicentang untuk <i>Production</i>.</li>
<li>Deployments &rarr; titik tiga pada deployment terakhir &rarr; <b>Redeploy</b> (variabel baru hanya terbaca setelah deploy ulang).</li></ol>
</body></html>`,
    { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function middleware(request: NextRequest) {
  if (!URL_ || !KEY) return configError();

  let response = NextResponse.next({ request });
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (request.nextUrl.pathname.startsWith("/auth/")) return NextResponse.next({ request });

  try {
    const supabase = createServerClient(URL_, KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user && !isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (user && isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  } catch (e) {
    // Jangan sampai seluruh situs mati: arahkan ke login, layout server akan memeriksa ulang sesi.
    console.error("middleware auth error", e);
    if (isLogin) return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js)$).*)"],
};
