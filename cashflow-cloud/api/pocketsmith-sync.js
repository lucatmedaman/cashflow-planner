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
  nameMappings: "tblptA57fvdaF68nL",
  payments: "tblmh8pKgQVlZLO2j",
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airtableFetchWithRetry(url, options, action) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      await sleep(1000 * (attempt + 1)); // Airtable: max 5 req/s per base, backoff en probeer opnieuw
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`Airtable ${action} mislukt: ${JSON.stringify(data)}`);
    return data;
  }
  throw new Error(`Airtable ${action} mislukt: bleef 429 (rate limit) geven na 3 pogingen.`);
}

async function atCreate(tableId, fields) {
  const data = await airtableFetchWithRetry(
    `https://api.airtable.com/v0/${BASE_ID}/${tableId}`,
    { method: "POST", headers: airtableHeaders(), body: JSON.stringify({ records: [{ fields }] }) },
    "aanmaken"
  );
  return data.records[0];
}

async function atUpdate(tableId, id, fields) {
  const data = await airtableFetchWithRetry(
    `https://api.airtable.com/v0/${BASE_ID}/${tableId}`,
    { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ records: [{ id, fields }] }) },
    "bijwerken"
  );
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

// Belgische banken plakken bij kaartafrekeningen en soortgelijke verrichtingen
// Zet een Patroon (met eventueel * en {*}) om naar een regex.
// * = variabel stuk, genegeerd. {*} = variabel stuk, behouden als "captured".
function buildPatternRegex(pattern) {
  const CAPTURE = "\u0000CAPTURE\u0000";
  const WILD = "\u0000WILD\u0000";
  let temp = pattern.split("{*}").join(CAPTURE);
  temp = temp.split("*").join(WILD);
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = temp.split(new RegExp(`(${CAPTURE}|${WILD})`));
  let regexStr = "^";
  let hasCapture = false;
  for (const part of parts) {
    if (part === CAPTURE) { regexStr += "(.+?)"; hasCapture = true; }
    else if (part === WILD) { regexStr += ".+?"; }
    else regexStr += escapeRegex(part);
  }
  return { regex: new RegExp(regexStr + "$", "i"), hasCapture };
}

// vaak gestructureerde metadata achter de naam ("INTERNE REKENING : ...",
// "BANKREFERENTIE : ...", "VALUTADATUM : ..."). Dit knipt dat weg voor de
// specifieke patronen die we al zijn tegengekomen — geen universele parser.
function cleanPayeeText(raw, mappings) {
  if (!raw) return raw;
  let s = raw.trim();

  const cardMatch = s.match(/^AFREKENING\s+(VISA|MASTERCARD|BANCONTACT)\s+KREDIETKAART/i);
  // "Paiement Debit Mastercard 12/07/26 - 9h56 - <merchant> - <postcode> - <city> - <country> Numéro de carte ..."
  const ingCardMatch = s.match(
    /^Paiement\s+Debit\s+Mastercard\s+\d{2}\/\d{2}\/\d{2}\s*-\s*\d{1,2}h\d{2}\s*-\s*(.+?)\s*-\s*\d{3,5}\s*-\s*.+?\s*-\s*[A-Za-z]{2,3}\s+Num[ée]ro\s+de\s+carte/i
  );
  if (cardMatch) s = `Afrekening ${cardMatch[1].charAt(0)}${cardMatch[1].slice(1).toLowerCase()} kredietkaart`;
  else if (ingCardMatch) s = ingCardMatch[1].trim();
  else {
    // Knip alles vanaf een herkend metadata-label eraf, wat er ook nog voor stond.
    s = s.replace(/\s+(INTERNE REKENING|UITGAVENSTAAT NUMMER|BANKREFERENTIE|VALUTADATUM)\s*:.*$/i, "").trim();
    s = s || raw.slice(0, 80);
  }

  // Tabel-gestuurde mapping (Naammapping in Airtable) — losse substring-match,
  // hoofdletterongevoelig, eerste treffer wint. Ondersteunt * (variabel,
  // genegeerd) en {*} (variabel, behouden) in Patroon.
  if (mappings && mappings.length) {
    for (const m of mappings) {
      if (!m.pattern) continue;
      let captured = null;

      if (m.pattern.includes("*")) {
        const { regex, hasCapture } = buildPatternRegex(m.pattern);
        const match = s.match(regex);
        if (match) captured = hasCapture ? match[1] : "";
      } else {
        const n = s.toLowerCase();
        const p = m.pattern.toLowerCase();
        let matched;
        switch (m.matchType) {
          case "Begint met": matched = n.startsWith(p); break;
          case "Eindigt met": matched = n.endsWith(p); break;
          case "Exact": matched = n === p; break;
          case "Bevat":
          default: matched = n.includes(p); break;
        }
        if (matched) captured = "";
      }

      if (captured !== null && m.correctName) {
        s = m.correctName.includes("*") ? m.correctName.replace("*", captured.trim()) : m.correctName;
        break;
      }
    }
  }

  return s;
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
  let totalPages = null; // pas gekend na de eerste respons
  while (true) {
    const url = `https://api.pocketsmith.com/v2/users/${me.id}/transactions?start_date=${startDate}&end_date=${endDate}&page=${page}`;
    const res = await fetch(url, { headers: { "X-Developer-Key": key } });
    const data = await res.json();
    if (!res.ok) throw new Error(`PocketSmith transacties ophalen mislukt: ${JSON.stringify(data)}`);
    if (Array.isArray(data)) transactions = transactions.concat(data);

    if (totalPages === null) {
      const total = parseInt(res.headers.get("Total") || "0", 10);
      const perPage = parseInt(res.headers.get("Per-Page") || "30", 10);
      totalPages = total > 0 && perPage > 0 ? Math.ceil(total / perPage) : 1;
    }

    if (page >= totalPages || !Array.isArray(data) || data.length === 0) break;
    page++;
    if (page > 500) break; // veiligheidsgrens tegen een oneindige lus bij onverwacht API-gedrag
  }
  return { userId: me.id, transactions };
}

