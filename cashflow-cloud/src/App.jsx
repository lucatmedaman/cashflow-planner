// Receives UBL invoices pushed by Billtobox's "Exporteren met HTTP-connector"
// (Basic Auth) and creates a matching record in the Posten table.
//
// Configure in Billtobox:
//   URL:              https://<jouw-domein>.vercel.app/api/billtobox-import
//   HTTP-gebruiker:   waarde van env var BILLTOBOX_USER
//   HTTP-wachtwoord:  waarde van env var BILLTOBOX_PASSWORD
//
// Both BILLTOBOX_USER/BILLTOBOX_PASSWORD and AIRTABLE_TOKEN must be set as
// Vercel environment variables (server-side only, never VITE_-prefixed).

// Note: no `export const config = { api: { bodyParser: false } }` here —
// that's a Next.js convention and may not be honored (or may conflict with
// the platform) on this plain Vite + Vercel Functions setup. readRawBody()
// below handles both cases: an already-parsed req.body, or a raw stream.

const BASE_ID = "appnK89Zxu17tWovZ";
const TABLES = {
  entities: "tblvCShG16EqO56N1",
  counterparties: "tblvZdFmsLq1zC1mp",
  items: "tblDNUpMUR9glpx4j",
};
// Meerdere Billtobox-accounts kunnen naar dit ene endpoint posten — welke
// boekhouding het wordt, hangt af van ?entity=... in de URL die je bij elke
// Billtobox-account afzonderlijk instelt. Zonder ?entity= (de bestaande
// Medaman-koppeling) blijft alles zoals het was.
const ENTITY_MAP = {
  medaman: "rec9dv3Aa4hxuNLU6",
  drlucbelmans: "rec7WTCJu3DwnB0cL", // Dr. Luc Belmans BV
};
const DEFAULT_ENTITY_KEY = "medaman";

function readRawBody(req) {
  if (typeof req.body === "string" && req.body.length > 0) {
    return Promise.resolve(req.body);
  }
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body.toString("utf8"));
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Namespace-agnostic UBL tag extraction — matches <cbc:IssueDate> or
// <IssueDate> etc. Returns the FIRST match, so callers should pre-scope to a
// sub-block (via extractTag with a wrapping element name) when a tag name
// like "ID" or "Name" could otherwise match the wrong part of the document.
function extractTag(xml, tagName) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function listCounterparties() {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.counterparties}?pageSize=100`, {
    headers: airtableHeaders(),
  });
  const data = await res.json();
  return data.records || [];
}

async function resolveCounterpartyId(name) {
  const records = await listCounterparties();
  const existing = records.find((r) => (r.fields.Naam || "").toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.counterparties}`, {
    method: "POST",
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ fields: { Naam: name } }] }),
  });
  const data = await res.json();
  return data.records[0].id;
}

function checkBasicAuth(req) {
  const expectedUser = process.env.BILLTOBOX_USER;
  const expectedPass = process.env.BILLTOBOX_PASSWORD;
  if (!expectedUser || !expectedPass) return { ok: false, reason: "not_configured" };

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return { ok: false, reason: "missing" };

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return { ok: user === expectedUser && pass === expectedPass, reason: "mismatch" };
}

