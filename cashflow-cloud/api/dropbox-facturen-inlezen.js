// Haalt nieuwe facturen/bonnen op uit de Dropbox-map
// "/Cashflow-facturen-inlezen" (App-folder-scope Dropbox-app), parseert
// UBL (.xml) en PDF-bestanden op dezelfde manier als de bestaande
// "UBL inlezen"/"PDF-factuur inlezen"-knoppen in de app, en geeft een
// lijst "drafts" terug voor het reviewscherm — er wordt hier NIETS in
// Airtable aangemaakt en niets in Dropbox verplaatst.
//
//   GET  /api/dropbox-facturen-inlezen
//        -> { status: "ok", count, drafts: [...] }
//
//   POST /api/dropbox-facturen-inlezen
//        body: { action: "move", path: "/Cashflow-facturen-inlezen/x.pdf" }
//        -> verplaatst dat bestand naar de submap "Verwerkt", wordt door
//           de frontend pas aangeroepen NADAT de post succesvol is
//           aangemaakt/bijgewerkt in Airtable.
//
// Vereiste Vercel env vars (server-side, geen VITE_-prefix):
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
//
// De Dropbox-app moet "App folder"-scope hebben met permissions:
//   files.metadata.read, files.content.read, files.content.write
// De API-paden hieronder ("/Cashflow-facturen-inlezen", ...) zijn relatief
// aan die App-map.

const SOURCE_FOLDER = "/Cashflow-facturen-inlezen";
const PROCESSED_FOLDER = `${SOURCE_FOLDER}/Verwerkt`;

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
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Dropbox-token vernieuwen mislukt: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

async function listSourceFiles(accessToken) {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: SOURCE_FOLDER, recursive: false }),
  });
  const data = await res.json();
  if (!res.ok) {
    // Map bestaat nog niet (bv. eerste keer, "Verwerkt" nog niet aangemaakt) -> gewoon leeg.
    if (data?.error_summary && data.error_summary.includes("not_found")) return [];
    throw new Error(`Dropbox list_folder mislukt: ${data.error_summary || res.status}`);
  }
  return (data.entries || []).filter(
    (e) => e[".tag"] === "file" && /\.(xml|pdf)$/i.test(e.name)
  );
}

async function downloadFile(accessToken, path) {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Downloaden van ${path} mislukt: ${detail}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---- UBL-parsing: zelfde regex-logica als billtobox-import.js / App.jsx (parseUblXml) ----
function extractTag(xml, tagName) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function parseUbl(rawXml) {
  const xml = rawXml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "");
  const invoiceNumber = extractTag(xml, "ID") || "(onbekend nummer)";
  const issueDate = extractTag(xml, "IssueDate");
  const dueDate = extractTag(xml, "DueDate") || issueDate || new Date().toISOString().slice(0, 10);
  const payableAmountRaw = extractTag(xml, "PayableAmount");
  const amount = payableAmountRaw ? Math.abs(parseFloat(payableAmountRaw)) : 0;
  const supplierBlock = extractTag(xml, "AccountingSupplierParty") || xml;
  const supplierName =
    extractTag(supplierBlock, "RegistrationName") ||
    extractTag(supplierBlock, "Name") ||
    "Onbekende leverancier";
  const paymentBlock = extractTag(xml, "PaymentMeans") || "";
  const payeeAccountBlock = extractTag(paymentBlock, "PayeeFinancialAccount") || "";
  const iban = extractTag(payeeAccountBlock, "ID") || "";
  return {
    source: "UBL",
    description: `${supplierName} — factuur ${invoiceNumber}`,
    counterparty: supplierName,
    amount: amount || "",
    dueDate,
    invoiceDate: issueDate || "",
    accountNumber: iban,
    parseWarning: amount ? null : "Kon geen bedrag (PayableAmount) uit dit bestand halen — vul het handmatig aan.",
  };
}

