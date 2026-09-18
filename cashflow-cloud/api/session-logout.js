// POST /api/session-logout — wist de sessie-cookie die session-login.js zette.
const COOKIE_NAME = "cf_session";

export default async function handler(req, res) {
  const cookie = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
  res.status(200).json({ status: "ok" });
}