async function fetchPocketSmithAccounts(userId, key) {
  const res = await fetch(`https://api.pocketsmith.com/v2/users/${userId}/transaction_accounts`, {
    headers: { "X-Developer-Key": key },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PocketSmith rekeningen ophalen mislukt: ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  try {
    // Zacht beveiligd: als er een secret wordt meegegeven (bv. door Cron),
    // moet die kloppen. Zonder secret (bv. klik op de knop in de app zelf)
    // mag het door — zelfde vertrouwensmodel als de rest van deze app, die
    // sowieso geen login heeft.
    const secret = req.headers["x-cron-secret"] || req.query?.secret;
    if (secret && process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!process.env.POCKETSMITH_API_KEY) {
      res.status(500).json({ error: "POCKETSMITH_API_KEY ontbreekt in de server-omgevingsvariabelen." });
      return;
    }

    // Normaal: laatste 3 dagen (dagelijkse routine). Voor een eenmalige
    // historische import: geef ?start=YYYY-MM-DD&end=YYYY-MM-DD mee.
    const endDate = req.query?.end || toISODate(new Date());
    const startDate = req.query?.start || addDays(endDate, -3); // kleine overlap, dedup via BankRef vangt dubbels op

    const [entities, counterparties, items, nameMappingRecs, existingPayments, txResult] = await Promise.all([
      atListAll(TABLES.entities),
      atListAll(TABLES.counterparties),
      atListAll(TABLES.items),
      atListAll(TABLES.nameMappings),
      atListAll(TABLES.payments),
      fetchPocketSmithTransactions(startDate, endDate),
    ]);
    const { userId, transactions } = txResult;
    const nameMappings = nameMappingRecs.map((r) => ({
      pattern: r.fields.Patroon || "",
      correctName: r.fields.CorrecteNaam || "",
      matchType: r.fields.MatchType || "Bevat",
    }));
    const importedRefs = new Set(existingPayments.map((p) => p.fields.Bankreferentie).filter(Boolean));

    let matched = 0, created = 0, proposed = 0, skipped = 0, errors = 0;

    for (const tx of transactions) {
      try {
        const ref = `ps-${tx.id}`;
        const alreadyImported = items.some((i) => i.fields.BankRef === ref) || importedRefs.has(ref);
        if (alreadyImported) { skipped++; continue; }

        const accountName = tx.transaction_account?.name || "";
        const entity = entities.find((e) => (e.fields.PocketSmithRekening || "").trim() === accountName.trim());
        if (!entity) { skipped++; continue; } // onbekende rekening — geen boekhouding om aan te koppelen

        const amount = Math.abs(tx.amount);
        const direction = tx.amount < 0 ? "uit" : "in";
        const date = tx.date;
        const rawPayee = tx.payee || tx.note || "PocketSmith-transactie";
        const payee = cleanPayeeText(rawPayee, nameMappings);

        const candidates = items.filter((i) => {
          const f = i.fields;
          const itemEntity = (f.Boekhouding || [])[0];
          const itemAmount = typeof f.Bedrag === "number" ? f.Bedrag : 0;
          const paidDates = (() => { try { return JSON.parse(f.BetaaldeData || "[]"); } catch (e) { return []; } })();
          return itemEntity === entity.id && f.Richting === direction &&
            Math.abs(itemAmount - amount) < 0.01 && !paidDates.includes(f.Datum);
        });

        const snapshot = { ref, amount, direction, bookingDate: date, counterpartyName: payee, remittance: tx.note || "" };
        const target = candidates.length > 0 ? candidates[0] : null;
        snapshot.wasCreated = !target;

        // Crediteur/debiteur vooraf bepalen — zelfde volgorde als de
        // handmatige CAMT.053-import: bij een match op een bestaand document
        // Crediteur/debiteur vooraf bepalen: bij een match op een bestaand
        // document wordt diens crediteur overgenomen (geen nieuwe
        // aangemaakt), anders wordt de (opgeschoonde) banknaam herkend of
        // aangemaakt.
        let counterpartyId = null;
        let noDocByDefault = false;
        const targetCounterpartyId = target ? (target.fields.DebiteurCrediteur || [])[0] : null;
        if (targetCounterpartyId) {
          counterpartyId = targetCounterpartyId;
        } else if (payee) {
          const existing = counterparties.find((c) => (c.fields.Naam || "").toLowerCase() === payee.toLowerCase());
          if (existing) {
            counterpartyId = existing.id;
            // Enkel relevant zonder documentmatch — met een match is er
            // sowieso al een gekoppeld document, "geen document nodig" is
            // dan moot.
            noDocByDefault = !target && !!existing.fields.StandaardGeenDocumentNodig;
          } else {
            counterpartyId = await resolveCounterpartyId(payee, counterparties);
          }
        }

        const paymentFields = {
          Omschrijving: payee.slice(0, 80),
          Datum: date,
          Bedrag: amount,
          Richting: direction,
          Boekhouding: [entity.id],
          Bron: "PocketSmith",
          Bankreferentie: ref,
          // PocketSmith geeft het bank-volgnummer (indien de bankfeed het
          // meelevert) door via cheque_number — zelfde veld als waar de
          // CSV-import het volgnummer in bewaart. Vaak leeg; dan vult een
          // latere CSV-herimport het alsnog aan (zie app v1.58.2).
          Volgnummer: tx.cheque_number ? String(tx.cheque_number) : "",
          RuweBrongegevens: JSON.stringify(snapshot),
          DebiteurCrediteur: counterpartyId ? [counterpartyId] : [],
          GekoppeldeDocumenten: target ? [target.id] : [],
          GeenDocumentNodig: noDocByDefault,
        };
        const paymentRec = await atCreate(TABLES.payments, paymentFields);

        if (target) {
          const paidDates = (() => { try { return JSON.parse(target.fields.BetaaldeData || "[]"); } catch (e) { return []; } })();
          const newPaidDates = [...paidDates, target.fields.Datum];
          const newDocPayments = [...(target.fields.Betalingen || []), paymentRec.id];
          await atUpdate(TABLES.items, target.id, {
            BetaaldeData: JSON.stringify(newPaidDates),
            Betalingen: newDocPayments,
            Bron: "Bank-import",
            Gelezen: false,
          });
          matched++;
        } else {
          // Geen match met een bestaande post: de betaling blijft
          // ongekoppeld en wacht in het Koppelen-scherm. Er wordt bewust
          // GEEN automatische "al-betaalde" post meer aangemaakt — ook niet
          // voor vertrouwde crediteuren (zelfde gedragswijziging als de
          // bank-import in de app v1.60.0; de vertrouwd-vlag blijft enkel
          // nog relevant voor factuurstromen zoals Billtobox).
          proposed++;
        }
      } catch (err) {
        errors++;
      }
    }

    // Rekeningsaldi bijwerken — los van of er nieuwe transacties waren.
    let balancesUpdated = 0;
    let balanceError = null;
    let pocketsmithAccountNames = [];
    try {
      const accounts = await fetchPocketSmithAccounts(userId, process.env.POCKETSMITH_API_KEY);
      pocketsmithAccountNames = accounts.map((a) => a.title || a.name || "(naamloos)");
      for (const entity of entities) {
        const accountName = (entity.fields.PocketSmithRekening || "").trim();
        if (!accountName) continue;
        const account = accounts.find(
          (a) => (a.title || a.name || "").trim().toLowerCase() === accountName.toLowerCase()
        );
        if (!account || typeof account.current_balance !== "number") continue;
        await atUpdate(TABLES.entities, entity.id, {
          BankSaldo: account.current_balance,
          BankSaldoDatum: account.current_balance_date || toISODate(new Date()),
        });
        balancesUpdated++;
      }
    } catch (err) {
      console.error("pocketsmith-sync: saldi bijwerken mislukt:", err);
      balanceError = err.message;
    }

    res.status(200).json({
      status: "ok",
      total: transactions.length,
      matched,
      created,
      proposed,
      skipped,
      errors,
      balancesUpdated,
      balanceError,
      pocketsmithAccountNames, // ter controle: exacte namen zoals PocketSmith ze zelf teruggeeft
    });
  } catch (err) {
    console.error("pocketsmith-sync crashed:", err);
    res.status(500).json({ error: err.message });
  }
}