// Schrijft een mislukte import als zichtbare "foutpost" in de Posten-tabel,
// zodat een falende push nooit meer geruisloos verdwijnt (Vercel-logs
// verlopen; Airtable niet). Lukt zelfs dát niet (bv. dood token), dan rest
// enkel de HTTP-foutrespons die Billtobox in zijn Gebeurtenissen bewaart.
async function logFailureToAirtable(step, message, targetEntityId, extra) {
  try {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.items}`, {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: [{
          fields: {
            Omschrijving: `⚠ BILLTOBOX-IMPORT MISLUKT (${step})`,
            Boekhouding: targetEntityId ? [targetEntityId] : [],
            Opmerking: `${message}${extra ? ` — ${extra}` : ""}`.slice(0, 1000),
            Bedrag: 0,
            Richting: "uit",
            Datum: new Date().toISOString().slice(0, 10),
            Herhaling: "once",
            Bron: "Billtobox",
            Gelezen: false,
            BetaaldeData: "[]",
          },
        }],
      }),
    });
    return true;
  } catch (e) {
    console.error("billtobox-import: kon foutpost niet wegschrijven:", e);
    return false;
  }
}

export default async function handler(req, res) {
  const entityKey = (req.query?.entity || DEFAULT_ENTITY_KEY).toLowerCase();
  const targetEntityId = ENTITY_MAP[entityKey] || ENTITY_MAP[DEFAULT_ENTITY_KEY];
  console.log(`billtobox-import: handler invoked, method=${req.method}, content-type=${req.headers["content-type"]}, entity=${entityKey}`);
  // Houdt bij welke stap als laatste gestart is, zodat een crash altijd
  // benoemt wáár het misliep — dat was tot nu toe onzichtbaar.
  let step = "start";
  try {
    if (req.method !== "POST" && req.method !== "PUT") {
      res.status(405).json({ error: "Alleen POST of PUT wordt ondersteund." });
      return;
    }

    step = "auth";
    const auth = checkBasicAuth(req);
    if (auth.reason === "not_configured") {
      console.error("billtobox-import: BILLTOBOX_USER/BILLTOBOX_PASSWORD ontbreken als env var.");
      res.status(500).json({ error: "BILLTOBOX_USER / BILLTOBOX_PASSWORD ontbreken in de server-omgevingsvariabelen." });
      return;
    }
    if (!auth.ok) {
      console.error("billtobox-import: Basic Auth mismatch.");
      res.setHeader("WWW-Authenticate", 'Basic realm="billtobox-import"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    step = "body_lezen";
    const rawXml = await readRawBody(req);
    if (!rawXml || typeof rawXml !== "string" || !rawXml.includes("<")) {
      // Likely Billtobox's "Verbinding testen" button, not a real invoice —
      // treat as a successful connection check rather than an error.
      console.log("billtobox-import: lege/niet-XML body ontvangen, behandeld als verbindingstest.");
      res.status(200).json({ status: "ok", note: "Verbinding werkt. Geen factuurgegevens ontvangen (test-payload)." });
      return;
    }
    // UPData/Billtobox voegt een <ext:UBLExtensions>-blok toe vóór de echte
    // factuurgegevens, met eigen metadata (incl. een <cbc:ID>UPData</cbc:ID>)
    // en soms het volledige PDF-brondocument als base64. Zonder dit weg te
    // knippen greep extractTag(xml, "ID") de EERSTE <ID>-tag in het hele
    // document — dat was dus "UPData", niet het echte factuurnummer.
    const xml = rawXml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "");

    step = "velden_extraheren";
    const invoiceNumber = extractTag(xml, "ID") || "(onbekend nummer)";
    const issueDate = extractTag(xml, "IssueDate");
    const dueDate = extractTag(xml, "DueDate") || issueDate || new Date().toISOString().slice(0, 10);

    const payableAmountRaw = extractTag(xml, "PayableAmount");
    const amount = payableAmountRaw ? Math.abs(parseFloat(payableAmountRaw)) : 0;
    if (!amount) {
      await logFailureToAirtable("geen bedrag", `Kon geen bedrag (PayableAmount) uit UBL-factuur ${invoiceNumber} halen.`, targetEntityId, `entity=${entityKey}`);
      res.status(422).json({ error: "Kon geen bedrag (PayableAmount) uit de UBL-factuur halen — niet aangemaakt." });
      return;
    }

    const supplierBlock = extractTag(xml, "AccountingSupplierParty") || xml;
    const supplierName =
      extractTag(supplierBlock, "RegistrationName") ||
      extractTag(supplierBlock, "Name") ||
      "Onbekende leverancier (Billtobox)";

    const paymentBlock = extractTag(xml, "PaymentMeans") || "";
    const payeeAccountBlock = extractTag(paymentBlock, "PayeeFinancialAccount") || "";
    const iban = extractTag(payeeAccountBlock, "ID") || "";

    // Dedup: dezelfde factuur (zelfde nummer + bedrag) niet twee keer
    // aanmaken — Billtobox kan een push herhalen, en tot nu toe was er geen
    // enkele bescherming daartegen (in tegenstelling tot bank-import en
    // PocketSmith-sync, die al op referentie dedupten).
    step = "dedup_check";
    const dedupRef = `btb-${invoiceNumber}-${amount.toFixed(2)}`;
    const dedupUrl = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.items}`);
    dedupUrl.searchParams.set("filterByFormula", `{BankRef} = "${dedupRef}"`);
    dedupUrl.searchParams.set("maxRecords", "1");
    const dedupRes = await fetch(dedupUrl.toString(), { headers: airtableHeaders() });
    const dedupData = await dedupRes.json();
    if (dedupRes.ok && (dedupData.records || []).length > 0) {
      console.log(`billtobox-import: factuur ${invoiceNumber} al aanwezig (${dedupRef}), overgeslagen.`);
      res.status(200).json({ status: "ok", note: "Factuur was al eerder geïmporteerd — geen duplicaat aangemaakt.", invoiceNumber });
      return;
    }

    step = "crediteur_aanmaken";
    const counterpartyId = await resolveCounterpartyId(supplierName);

    step = "post_aanmaken";
    const fields = {
      Omschrijving: `${supplierName} — factuur ${invoiceNumber}`,
      Boekhouding: [targetEntityId],
      DebiteurCrediteur: [counterpartyId],
      Rekeningnummer: iban,
      Opmerking: "Automatisch geïmporteerd via Billtobox",
      Bedrag: amount,
      Richting: "uit",
      Datum: dueDate,
      Factuurdatum: issueDate || null,
      Herhaling: "once",
      Bron: "Billtobox",
      BankRef: dedupRef,
      Gelezen: false,
      BetaaldeData: "[]",
    };

    const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.items}`, {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({ records: [{ fields }] }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      await logFailureToAirtable("Airtable weigerde post", JSON.stringify(createData).slice(0, 800), targetEntityId, `factuur ${invoiceNumber}, ${supplierName}, €${amount}`);
      res.status(502).json({ error: "Airtable weigerde de nieuwe post.", detail: createData });
      return;
    }

    res.status(200).json({
      status: "ok",
      entity: entityKey,
      recordId: createData.records[0].id,
      supplier: supplierName,
      amount,
      dueDate,
      invoiceNumber,
    });
  } catch (err) {
    console.error("billtobox-import crashed:", err);
    const logged = await logFailureToAirtable(`crash bij ${step}`, err.message, targetEntityId, null);
    res.status(500).json({
      error: `Verwerken van UBL-factuur mislukt (stap: ${step}): ${err.message}`,
      loggedToAirtable: logged,
    });
  }
}
