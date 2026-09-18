// POST /api/session-login  { password: "..." }
//
// Checkt het wachtwoord tegen APP_PASSWORD en zet bij succes een
// ondertekende, httpOnly sessie-cookie (30 dagen geldig). De cookie wordt
// op elke volgende request gevalideerd door middleware.js (project-root).
//
// Vereiste environment variables (Vercel, server-only):
//   APP_PASSWORD          — het wachtwoord om in te loggen
//   APP_SESSION_SECRET    — lange willekeurige string om sessies te ondertekenen (HMAC)

import crypto from "crypto";

const COOKIE_NAME = "cf_session";
const SESSION_DAYS = 30;

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Alleen POST wordt ondersteund." });
    return;
  }

  const appPassword = process.env.APP_PASSWORD;
  const secret = process.env.APP_SESSION_SECRET;
  if (!appPassword || !secret) {
    res.status(500).json({ error: "APP_PASSWORD / APP_SESSION_SECRET ontbreken in de server-omgevingsvariabelen." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const password = (body && body.password) || "";

  if (!password || !constantTimeEqual(password, appPassword)) {
    res.status(401).json({ error: "Onjuist wachtwoord." });
    return;
  }

  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  const token = `${payload}.${sign(payload, secret)}`;

  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ].join("; ");

  res.setHeader("Set-Cookie", cookie);
  res.status(200).json({ status: "ok" });
}
