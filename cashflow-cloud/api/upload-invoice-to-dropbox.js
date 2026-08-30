// Upload een factuur-bestand (PDF/UBL-XML) naar een vaste archiefmap in
// Dropbox en geeft een deelbare link terug — als alternatief voor het
// bewaren als Airtable-bijlage (die liep tegen Vercel's ~4,5MB request-
// limiet aan bij grotere gescande PDF's). Hergebruikt dezelfde
// refresh-token-flow als dropbox-facturen-inlezen.js.
//
// Vereiste Vercel env vars (server-side, geen VITE_-prefix, zelfde als het
// bestaande dropbox-facturen-inlezen.js):
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
//
//   POST /api/upload-invoice-to-dropbox
//        body: { filename, contentType, file (base64) }
//        -> { status: "ok", url }

const ARCHIVE_FOLDER = "/Cashflow-facturen-archief";

async function safeJson(res) {
  const raw = await res.text();
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: null, raw };
  }
}

async function getAccessToken() {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
    client_id: process.env.DROPBOX_APP_KEY,
    client_secret: process.env.DROPBOX_APP_SECRET,
  });
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const { data, raw } = await safeJson(res);
  if (!res.ok) {
    throw new Error(`Dropbox-token vernieuwen mislukt: ${data?.error_description || data?.error || raw || res.status}`);
  }
  return data.access_token;
}

async function uploadFile(accessToken, path, buffer) {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true, mute: true }),
    },
    body: buffer,
  });
  const { data, raw } = await safeJson(res);
  if (!res.ok) {
    throw new Error(`Dropbox-upload mislukt: ${data?.error_summary || raw || res.status}`);
  }
  return data.path_display || path;
}

async function getOrCreateSharedLink(accessToken, path) {
  const createRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const { data: createData, raw: createRaw } = await safeJson(createRes);
  if (createRes.ok) return createData.url;

  // Al een link voor dit pad? Dropbox weigert dan een tweede te maken —
  // de bestaande gewoon opzoeken i.p.v. dit als fout te behandelen.
  if (createData?.error?.[".tag"] === "shared_link_already_exists") {
    const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, direct_only: true }),
    });
    const { data: listData, raw: listRaw } = await safeJson(listRes);
    if (listRes.ok && listData?.links?.[0]?.url) return listData.links[0].url;
    throw new Error(`Bestaande deel-link niet gevonden: ${listRaw || listRes.status}`);
  }

  throw new Error(`Deel-link aanmaken mislukt: ${createData?.error_summary || createRaw || createRes.status}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Enkel POST wordt ondersteund." });
    return;
  }
  const { filename, file } = req.body || {};
  if (!filename || !file) {
    res.status(400).json({ error: "filename en file (base64) zijn verplicht." });
    return;
  }
  if (!process.env.DROPBOX_REFRESH_TOKEN || !process.env.DROPBOX_APP_KEY || !process.env.DROPBOX_APP_SECRET) {
    res.status(500).json({ error: "DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN ontbreken in de server-omgevingsvariabelen." });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const buffer = Buffer.from(file, "base64");
    // Bestandsnaam met tijdstip-prefix om botsingen te vermijden zonder
    // afhankelijk te zijn van een record-ID dat op het moment van uploaden
    // soms nog niet bestaat.
    const safeName = filename.replace(/[^a-zA-Z0-9_.\-]/g, "_");
    const path = `${ARCHIVE_FOLDER}/${Date.now()}-${safeName}`;
    const finalPath = await uploadFile(accessToken, path, buffer);
    let url = await getOrCreateSharedLink(accessToken, finalPath);
    // ?dl=0 toont een preview-pagina; makkelijker direct te openen/delen dan
    // een geforceerde download.
    res.status(200).json({ status: "ok", url });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
