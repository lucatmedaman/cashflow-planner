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

// Dropbox stuurt bij succes/normale API-fouten JSON terug, maar bij
// route-/argumentvalidatiefouten (bv. verkeerd geformatteerde header) een
// PLATTE-TEKST 400-body zoals "Error in call to API function ...". Blind
// res.json() aanroepen crasht daarop. Dit leest altijd eerst als tekst en
// parseert pas daarna, zodat de échte Dropbox-foutmelding zichtbaar blijft.
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

async function getAccountDiagnostics(accessToken) {
  try {
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { data, raw } = await safeJson(res);
    if (!res.ok) return { email: `(kon account niet ophalen: ${data?.error_summary || raw || res.status})`, rootInfo: null };
    return { email: data.email, rootInfo: data.root_info || null };
  } catch (err) {
    return { email: `(kon account niet ophalen: ${err.message})`, rootInfo: null };
  }
}

async function listFolderWithRoot(accessToken, path, pathRootNamespaceId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (pathRootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "namespace_id", namespace_id: pathRootNamespaceId });
  }
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, recursive: false }),
  });
  const { data, raw } = await safeJson(res);
  return { ok: res.ok, data, raw };
}

async function listSourceFiles(accessToken) {
  const primary = await listFolderWithRoot(accessToken, SOURCE_FOLDER);
  if (primary.ok) {
    const rawFiles = (primary.data.entries || []).filter((e) => e[".tag"] === "file");
    const filtered = rawFiles.filter((e) => /\.(xml|pdf)$/i.test(e.name));
    return { files: filtered, allNames: rawFiles.map((e) => e.name), usedNamespace: null };
  }

  const primaryErrorSummary = primary.data?.error_summary;
  if (!primaryErrorSummary || !primaryErrorSummary.includes("not_found")) {
    throw new Error(`Dropbox list_folder mislukt: ${primaryErrorSummary || primary.raw || "onbekende fout"}`);
  }

  // Niet gevonden. Dropbox-API-Path-Root (Team-Space-namespace-override)
  // wordt NIET ondersteund voor App-folder-scope ("sandbox") apps — dus
  // geen namespace-fallback proberen, enkel diagnose-info verzamelen: het
  // account en wat er wél zichtbaar is op app-root-niveau ("").
  const { email } = await getAccountDiagnostics(accessToken);
  const rootRes = await listFolderWithRoot(accessToken, "");
  const rootNames = rootRes.ok
    ? (rootRes.data.entries || []).map((e) => e.name)
    : [`(kon root niet lezen: ${rootRes.data?.error_summary || rootRes.raw || "onbekende fout"})`];
  throw new Error(
    `Map "${SOURCE_FOLDER}" niet gevonden via de Dropbox-API. ` +
    `Gekoppeld account: ${email}. ` +
    `Wat de API op app-root-niveau ziet: ${rootNames.length ? rootNames.join(", ") : "(leeg)"}. ` +
    `Meest waarschijnlijk: het bestand is nog niet volledig gesynchroniseerd naar de Dropbox-servers — controleer op dropbox.com (web) of het bestand daar al zichtbaar is.`
  );
}

async function downloadFile(accessToken, path, pathRootNamespaceId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Dropbox-API-Arg": JSON.stringify({ path }),
  };
  if (pathRootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "namespace_id", namespace_id: pathRootNamespaceId });
  }
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers,
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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  // Zelfde namespace als bij het ophalen gebruikt (Dropbox Business/Team-
  // Space-namespace-verschil), zodat move_v2 hetzelfde pad terugvindt.
  if (body.namespace) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "namespace_id", namespace_id: body.namespace });
  }
  const moveRes = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ from_path: body.path, to_path: destPath, autorename: true }),
  });
  const { data: moveData, raw: moveRaw } = await safeJson(moveRes);
  if (!moveRes.ok) {
    res.status(502).json({ error: "Verplaatsen naar 'Verwerkt' mislukt.", detail: moveData || moveRaw });
    return;
  }
  res.status(200).json({ status: "ok", movedTo: moveData?.metadata?.path_display || destPath });
}

async function handleDiagnose(req, res) {
  const accessToken = await getAccessToken();
  const { email } = await getAccountDiagnostics(accessToken);
  const testPath = `${SOURCE_FOLDER}/api-test-${Date.now()}.txt`;
  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: testPath, mode: "add", autorename: true }),
      "Content-Type": "application/octet-stream",
    },
    body: "Dit is een testbestand van /api/dropbox-facturen-inlezen?diagnose=1 — mag verwijderd worden.",
  });
  const { data: uploadData, raw: uploadRaw } = await safeJson(uploadRes);
  if (!uploadRes.ok) {
    res.status(502).json({
      error: "Test-upload mislukt.",
      account: email,
      detail: uploadData || uploadRaw,
    });
    return;
  }
  res.status(200).json({
    status: "ok",
    account: email,
    uploadedTo: uploadData.path_display,
    note: "Zoek dit bestand op dropbox.com (browser) — de map waarin het staat is de ECHTE locatie die de API als root gebruikt. Mag daarna verwijderd worden.",
  });
}

async function handleList(req, res) {
  const accessToken = await getAccessToken();
  const { files, allNames, usedNamespace } = await listSourceFiles(accessToken);

  if (files.length === 0) {
    res.status(200).json({
      status: "ok",
      count: 0,
      drafts: [],
      // Diagnose: wat staat er letterlijk in de map, ongeacht extensiefilter —
      // zichtbaar in de netwerktab/response als "geen nieuwe bestanden"
      // onverwacht terugkomt terwijl er wel een bestand lokaal zichtbaar is.
      debugAllFilesInFolder: allNames,
    });
    return;
  }

  const drafts = [];
  for (const file of files) {
    const dropboxPath = file.path_display || file.path_lower;
    try {
      const buffer = await downloadFile(accessToken, file.path_lower, usedNamespace);
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
      drafts.push({ ...parsed, fileName: file.name, dropboxPath, dropboxNamespace: usedNamespace || null });
    } catch (err) {
      drafts.push({
        fileName: file.name,
        dropboxPath,
        dropboxNamespace: usedNamespace || null,
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
    if (req.query?.diagnose) {
      await handleDiagnose(req, res);
      return;
    }
    await handleList(req, res);
  } catch (err) {
    console.error("dropbox-facturen-inlezen crashed:", err);
    res.status(500).json({ error: `Dropbox-facturen inlezen mislukt: ${err.message}` });
  }
}
