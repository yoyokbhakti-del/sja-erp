// Stub GoTrue + proxy ke PostgREST, HANYA untuk uji lokal
import http from "node:http";
import crypto from "node:crypto";
const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const USERS = { "admin@sja.test": "00000000-0000-0000-0000-000000000001", "gudang@sja.test": "00000000-0000-0000-0000-000000000002" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }), b = b64(p); return `${h}.${b}.${crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url")}`; };
const userObj = (email) => ({ id: USERS[email], aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (email) => { const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: sign({ sub: USERS[email], email, role: "authenticated", aud: "authenticated", exp }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: email, user: userObj(email) }; };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
  const url = new URL(req.url, "http://x");
  const json = (code, o) => { res.writeHead(code, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/auth/v1/token") {
    const p = JSON.parse(body.toString() || "{}");
    const email = p.email ?? p.refresh_token;
    if (!USERS[email]) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: 400 });
    return json(200, session(email));
  }
  if (url.pathname === "/auth/v1/user") {
    try { const t = (req.headers.authorization ?? "").split(" ")[1]; const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
      return json(200, userObj(p.email)); } catch { return json(401, { msg: "no" }); }
  }
  if (url.pathname === "/auth/v1/logout") { res.writeHead(204, cors); return res.end(); }
  if (url.pathname.startsWith("/rest/v1")) {
    const headers = { ...req.headers }; delete headers.host; delete headers.apikey;
    if (headers.authorization === "Bearer dummy") delete headers.authorization;
    const r = await fetch(`http://127.0.0.1:3001${url.pathname.slice(8)}${url.search}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const h = { ...cors }; r.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) h[k] = v; });
    res.writeHead(r.status, h); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  json(404, { msg: "not found " + url.pathname });
}).listen(54321, () => console.log("fake supabase on 54321"));
