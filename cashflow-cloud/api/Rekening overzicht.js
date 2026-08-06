// Actie: geeft per Boekhouding een overzicht van de gekoppelde bankrekening
// (IBAN) en de vroegste/laatste transactiedatum uit de tabel Betalingen
// (de bank-transacties, niet de boekhoudkundige Posten).
//
// Bedoeld als losse "actie"-endpoint naar analogie van billtobox-import.js:
//   URL:  https://<jouw-domein>.vercel.app/api/rekening-overzicht
//   Methode: GET
//
// AIRTABLE_TOKEN moet gezet zijn als Vercel environment variable
// (server-side only, never VITE_-prefixed) — zelfde token als
// billtobox-import.js gebruikt.
//
// LET OP: ik heb alleen billtobox-import.js gezien, niet de rest van de
// app (frontend, andere /api-routes, hoe knoppen zoals "Rekeningsaldi &
// laatste sync" precies aanroepen/authenticeren). Onderstaande auth-check
// is daarom een simpele, optionele Basic-Auth-guard naar hetzelfde patroon
// als billtobox-import.js — pas ACTION_USER/ACTION_PASSWORD (of verwijder
// de check volledig) aan zodat die overeenkomt met hoe de andere acties in
// jouw app al beveiligd zijn.

const BASE_ID = "appnK89Zxu17tWovZ";
const TABLES = {
  boekhoudingen: "tblvCShG16EqO56N1",
  betalingen: "tblmh8pKgQVlZLO2j",
};

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function checkBasicAuth(req) {
  const expectedUser = process.env.ACTION_USER;
  const expectedPass = process.env.ACTION_PASSWORD;
  // Geen credentials geconfigureerd → guard staat uit (pas aan indien gewenst).
  if (!expectedUser || !expectedPass) return { ok: true };

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return { ok: false };

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return { ok: user === expectedUser && pass === expectedPass };
}

// Haalt alle records van een tabel op, met paginering (Airtable levert max
// 100 records per call terug via `offset`).
async function listAllRecords(tableId, fieldIds) {
  let records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    if (fieldIds) fieldIds.forEach((f) => params.append("fields[]", f));
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params.toString()}`, {
      headers: airtableHeaders(),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Airtable-fout bij ophalen ${tableId}: ${res.status} ${detail}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Alleen GET wordt ondersteund." });
      return;
    }

    const auth = checkBasicAuth(req);
    if (!auth.ok) {
      res.setHeader("WWW-Authenticate", 'Basic realm="rekening-overzicht"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [boekhoudingen, betalingen] = await Promise.all([
      listAllRecords(TABLES.boekhoudingen, ["Naam", "IBAN", "Volgorde"]),
      listAllRecords(TABLES.betalingen, ["Boekhouding", "Datum"]),
    ]);

    // Groepeer transactiedatums per Boekhouding-record-ID.
    const perBoekhouding = new Map();
    for (const rec of betalingen) {
      const links = rec.fields.Boekhouding || [];
      const datum = rec.fields.Datum;
      if (!datum || links.length === 0) continue;
      for (const boekhoudingId of links) {
        const bucket = perBoekhouding.get(boekhoudingId) || { min: datum, max: datum, aantal: 0 };
        if (datum < bucket.min) bucket.min = datum;
        if (datum > bucket.max) bucket.max = datum;
        bucket.aantal += 1;
        perBoekhouding.set(boekhoudingId, bucket);
      }
    }

    const overzicht = boekhoudingen
      .map((b) => {
        const bucket = perBoekhouding.get(b.id);
        return {
          boekhouding: b.fields.Naam || "(naamloos)",
          iban: b.fields.IBAN || null,
          vroegsteTransactie: bucket ? bucket.min : null,
          laatsteTransactie: bucket ? bucket.max : null,
          aantalTransacties: bucket ? bucket.aantal : 0,
          volgorde: b.fields.Volgorde ?? null,
        };
      })
      .sort((a, b) => (a.volgorde ?? Infinity) - (b.volgorde ?? Infinity));

    res.status(200).json({ status: "ok", overzicht });
  } catch (err) {
    console.error("rekening-overzicht crashed:", err);
    res.status(500).json({ error: `Ophalen van overzicht mislukt: ${err.message}` });
  }
}
