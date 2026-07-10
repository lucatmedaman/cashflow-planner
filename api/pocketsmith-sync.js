// Draait dagelijks via Vercel Cron (zie vercel.json). Haalt nieuwe PocketSmith-
// transacties op en matcht/maakt ze aan in Airtable — de geautomatiseerde
// tegenhanger van de handmatige "Bank importeren"-knop in de app.
//
// Vereiste environment variables (Vercel, server-only):
//   POCKETSMITH_API_KEY  — Developer Key uit PocketSmith (Settings > Security)
//   AIRTABLE_TOKEN        — al aanwezig voor de rest van de app
//   CRON_SECRET            — zelf gekozen, ter bescherming van dit endpoint
//
// Beperking t.o.v. de handmatige CAMT.053-import: matching gebeurt hier enkel
// tegen de directe vervaldatum van elke post (geen volledige uitbreiding van
// herhalende posten naar hun toekomstige data), om deze functie zelfstandig
// te houden zonder de volledige planningslogica van de app te dupliceren.
// Voor herhalende posten kan dat een gemiste match betekenen als de vervaldatum
// intussen al voorbij is — controleer daarom regelmatig het "Afpunten"-scherm.

const BASE_ID = "appnK89Zxu17tWovZ";
const TABLES = {
  entities: "tblvCShG16EqO56N1",
  counterparties: "tblvZdFmsLq1zC1mp",
  items: "tblDNUpMUR9glpx4j",
};

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function atListAll(tableId) {
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: airtableHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(`Airtable ophalen mislukt: ${JSON.stringify(data)}`);
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function atCreate(tableId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: "POST",
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Airtable aanmaken mislukt: ${JSON.stringify(data)}`);
  return data.records[0];
}

async function atUpdate(tableId, id, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: "PATCH",
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ id, fields }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Airtable bijwerken mislukt: ${JSON.stringify(data)}`);
  return data.records[0];
}

async function resolveCounterpartyId(name, counterpartiesCache) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  const existing = counterpartiesCache.find((c) => (c.fields.Naam || "").toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const created = await atCreate(TABLES.counterparties, { Naam: trimmed });
  counterpartiesCache.push(created);
  return created.id;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

async function fetchPocketSmithTransactions(startDate, endDate) {
  const key = process.env.POCKETSMITH_API_KEY;
  const meRes = await fetch("https://api.pocketsmith.com/v2/me", {
    headers: { "X-Developer-Key": key },
  });
  const me = await meRes.json();
  if (!meRes.ok) throw new Error(`PocketSmith /me mislukt: ${JSON.stringify(me)}`);

  let transactions = [];
  let page = 1;
  while (true) {
    const url = `https://api.pocketsmith.com/v2/users/${me.id}/transactions?start_date=${startDate}&end_date=${endDate}&page=${page}`;
    const res = await fetch(url, { headers: { "X-Developer-Key": key } });
    const data = await res.json();
    if (!res.ok) throw new Error(`PocketSmith transacties ophalen mislukt: ${JSON.stringify(data)}`);
    transactions = transactions.concat(data);
    const totalPages = parseInt(res.headers.get("Total-Pages") || "1", 10);
    if (page >= totalPages || data.length === 0) break;
    page++;
  }
  return transactions;
}

export default async function handler(req, res) {
  try {
    // Bescherm dit endpoint — enkel Vercel Cron (met dit geheim) of jijzelf mag het triggeren.
    const secret = req.headers["x-cron-secret"] || req.query?.secret;
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!process.env.POCKETSMITH_API_KEY) {
      res.status(500).json({ error: "POCKETSMITH_API_KEY ontbreekt in de server-omgevingsvariabelen." });
      return;
    }

    const endDate = toISODate(new Date());
    const startDate = addDays(endDate, -3); // kleine overlap, dedup via BankRef vangt dubbels op

    const [entities, counterparties, items, transactions] = await Promise.all([
      atListAll(TABLES.entities),
      atListAll(TABLES.counterparties),
      atListAll(TABLES.items),
      fetchPocketSmithTransactions(startDate, endDate),
    ]);

    let matched = 0, created = 0, skipped = 0, errors = 0;

    for (const tx of transactions) {
      try {
        const ref = `ps-${tx.id}`;
        const alreadyImported = items.some((i) => i.fields.BankRef === ref);
        if (alreadyImported) { skipped++; continue; }

        const accountName = tx.transaction_account?.name || "";
        const entity = entities.find((e) => (e.fields.PocketSmithRekening || "").trim() === accountName.trim());
        if (!entity) { skipped++; continue; } // onbekende rekening — geen boekhouding om aan te koppelen

        const amount = Math.abs(tx.amount);
        const direction = tx.amount < 0 ? "uit" : "in";
        const date = tx.date;
        const payee = tx.payee || tx.note || "PocketSmith-transactie";

        const candidates = items.filter((i) => {
          const f = i.fields;
          const itemEntity = (f.Boekhouding || [])[0];
          const itemAmount = typeof f.Bedrag === "number" ? f.Bedrag : 0;
          const paidDates = (() => { try { return JSON.parse(f.BetaaldeData || "[]"); } catch (e) { return []; } })();
          return itemEntity === entity.id && f.Richting === direction &&
            Math.abs(itemAmount - amount) < 0.01 && !paidDates.includes(f.Datum);
        });

        const snapshot = JSON.stringify({ ref, amount, direction, bookingDate: date, counterpartyName: payee, remittance: tx.note || "" });

        if (candidates.length > 0) {
          const target = candidates[0];
          const paidDates = (() => { try { return JSON.parse(target.fields.BetaaldeData || "[]"); } catch (e) { return []; } })();
          const newPaidDates = [...paidDates, target.fields.Datum];
          await atUpdate(TABLES.items, target.id, {
            BetaaldeData: JSON.stringify(newPaidDates),
            Bron: "Bank-import",
            BankRef: ref,
            BankSnapshot: snapshot,
          });
          matched++;
        } else {
          const counterpartyId = await resolveCounterpartyId(payee, counterparties);
          await atCreate(TABLES.items, {
            Omschrijving: payee.slice(0, 80),
            Boekhouding: [entity.id],
            DebiteurCrediteur: counterpartyId ? [counterpartyId] : [],
            Opmerking: tx.note || "",
            Bedrag: amount,
            Richting: direction,
            Datum: date,
            Herhaling: "once",
            Bron: "Bank-import",
            BankRef: ref,
            BankSnapshot: snapshot,
            BetaaldeData: JSON.stringify([date]),
          });
          created++;
        }
      } catch (err) {
        errors++;
      }
    }

    res.status(200).json({ status: "ok", total: transactions.length, matched, created, skipped, errors });
  } catch (err) {
    console.error("pocketsmith-sync crashed:", err);
    res.status(500).json({ error: err.message });
  }
}
