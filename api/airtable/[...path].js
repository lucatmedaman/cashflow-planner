// Server-side proxy to Airtable. Runs on Vercel (Node runtime), never in the browser.
// The token lives only in the AIRTABLE_TOKEN environment variable on the server —
// it is NEVER prefixed with VITE_, so Vite never bundles it into client code.

const BASE_ID = "appnK89Zxu17tWovZ";
const PREFIX = "/api/airtable/";

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({
      error: { message: "AIRTABLE_TOKEN ontbreekt in de server-omgevingsvariabelen (Vercel project settings)." },
    });
    return;
  }

  const idx = req.url.indexOf(PREFIX);
  const rest = idx >= 0 ? req.url.slice(idx + PREFIX.length) : "";
  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${rest}`;

  try {
    const init = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (req.method === "POST" || req.method === "PATCH") {
      init.body = JSON.stringify(req.body);
    }

    const airtableRes = await fetch(airtableUrl, init);
    const data = await airtableRes.json().catch(() => ({}));
    res.status(airtableRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: `Proxy naar Airtable mislukt: ${err.message}` } });
  }
}
