// middleware.js — Server-side wachtwoordgate voor de hele app.
//
// Draait op elke route BEHALVE de externe/losse endpoints die al hun eigen
// bescherming hebben (Basic Auth / cron-secret) en dus buiten deze sessie-
// cookie om moeten blijven werken:
//   /api/billtobox-import   — Billtobox-webhook (Basic Auth)
//   /api/rekening-overzicht — los "actie"-endpoint voor extern gebruik
//   /api/pocketsmith-sync   — Vercel Cron (CRON_SECRET) + knop in de app
//   /api/session-login      — de login-endpoint zelf (moet altijd bereikbaar zijn)
//
// Alle andere routes (de SPA zelf, /api/airtable/*, upload-*, send-to-accountant)
// vereisen een geldige sessie-cookie, anders wordt een inline login-pagina
// (of voor /api/* een 401) teruggegeven i.p.v. de echte inhoud.
//
// Vereiste environment variables (Vercel, server-only):
//   APP_PASSWORD          — het wachtwoord om in te loggen
//   APP_SESSION_SECRET    — lange willekeurige string om sessies te ondertekenen (HMAC)
//
// Zolang deze twee env vars niet gezet zijn, laat de gate alles door (geen
// kapotte app door een vergeten configuratiestap) — de bescherming is dan
// simpelweg nog niet actief.

import crypto from "crypto";
import { next } from "@vercel/functions";

const COOKIE_NAME = "cf_session";

export const config = {
  matcher: [
    "/((?!api/session-login|api/billtobox-import|api/rekening-overzicht|api/pocketsmith-sync|favicon.ico).*)",
  ],
  runtime: "nodejs",
};

function verify(token, secret) {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  return true;
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

const LOGIN_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Cashflow Planner — inloggen</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  form { background:#1e293b; padding:2rem; border-radius:12px; width:280px; box-shadow:0 10px 30px rgba(0,0,0,.3); }
  h1 { font-size:1.1rem; margin:0 0 1rem; font-weight:600; }
  input { width:100%; box-sizing:border-box; padding:.6rem .75rem; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:1rem; margin-bottom:.75rem; }
  button { width:100%; padding:.6rem; border-radius:8px; border:none; background:#2563eb; color:white; font-size:1rem; cursor:pointer; }
  button:hover { background:#1d4ed8; }
  p.err { color:#f87171; font-size:.85rem; margin:0 0 .75rem; }
</style>
</head>
<body>
<form id="f">
  <h1>Cashflow Planner</h1>
  <p class="err" id="err" style="display:none"></p>
  <input type="password" id="pw" placeholder="Wachtwoord" autofocus required />
  <button type="submit">Inloggen</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    const err = document.getElementById('err');
    err.style.display = 'none';
    try {
      const res = await fetch('/api/session-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        err.textContent = data.error || 'Onjuist wachtwoord.';
        err.style.display = 'block';
      }
    } catch (e2) {
      err.textContent = 'Kon niet inloggen — probeer opnieuw.';
      err.style.display = 'block';
    }
  });
</script>
</body>
</html>`;

export default function middleware(request) {
  const secret = process.env.APP_SESSION_SECRET;
  const appPassword = process.env.APP_PASSWORD;

  if (!secret || !appPassword) {
    return next();
  }

  const token = getCookie(request, COOKIE_NAME);
  if (verify(token, secret)) {
    return next();
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(LOGIN_HTML, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