// ---- PDF-parsing: zelfde heuristieken als App.jsx parsePdfInvoiceText,
//      hier toegepast op tekst uit pdf-parse (Node, geen DOM nodig) i.p.v.
//      pdf.js (dat enkel in de browser werkt). ----
const DUTCH_MONTHS = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
function parseLooseDate(str) {
  if (!str) return null;
  let m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = str.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);
  if (m) return `${m[3]}-${String(DUTCH_MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parsePdfText(rawText) {
  const text = rawText.replace(/[ \t]+/g, " ");
  const flat = text.replace(/\s+/g, " ");

  let amount = "";
  const totaalMatch =
    flat.match(/Totaal[^€\d]{0,30}€\s*([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2})/i) ||
    flat.match(/Te betalen[^€\d]{0,30}€\s*([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2})/i);
  if (totaalMatch) {
    amount = totaalMatch[1].replace(/\./g, "").replace(",", ".");
  } else {
    const allAmounts = [...flat.matchAll(/€\s*([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2})/g)]
      .map((m) => parseFloat(m[1].replace(/\./g, "").replace(",", ".")))
      .filter((n) => !isNaN(n));
    if (allAmounts.length) amount = Math.max(...allAmounts).toFixed(2);
  }

  const invoiceNumMatch = flat.match(/Factuurnummer[:\s]+([A-Za-z0-9\-\/]+)/i);
  const invoiceNumber = invoiceNumMatch ? invoiceNumMatch[1] : "";

  const factDatumMatch = flat.match(/Factuurdatum[:\s]+([^€]{5,25}?)(?=\s{2,}|Factuurnummer|$)/i) || flat.match(/Factuurdatum[:\s]+(\S+\s+\S+\s+\S+)/i);
  const invoiceDate = factDatumMatch ? parseLooseDate(factDatumMatch[1]) || "" : "";

  const vervalMatch =
    flat.match(/(?:Vervaldatum|Te betalen (?:v[oó]{1,2}r|op))[^\d]{0,20}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i) ||
    flat.match(/domicili[eë]ring van uw rekening opgevraagd[^\d]{0,10}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i) ||
    flat.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})[^\d]{0,15}(?:via domicili[eë]ring|opgevraagd)/i);
  const dueDate = vervalMatch ? parseLooseDate(vervalMatch[1]) || "" : "";

  // Zwakste stap: leverancier gokken uit de eerste substantiële tekstregel.
  const firstLine =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 2 && !/^\d+([.,]\d+)?$/.test(l)) || "";

  return {
    source: "PDF",
    description: invoiceNumber ? `${firstLine} — factuur ${invoiceNumber}` : firstLine,
    counterparty: firstLine,
    invoiceNumber,
    amount,
    dueDate: dueDate || invoiceDate || new Date().toISOString().slice(0, 10),
    invoiceDate,
    accountNumber: "",
    parseWarning: "PDF-herkenning is een ruwe gok, geen gestructureerde data zoals bij UBL — controleer élk veld hieronder (zeker crediteur en datums) vóór je opslaat.",
  };
}

async function handleMove(req, res) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }
  if (!body || body.action !== "move" || !body.path) {
    res.status(400).json({ error: "POST vereist { action: 'move', path }." });
    return;
  }
  const accessToken = await getAccessToken();
  const filename = body.path.split("/").pop();
  const destPath = `${PROCESSED_FOLDER}/${filename}`;
  const moveRes = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from_path: body.path, to_path: destPath, autorename: true }),
  });
  const moveData = await moveRes.json();
  if (!moveRes.ok) {
    res.status(502).json({ error: "Verplaatsen naar 'Verwerkt' mislukt.", detail: moveData });
    return;
  }
  res.status(200).json({ status: "ok", movedTo: moveData.metadata?.path_display || destPath });
}

async function handleList(req, res) {
  const accessToken = await getAccessToken();
  const files = await listSourceFiles(accessToken);

  const drafts = [];
  for (const file of files) {
    const dropboxPath = file.path_display || file.path_lower;
    try {
      const buffer = await downloadFile(accessToken, file.path_lower);
      let parsed;
      if (/\.xml$/i.test(file.name)) {
        parsed = parseUbl(buffer.toString("utf8"));
      } else {
        // pdf-parse v2 API: class-based (v1's `pdfParse(buffer)`-functie bestaat niet meer).
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        await parser.destroy();
        parsed = parsePdfText(result.text || "");
      }
      drafts.push({ ...parsed, fileName: file.name, dropboxPath });
    } catch (err) {
      drafts.push({
        fileName: file.name,
        dropboxPath,
        source: /\.xml$/i.test(file.name) ? "UBL" : "PDF",
        description: file.name,
        counterparty: "",
        amount: "",
        dueDate: new Date().toISOString().slice(0, 10),
        invoiceDate: "",
        accountNumber: "",
        parseWarning: `Inlezen van dit bestand is mislukt (${err.message}) — vul alles handmatig aan of sla dit bestand over.`,
      });
    }
  }

  res.status(200).json({ status: "ok", count: drafts.length, drafts });
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      await handleMove(req, res);
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ error: "Alleen GET of POST wordt ondersteund." });
      return;
    }
    await handleList(req, res);
  } catch (err) {
    console.error("dropbox-facturen-inlezen crashed:", err);
    res.status(500).json({ error: `Dropbox-facturen inlezen mislukt: ${err.message}` });
  }
}
