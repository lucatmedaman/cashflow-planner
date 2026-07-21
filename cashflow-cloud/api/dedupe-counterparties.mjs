// dedupe-counterparties.mjs
//
// Eenmalig opruimscript voor de massale duplicaat-crediteuren die ontstonden
// door de (intussen gefixte) resolveCounterpartyId-bug in de app: bij een
// grote import binnen dezelfde sessie zag elke aanroep een "bevroren"
// momentopname van de crediteurenlijst, waardoor voor dezelfde naam telkens
// een nieuwe crediteur werd aangemaakt i.p.v. de bestaande te hergebruiken.
//
// Wat dit script doet, per exacte naam (hoofdlettergevoelig):
//   1. Verzamelt alle Debiteuren_Crediteuren-records met die naam.
//   2. Bepaalt welke daarvan al ECHT gebruikt worden (gekoppeld aan een post
//      in Posten of een betaling in Betalingen).
//   3. Kiest één "canonieke" record om te bewaren: bij voorkeur een reeds
//      gebruikte, anders de oudste (createdTime).
//   4. Verhuist eventuele koppelingen van de andere duplicaten naar die
//      canonieke record (zodat er sowieso nooit iets verweest raakt, ook al
//      wees de dry-run-analyse voorheen 0 koppelingen aan).
//   5. Verwijdert de overige duplicaten.
//
// Gebruik:
//   AIRTABLE_TOKEN=xxx node dedupe-counterparties.mjs            # dry-run, toont enkel wat er zou gebeuren
//   AIRTABLE_TOKEN=xxx node dedupe-counterparties.mjs --execute  # voert het echt uit
//
// Vereist Node 18+ (ingebouwde fetch).

const BASE_ID = "appnK89Zxu17tWovZ";
const TABLES = {
  counterparties: "tblvZdFmsLq1zC1mp",
  items: "tblDNUpMUR9glpx4j",
  payments: "tblmh8pKgQVlZLO2j",
};

const EXECUTE = process.argv.includes("--execute");

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function atListAll(tableId, fields) {
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (fields) fields.forEach((f) => url.searchParams.append("fields[]", f));
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(`Ophalen ${tableId} mislukt: ${JSON.stringify(data)}`);
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function atUpdateBatch(tableId, records) {
  // Airtable staat max. 10 records per PATCH-call toe.
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Bijwerken ${tableId} mislukt: ${JSON.stringify(data)}`);
  }
}

async function atDeleteBatch(tableId, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    chunk.forEach((id) => url.searchParams.append("records[]", id));
    const res = await fetch(url.toString(), { method: "DELETE", headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(`Verwijderen ${tableId} mislukt: ${JSON.stringify(data)}`);
  }
}

async function main() {
  console.log(EXECUTE ? "UITVOERMODUS — wijzigingen worden echt doorgevoerd." : "DRY-RUN — er wordt niets gewijzigd. Voeg --execute toe om echt uit te voeren.");
  console.log("");

  const [counterparties, items, payments] = await Promise.all([
    atListAll(TABLES.counterparties, ["Naam"]),
    atListAll(TABLES.items, ["DebiteurCrediteur"]),
    atListAll(TABLES.payments, ["DebiteurCrediteur"]),
  ]);

  console.log(`Debiteuren_Crediteuren: ${counterparties.length} records`);
  console.log(`Posten: ${items.length} records`);
  console.log(`Betalingen: ${payments.length} records`);
  console.log("");

  // Welke crediteur-ID's worden al ergens gebruikt?
  const usedIds = new Set();
  for (const it of items) {
    (it.fields.DebiteurCrediteur || []).forEach((id) => usedIds.add(id));
  }
  for (const p of payments) {
    (p.fields.DebiteurCrediteur || []).forEach((id) => usedIds.add(id));
  }

  // Groeperen per exacte naam.
  const groups = new Map();
  for (const c of counterparties) {
    const name = c.fields.Naam || "";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(c);
  }

  let totalDuplicateGroups = 0;
  let totalRecordsToDelete = 0;
  let totalRelinkNeeded = 0;
  const itemsToRelink = []; // { id, fields: { DebiteurCrediteur: [canonicalId] } }
  const paymentsToRelink = [];
  const idsToDelete = [];

  for (const [name, records] of groups.entries()) {
    if (records.length <= 1) continue;
    totalDuplicateGroups++;

    // Canoniek record kiezen: eerst een reeds gebruikte, anders de oudste.
    const usedInGroup = records.filter((r) => usedIds.has(r.id));
    let canonical;
    if (usedInGroup.length > 0) {
      canonical = usedInGroup.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime))[0];
    } else {
      canonical = records.slice().sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime))[0];
    }

    const duplicates = records.filter((r) => r.id !== canonical.id);
    totalRecordsToDelete += duplicates.length;

    // Als een duplicaat toevallig toch gebruikt blijkt (in de dry-run-fetch
    // was dat vrijwel nergens het geval, maar dit script controleert het
    // zelf opnieuw en verhuist zonodig), koppeling verplaatsen vóór verwijderen.
    for (const dup of duplicates) {
      const affectedItems = items.filter((it) => (it.fields.DebiteurCrediteur || []).includes(dup.id));
      for (const it of affectedItems) {
        totalRelinkNeeded++;
        itemsToRelink.push({ id: it.id, fields: { DebiteurCrediteur: [canonical.id] } });
      }
      const affectedPayments = payments.filter((p) => (p.fields.DebiteurCrediteur || []).includes(dup.id));
      for (const p of affectedPayments) {
        totalRelinkNeeded++;
        paymentsToRelink.push({ id: p.id, fields: { DebiteurCrediteur: [canonical.id] } });
      }
      idsToDelete.push(dup.id);
    }

    if (records.length > 5) {
      console.log(`"${name}": ${records.length}x → bewaar ${canonical.id}, verwijder ${duplicates.length}`);
    }
  }

  console.log("");
  console.log(`Samenvatting:`);
  console.log(`  Namen met duplicaten: ${totalDuplicateGroups}`);
  console.log(`  Te verwijderen records: ${totalRecordsToDelete}`);
  console.log(`  Koppelingen te verhuizen vóór verwijdering: ${totalRelinkNeeded}`);
  console.log(`  Overblijvend na opruiming: ${counterparties.length - totalRecordsToDelete}`);
  console.log("");

  if (!EXECUTE) {
    console.log("Dit was een dry-run. Voeg --execute toe om dit echt uit te voeren.");
    return;
  }

  if (itemsToRelink.length) {
    console.log(`Koppelingen verhuizen in Posten (${itemsToRelink.length})...`);
    await atUpdateBatch(TABLES.items, itemsToRelink);
  }
  if (paymentsToRelink.length) {
    console.log(`Koppelingen verhuizen in Betalingen (${paymentsToRelink.length})...`);
    await atUpdateBatch(TABLES.payments, paymentsToRelink);
  }
  console.log(`Duplicaten verwijderen (${idsToDelete.length})...`);
  await atDeleteBatch(TABLES.counterparties, idsToDelete);
  console.log("Klaar.");
}

main().catch((err) => {
  console.error("Mislukt:", err.message);
  process.exit(1);
});
