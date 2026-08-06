import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, Building2, ChevronDown, X, Edit2, Copy,
  TrendingUp, TrendingDown, RotateCcw, AlertCircle,
  Download, Upload, Loader2, RefreshCw, Landmark, Link2, Eye, FileText, ArrowUpDown
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { TABLES, atListAll, atCreate, atUpdate, atDelete } from "./airtable";

// ---------- constants ----------

// Verhoog dit bij elke inhoudelijke update, zodat je in de app zelf kan zien
// of je de nieuwste versie effectief live hebt staan.
const APP_VERSION = "1.77.1";
const VIEW_LABELS = {
  planning: "Planning",
  budget: "Budget",
  beheer: "Beheer",
};
const BEHEER_TABS = [
  { key: "crediteuren", label: "Crediteuren" },
  { key: "afpunten", label: "Afpunten" },
  { key: "koppelen", label: "Koppelen" },
  { key: "betalingen", label: "Betalingen" },
  { key: "boekhoudingen", label: "Boekhoudingen" },
];

const STORAGE_KEY = "cashflow-data"; // now used only as an offline cache / migration source

const RECURRENCE_OPTIONS = [
  { value: "once", label: "Eenmalig" },
  { value: "weekly", label: "Wekelijks" },
  { value: "biweekly", label: "Tweewekelijks" },
  { value: "monthly", label: "Maandelijks" },
  { value: "bimonthly", label: "Om de 2 maanden" },
  { value: "quarterly", label: "Driemaandelijks" },
  { value: "yearly", label: "Jaarlijks" },
];

const ENTITY_COLORS = [
  { bg: "#EEF3F1", ring: "#3B6E5C", text: "#2A4F41", dot: "#3B6E5C" }, // pine
  { bg: "#FBEFE9", ring: "#B3462C", text: "#8A3520", dot: "#B3462C" }, // clay
  { bg: "#FBF1DF", ring: "#B4791F", text: "#8A5A15", dot: "#B4791F" }, // ochre
  { bg: "#EEEEF6", ring: "#4C4E8A", text: "#35376B", dot: "#4C4E8A" }, // indigo-ink
  { bg: "#EAF1F4", ring: "#2A6E82", text: "#1E4F5E", dot: "#2A6E82" }, // teal-slate
  { bg: "#F3EEF6", ring: "#6E4C8A", text: "#523670", dot: "#6E4C8A" }, // plum
];

const DEFAULT_ENTITIES = [
  { id: "personal", name: "Persoonlijk", colorIdx: 0, openingBalance: 0 },
  { id: "medaman", name: "Medaman", colorIdx: 1, openingBalance: 0 },
  { id: "oo", name: "O&O", colorIdx: 2, openingBalance: 0 },
  { id: "drlucbelmans", name: "Dr. Luc Belmans BV", colorIdx: 3, openingBalance: 0 },
];

// ---------- date helpers ----------

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function addMonths(d, n) {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}
function addYears(d, n) {
  const r = new Date(d);
  r.setFullYear(r.getFullYear() + n);
  return r;
}
function stepFor(recurrence) {
  switch (recurrence) {
    case "weekly": return (d) => addDays(d, 7);
    case "biweekly": return (d) => addDays(d, 14);
    case "monthly": return (d) => addMonths(d, 1);
    case "bimonthly": return (d) => addMonths(d, 2);
    case "quarterly": return (d) => addMonths(d, 3);
    case "yearly": return (d) => addYears(d, 1);
    default: return null;
  }
}
function todayISO() { return toISO(new Date()); }

function formatDateLabel(iso) {
  const d = fromISO(iso);
  const t = fromISO(todayISO());
  const diff = Math.round((d - t) / 86400000);
  const base = d.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
  if (diff === 0) return `Vandaag · ${base}`;
  if (diff === 1) return `Morgen · ${base}`;
  if (diff === -1) return `Gisteren · ${base}`;
  return base;
}

function eur(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("nl-BE", { style: "currency", currency: "EUR" });
}

// Generate occurrences for a single item within [rangeStart, rangeEnd] (inclusive, ISO strings)
function generateOccurrences(item, rangeStart, rangeEnd) {
  const occurrences = [];
  const start = fromISO(item.dueDate);
  const rs = fromISO(rangeStart);
  const re = fromISO(rangeEnd);

  if (item.recurrence === "once") {
    if (start >= rs && start <= re) {
      occurrences.push({ date: toISO(start) });
    }
    return occurrences;
  }

  const step = stepFor(item.recurrence);
  if (!step) return occurrences;
  const hardEnd = item.endDate ? fromISO(item.endDate) : null;

  let cursor = new Date(start);
  let guard = 0;
  while (cursor <= re && guard < 6000) {
    guard++;
    if (hardEnd && cursor > hardEnd) break;
    if (cursor >= rs) occurrences.push({ date: toISO(cursor) });
    cursor = step(cursor);
  }
  return occurrences;
}

// Toegestane afwijking (dagen) tussen een occurrence-vervaldatum en de datum
// van een gekoppelde Betaling, per herhalingstype. Hergebruikt op elke plek
// die een Betaling aan de dichtstbijzijnde occurrence van een post koppelt.
function toleranceDaysFor(recurrence) {
  return { weekly: 5, biweekly: 8, monthly: 12, bimonthly: 20, quarterly: 25, yearly: 40 }[recurrence] || 15;
}

// Betaalstatus per occurrence, afgeleid uit de gekoppelde Betalingen van een
// post — vervangt het losse BetaaldeData-veld als bron van waarheid.
// Voor "once"-posten: de laatst gekoppelde Betaling (indien meerdere) geldt.
// Voor herhalende posten: elke Betaling wordt gekoppeld aan haar dichtstbij-
// zijnde occurrence binnen de tolerantie; bij samenval op dezelfde occurrence
// wint de Betaling met de laatste (meest recente) datum.
// Retourneert een Map<occurrenceDateISO, payment>.
function occurrencePaymentMap(item, paymentsById) {
  const map = new Map();
  const linked = (item.paymentIds || []).map((id) => paymentsById[id]).filter(Boolean);
  if (linked.length === 0) return map;

  if (item.recurrence === "once") {
    const latest = linked.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-1)[0];
    map.set(item.dueDate, latest);
    return map;
  }

  const tolerance = toleranceDaysFor(item.recurrence);
  for (const p of linked) {
    const pDate = fromISO(p.date);
    const windowStart = toISO(addDays(pDate, -tolerance));
    const windowEnd = toISO(addDays(pDate, tolerance));
    const occ = generateOccurrences(item, windowStart, windowEnd);
    if (occ.length === 0) continue;
    const nearest = occ.slice().sort(
      (a, b) => Math.abs(fromISO(a.date) - pDate) - Math.abs(fromISO(b.date) - pDate)
    )[0];
    const existing = map.get(nearest.date);
    if (!existing || p.date >= existing.date) map.set(nearest.date, p);
  }
  return map;
}

function entityColor(entity) {
  return ENTITY_COLORS[(entity?.colorIdx ?? 0) % ENTITY_COLORS.length];
}

// Ondersteunt vier matchtypes voor de Naammapping-tabel; "Bevat" (losse
// substring) blijft het gedrag voor rijen zonder MatchType, zodat bestaande
// mappings ongewijzigd blijven werken.
// Ondersteunt vier matchtypes, plus een optionele wildcard (*) in het patroon
// om een variabel stuk tekst op te vangen en te hergebruiken in de correcte
// naam (bv. patroon "BRASSERIE DE *" → correcte naam "Brasserie de *").
// Retourneert null bij geen match, anders { captured } (leeg als geen wildcard).
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

function matchNamePattern(name, mapping) {
  if (!mapping.pattern) return null;
  const n = name || "";
  const raw = mapping.pattern;

  if (raw.includes("*")) {
    const { regex, hasCapture } = buildPatternRegex(raw);
    const m = n.match(regex);
    if (!m) return null;
    return { captured: hasCapture ? m[1] : "" };
  }

  const nLower = n.toLowerCase();
  const p = raw.toLowerCase();
  let matched;
  switch (mapping.matchType) {
    case "Begint met": matched = nLower.startsWith(p); break;
    case "Eindigt met": matched = nLower.endsWith(p); break;
    case "Exact": matched = nLower === p; break;
    case "Bevat":
    default: matched = nLower.includes(p); break;
  }
  return matched ? { captured: "" } : null;
}

function resolveMappedName(mapping, captured) {
  if (mapping.correctName.includes("*")) {
    return mapping.correctName.replace("*", captured.trim());
  }
  return mapping.correctName;
}

// ---------- Airtable <-> local model mapping ----------
// Airtable record IDs (recXXXXXXXXXXXXXXX) are used directly as our local
// entity/counterparty/item ids once synced — no separate id-mapping table needed.

// Voor Rapport en Grafiek: gebruik het laatst gekende banksaldo als
// startpunt van de berekening zodra dat bekend is (via CAMT.053-import of
// PocketSmith-sync), in plaats van het handmatig ingevoerde Startsaldo.
// Startsaldo blijft wel gewoon bewaard en bewerkbaar in Boekhoudingen.
function effectiveBalance(entity) {
  return entity.bankBalance !== null && entity.bankBalance !== undefined
    ? entity.bankBalance
    : entity.openingBalance || 0;
}

// Elke bezetting (occurrence) komt uit generateOccurrences op basis van de
// vervaldatum (nodig voor correcte herhaling-generatie). Voor weergave-volgorde
// en het saldoverloop verschuiven we die datum naar de betaaldatum — het
// aantal dagen verschil tussen betaaldatum en vervaldatum van de post zelf,
// toegepast op elke gegenereerde bezetting (ook toekomstige, bij herhalende
// posten). row.date (de originele vervaldatum-bezetting) blijft ongewijzigd
// voor betaald-tracking en bank-matching — enkel de weergave/sortering
// verschuift.
function projectedPayDate(row) {
  const item = row.item;
  const offsetMs = fromISO(item.payDate || item.dueDate) - fromISO(item.dueDate);
  const offsetDays = Math.round(offsetMs / 86400000);
  return offsetDays === 0 ? row.date : toISO(addDays(fromISO(row.date), offsetDays));
}

function colorIdxFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % ENTITY_COLORS.length;
}

function entityFromRecord(r) {
  return {
    id: r.id,
    name: r.fields.Naam || "(naamloos)",
    openingBalance: typeof r.fields.Startsaldo === "number" ? r.fields.Startsaldo : 0,
    order: typeof r.fields.Volgorde === "number" ? r.fields.Volgorde : 999,
    iban: (r.fields.IBAN || "").replace(/\s+/g, "").toUpperCase(),
    pocketsmithAccount: r.fields.PocketSmithRekening || "",
    bankBalance: typeof r.fields.BankSaldo === "number" ? r.fields.BankSaldo : null,
    bankBalanceDate: r.fields.BankSaldoDatum || null,
    exactOnlineEmail: r.fields.ExactOnlineEmail || "",
    colorIdx: colorIdxFromId(r.id),
  };
}
function counterpartyFromRecord(r) {
  return {
    id: r.id,
    name: r.fields.Naam || "",
    vatNumber: r.fields.BTWNummer || "",
    accountNumber: r.fields.Rekeningnummer || "",
    address: r.fields.Adres || "",
    priority: r.fields.Prioriteit || "",
    noDocDefault: !!r.fields.StandaardGeenDocumentNodig,
  };
}

function categoryFromRecord(r) {
  return { id: r.id, name: r.fields.Naam || "", type: r.fields.Type || "" };
}

function projectFromRecord(r) {
  return {
    id: r.id,
    name: r.fields.Naam || "",
    entityId: r.fields.Boekhouding?.[0] || null,
    status: r.fields.Status || "Actief",
  };
}

function paymentFromRecord(r) {
  let raw = null;
  try {
    raw = r.fields.RuweBrongegevens ? JSON.parse(r.fields.RuweBrongegevens) : null;
  } catch (e) {}
  return {
    id: r.id,
    description: r.fields.Omschrijving || "",
    date: r.fields.Datum || todayISO(),
    amount: typeof r.fields.Bedrag === "number" ? r.fields.Bedrag : 0,
    direction: r.fields.Richting === "in" ? "in" : "uit",
    entityId: r.fields.Boekhouding?.[0] || null,
    source: r.fields.Bron || "Cash-handmatig",
    bankRef: r.fields.Bankreferentie || "",
    volgnummer: r.fields.Volgnummer || "",
    transferType: r.fields.OverschrijvingType || "",
    raw,
    categoryId: r.fields.Categorie?.[0] || null,
    projectId: r.fields.Project?.[0] || null,
    counterpartyId: r.fields.DebiteurCrediteur?.[0] || null,
    documentIds: r.fields.GekoppeldeDocumenten || [],
    noDocumentNeeded: !!r.fields.GeenDocumentNodig,
  };
}
function paymentToFields(payment) {
  return {
    Omschrijving: payment.description,
    Datum: payment.date,
    Bedrag: payment.amount,
    Richting: payment.direction,
    Boekhouding: payment.entityId ? [payment.entityId] : [],
    Bron: payment.source || "Cash-handmatig",
    Bankreferentie: payment.bankRef || "",
    Volgnummer: payment.volgnummer || "",
    OverschrijvingType: payment.transferType || null,
    RuweBrongegevens: payment.raw ? JSON.stringify(payment.raw) : "",
    Categorie: payment.categoryId ? [payment.categoryId] : [],
    Project: payment.projectId ? [payment.projectId] : [],
    DebiteurCrediteur: payment.counterpartyId ? [payment.counterpartyId] : [],
    GekoppeldeDocumenten: payment.documentIds || [],
    GeenDocumentNodig: !!payment.noDocumentNeeded,
  };
}

function itemFromRecord(r) {
  return {
    id: r.id,
    entityId: r.fields.Boekhouding?.[0] || null,
    counterpartyId: r.fields.DebiteurCrediteur?.[0] || null,
    description: r.fields.Omschrijving || "",
    accountNumber: r.fields.Rekeningnummer || "",
    note: r.fields.Opmerking || "",
    amount: typeof r.fields.Bedrag === "number" ? r.fields.Bedrag : 0,
    direction: r.fields.Richting === "in" ? "in" : "uit",
    dueDate: r.fields.Datum || todayISO(),
    payDate: r.fields.Betaaldatum || r.fields.Datum || todayISO(),
    invoiceDate: r.fields.Factuurdatum || null,
    recurrence: r.fields.Herhaling || "once",
    endDate: r.fields.Einddatum || null,
    viaPaypal: !!r.fields.ViaPayPal,
    source: r.fields.Bron || "Handmatig",
    bankRef: r.fields.BankRef || "",
    bankSnapshot: r.fields.BankSnapshot || "",
    read: !!r.fields.Gelezen,
    categoryId: r.fields.Categorie?.[0] || null,
    projectId: r.fields.Project?.[0] || null,
    paymentIds: r.fields.Betalingen || [],
    priority: r.fields.Prioriteit || "",
  };
}
function itemToFields(item) {
  return {
    Omschrijving: item.description,
    Boekhouding: item.entityId ? [item.entityId] : [],
    DebiteurCrediteur: item.counterpartyId ? [item.counterpartyId] : [],
    Rekeningnummer: item.accountNumber || "",
    Opmerking: item.note || "",
    Bedrag: item.amount,
    Richting: item.direction,
    Datum: item.dueDate,
    Betaaldatum: item.payDate || item.dueDate,
    Factuurdatum: item.invoiceDate || null,
    Herhaling: item.recurrence,
    Einddatum: item.endDate || null,
    ViaPayPal: !!item.viaPaypal,
    Bron: item.source || "Handmatig",
    BankRef: item.bankRef || "",
    BankSnapshot: item.bankSnapshot || "",
    Gelezen: !!item.read,
    Categorie: item.categoryId ? [item.categoryId] : [],
    Project: item.projectId ? [item.projectId] : [],
    Prioriteit: item.priority || null,
  };
}

// 3 niveaus, gekoppeld aan de debiteur/crediteur maar per post overrulebaar.
// Leeg op de post = "neem over van de debiteur". Gebruikt in ItemForm,
// CounterpartyView en de prioriteitsbadge op elke post-rij.
const PRIORITY_LEVELS = [
  { value: "Laag", label: "Laag", color: "#5B6570" },
  { value: "Normaal", label: "Normaal", color: "#B4791F" },
  { value: "Hoog", label: "Hoog", color: "#B3462C" },
];
function priorityMeta(value) {
  return PRIORITY_LEVELS.find((p) => p.value === value) || null;
}
// De effectief geldende prioriteit voor een post: eigen waarde indien gezet,
// anders die van de gekoppelde debiteur/crediteur, anders leeg.
function effectivePriority(item, counterpartyById) {
  if (item.priority) return item.priority;
  const cp = item.counterpartyId ? counterpartyById[item.counterpartyId] : null;
  return cp?.priority || "";
}

// ---------- bank statement (CAMT.053) import ----------
// The IBAN-to-boekhouding link now lives on the entity itself (Airtable field
// "IBAN"), editable in the boekhouding-beheerscherm — no more hardcoded map.
function findEntityByIban(entities, iban) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  return entities.find((e) => e.iban && e.iban === clean) || null;
}

// Bank-CSV (puntkomma-gescheiden export zoals BNP Paribas Fortis die levert)
// rechtstreeks inlezen, met exact dezelfde uitkomststructuur als
// parseCamt053 — zodat de rest van de importflow (matching, dedup,
// crediteur-herkenning) identiek blijft. Dit vervangt de losse
// conversiescripts die tot nu toe per CSV nodig waren.
// - Geweigerde verrichtingen (Status ≠ "Geaccepteerd") worden overgeslagen.
// - Unieke referentie: BANKREFERENTIE uit de Details-kolom; fallback
//   IBAN-volgnummer.
// - Het volgnummer blijft zichtbaar bewaard: als suffix in de mededeling
//   én als apart veld in de ruwe brongegevens van elke betaling.
function parseBankCsv(csvText) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV bevat geen gegevensrijen.");
  const header = lines[0].split(";").map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idx = {
    volgnummer: col("Volgnummer"),
    datum: col("Uitvoeringsdatum"),
    bedrag: col("Bedrag"),
    rekening: col("Rekeningnummer"),
    tegenpartij: col("Tegenpartij"),
    naam: col("Naam van de tegenpartij"),
    mededeling: col("Mededeling"),
    details: col("Details"),
    status: col("Status"),
  };
  if (idx.datum < 0 || idx.bedrag < 0 || idx.rekening < 0) {
    throw new Error("Dit lijkt geen bank-CSV: verwachte kolommen (Uitvoeringsdatum, Bedrag, Rekeningnummer) ontbreken.");
  }

  const REF_RE = /BANKREFERENTIE\s*:\s*(\S+)/;
  const seenRefs = new Set();
  let dupCount = 0;
  let iban = null;
  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    // Eenvoudige puntkomma-splitsing volstaat: deze bankexports gebruiken
    // geen quoted velden met puntkomma's erin.
    const cells = lines[i].split(";");
    const status = idx.status >= 0 ? (cells[idx.status] || "").trim() : "Geaccepteerd";
    if (status && status !== "Geaccepteerd") continue;

    const rowIban = (cells[idx.rekening] || "").trim().replace(/\s+/g, "").toUpperCase();
    if (!iban && rowIban) iban = rowIban;

    const rawAmount = (cells[idx.bedrag] || "").trim();
    if (!rawAmount) continue;
    const amountNum = parseFloat(rawAmount.replace(/\./g, "").replace(",", "."));
    if (isNaN(amountNum)) continue;

    const rawDate = (cells[idx.datum] || "").trim();
    const dm = rawDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dm) continue;
    const bookingDate = `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;

    const volgnummer = idx.volgnummer >= 0 ? (cells[idx.volgnummer] || "").trim() : "";
    const details = idx.details >= 0 ? (cells[idx.details] || "").trim() : "";
    const refMatch = details.match(REF_RE);
    let ref = refMatch ? refMatch[1] : `${rowIban}-${volgnummer || i}`;
    if (seenRefs.has(ref)) {
      dupCount++;
      ref = `${ref}-dup${dupCount}`;
    }
    seenRefs.add(ref);

    const counterpartyName = idx.naam >= 0 ? (cells[idx.naam] || "").trim() : "";
    let remittance = idx.mededeling >= 0 ? (cells[idx.mededeling] || "").trim() : "";
    if (!remittance) remittance = details.slice(0, 200);

    entries.push({
      amount: Math.abs(amountNum),
      direction: amountNum >= 0 ? "in" : "uit",
      bookingDate,
      ref,
      counterpartyName,
      counterpartyIban: idx.tegenpartij >= 0 ? (cells[idx.tegenpartij] || "").trim() : "",
      remittance,
      volgnummer,
    });
  }

  entries.sort((a, b) => (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : 0));
  return { iban, accountName: null, entries, closingBalance: null, closingBalanceDate: null };
}

function parseCamt053(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Kon het bestand niet lezen als geldige XML.");
  }
  const iban = doc.querySelector("Stmt > Acct > Id > IBAN")?.textContent || null;
  const accountName = doc.querySelector("Stmt > Acct > Nm")?.textContent || null;

  // Eindsaldo (CLBD = closing booked balance) — het officiële banksaldo
  // volgens dit uittreksel, los van wat wij zelf bijhouden als startsaldo.
  let closingBalance = null;
  let closingBalanceDate = null;
  Array.from(doc.getElementsByTagName("Bal")).forEach((bal) => {
    const code = bal.querySelector("Tp CdOrPrtry Cd")?.textContent;
    if (code === "CLBD") {
      const amt = parseFloat(bal.querySelector(":scope > Amt")?.textContent || "0");
      const cdtDbt = bal.querySelector(":scope > CdtDbtInd")?.textContent || "CRDT";
      closingBalance = cdtDbt === "CRDT" ? amt : -amt;
      closingBalanceDate = bal.querySelector("Dt Dt")?.textContent || null;
    }
  });

  const entries = Array.from(doc.getElementsByTagName("Ntry")).map((ntry) => {
    const amount = parseFloat(ntry.querySelector(":scope > Amt")?.textContent || "0");
    const cdtDbt = ntry.querySelector(":scope > CdtDbtInd")?.textContent || "DBIT";
    const direction = cdtDbt === "CRDT" ? "in" : "uit";
    const bookingDate = ntry.querySelector("BookgDt Dt")?.textContent || null;
    const ref = ntry.querySelector(":scope > AcctSvcrRef")?.textContent || "";

    const dbtrName = ntry.querySelector("RltdPties Dbtr Nm")?.textContent || "";
    const cdtrName = ntry.querySelector("RltdPties Cdtr Nm")?.textContent || "";
    const counterpartyName = (direction === "in" ? dbtrName : cdtrName) || dbtrName || cdtrName || "";

    const dbtrIban = ntry.querySelector("DbtrAcct Id IBAN")?.textContent || "";
    const cdtrIban = ntry.querySelector("CdtrAcct Id IBAN")?.textContent || "";
    const counterpartyIban = (direction === "in" ? dbtrIban : cdtrIban) || dbtrIban || cdtrIban || "";

    const remittance = ntry.querySelector("RmtInf Ustrd")?.textContent || "";

    return { amount, direction, bookingDate, ref, counterpartyName, counterpartyIban, remittance };
  });

  return { iban, accountName, entries, closingBalance, closingBalanceDate };
}

// ---------- main component ----------

export default function CashflowPlanner() {
  const [entities, setEntities] = useState([]);
  const [items, setItems] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [nameMappings, setNameMappings] = useState([]);
  const [payments, setPayments] = useState([]);
  const paymentsById = useMemo(() => {
    const map = {};
    for (const p of payments) map[p.id] = p;
    return map;
  }, [payments]);
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  // Logboek van sync-/importacties (PocketSmith-sync, Bank-import,
  // UBL/PDF-inlezen, JSON-import) — voor "laatst uitgevoerd op"-weergave in
  // het Acties-menu. Persistent in Airtable (TABLES.actionLog), niet enkel
  // in-memory, zodat het ook na een pagina-herlaad of op een ander toestel
  // klopt.
  const [actionLog, setActionLog] = useState([]);

  const [loading, setLoading] = useState(true);
  const [airtableError, setAirtableError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncToast, setSyncToast] = useState(false);

  const [view, setView] = useState("planning"); // planning | budget | crediteuren | ...
  const [budgetTab, setBudgetTab] = useState("rapport"); // sub-tab binnen Budget: rapport | grafiek
  const [beheerTab, setBeheerTab] = useState("crediteuren"); // sub-tab binnen Beheer
  const [showViewMenu, setShowViewMenu] = useState(false);
  const viewMenuRef = useRef(null);
  const [showEntityMenu, setShowEntityMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef(null);
  const entityMenuRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setShowViewMenu(false);
      if (entityMenuRef.current && !entityMenuRef.current.contains(e.target)) setShowEntityMenu(false);
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) setShowActionsMenu(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, []);
  const [jumpToCounterpartyId, setJumpToCounterpartyId] = useState(null);
  const [activeEntity, setActiveEntity] = useState("all");

  function goToCounterparty(counterpartyId) {
    if (!counterpartyId) return;
    setJumpToCounterpartyId(counterpartyId);
    setView("beheer");
    setBeheerTab("crediteuren");
  }
  const [windowDays, setWindowDays] = useState(60);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newEntityName, setNewEntityName] = useState("");
  const [showPaidHistory, setShowPaidHistory] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);

  const emptyForm = {
    entityId: "",
    description: "",
    accountNumber: "",
    note: "",
    counterparty: "",
    amount: "",
    direction: "uit",
    dueDate: todayISO(),
    payDate: todayISO(),
    invoiceDate: "",
    recurrence: "once",
    endDate: "",
    viaPaypal: false,
    priority: "",
  };
  const [form, setForm] = useState(emptyForm);
  const fileInputRef = useRef(null);
  const ublFileInputRef = useRef(null);
  const pdfFileInputRef = useRef(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [ublDraft, setUblDraft] = useState(null); // {entityId, description, counterparty, amount, dueDate, invoiceDate, accountNumber, fileName, parseWarning, source}
  const [ublSaving, setUblSaving] = useState(false);
  const [ublError, setUblError] = useState("");
  const [ublFollowUp, setUblFollowUp] = useState(null); // {pdfFile, filename, entity}
  const [recurringDraft, setRecurringDraft] = useState(null); // {payment, entityId, counterparty, counterpartyId, description, amount, dueDate, recurrence, endDate}
  const [recurringSaving, setRecurringSaving] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [sendingToAccountant, setSendingToAccountant] = useState(false);
  const [sendResult, setSendResult] = useState(null); // {ok, message}
  const [importMsg, setImportMsg] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showBilltoboxRecent, setShowBilltoboxRecent] = useState(false);
  const [showAccountBalances, setShowAccountBalances] = useState(false);
  // Detailscherm (pop-up): { type: "item" | "payment", id }. Kan vanuit elk
  // scherm (Planning, Crediteuren, Koppelen) geopend worden om alle velden
  // van één post of betaling te bekijken, met doorklikbare koppelingen.
  const [detailTarget, setDetailTarget] = useState(null);
  function openDetail(type, id) {
    setDetailTarget({ type, id });
  }
  const [copyMsg, setCopyMsg] = useState("");

  const bankFileInputRef = useRef(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankParsed, setBankParsed] = useState(null); // { iban, accountName, entries }
  const [bankEntityId, setBankEntityId] = useState("");
  const [bankImporting, setBankImporting] = useState(false);
  const [bankResult, setBankResult] = useState(null); // { matched, created, skipped, errors, total }
  const [bankError, setBankError] = useState("");

  const exportPayload = useMemo(
    () => JSON.stringify({ entities, items, counterparties }, null, 2),
    [entities, items, counterparties]
  );

  // Meest recent via Billtobox geïmporteerde posten — gesorteerd op
  // factuurdatum (nieuwste eerst), met vervaldatum als tiebreaker. Airtable's
  // eigen created-time wordt niet lokaal bijgehouden, dus dit is de beste
  // beschikbare proxy voor "recent geïmporteerd".
  const billtoboxRecentItems = useMemo(
    () =>
      items
        .filter((it) => it.source === "Billtobox")
        .sort((a, b) => {
          const ad = a.invoiceDate || a.dueDate || "";
          const bd = b.invoiceDate || b.dueDate || "";
          return bd < ad ? -1 : bd > ad ? 1 : 0;
        })
        .slice(0, 25),
    [items]
  );

  function markSynced() {
    setLastSyncedAt(new Date().toISOString());
    setSyncToast(true);
    setTimeout(() => setSyncToast(false), 2000);
  }

  // Legt datum + tijdstip van een sync-/importactie vast in Airtable
  // (TABLES.actionLog), zodat "laatst uitgevoerd op" persistent zichtbaar is
  // in het Acties-menu. Faalt bewust stil (console.warn) — een mislukte
  // logregel mag de eigenlijke actie (die al gelukt is op het moment dat dit
  // aangeroepen wordt) niet alsnog laten falen richting de gebruiker.
  async function logAction(actie, entityId, details) {
    const tijdstip = new Date().toISOString();
    try {
      const fields = { Actie: actie, Tijdstip: tijdstip };
      if (entityId) fields.Boekhouding = [entityId];
      if (details) fields.Details = details;
      const [rec] = await atCreate(TABLES.actionLog, [{ fields }]);
      setActionLog((prev) => [
        { id: rec.id, actie, tijdstip, entityId: entityId || null, details: details || "" },
        ...prev,
      ]);
    } catch (err) {
      console.warn("Actielog wegschrijven mislukt:", err.message);
    }
  }

  // Local cache mirror — used only as an offline fallback if Airtable is unreachable,
  // never as the source of truth once Airtable sync is active.
  useEffect(() => {
    if (loading) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entities, items, counterparties }));
    } catch (e) {}
  }, [entities, items, counterparties, loading]);

  // Push a local data blob (old cache, or an imported .json) into Airtable as NEW
  // records, remapping old string ids to the freshly created Airtable record ids.
  async function pushLocalDataToAirtable(data) {
    const entityIdMap = {};
    const counterpartyIdMap = {};

    if (data.entities?.length) {
      const created = await atCreate(
        TABLES.entities,
        data.entities.map((e) => ({ fields: { Naam: e.name, Startsaldo: e.openingBalance || 0 } }))
      );
      created.forEach((rec, i) => { entityIdMap[data.entities[i].id] = rec.id; });
    }
    if (data.counterparties?.length) {
      const created = await atCreate(
        TABLES.counterparties,
        data.counterparties.map((c) => ({ fields: { Naam: c.name } }))
      );
      created.forEach((rec, i) => { counterpartyIdMap[data.counterparties[i].id] = rec.id; });
    }
    if (data.items?.length) {
      await atCreate(
        TABLES.items,
        data.items.map((it) => ({
          fields: itemToFields({
            ...it,
            entityId: entityIdMap[it.entityId] || null,
            counterpartyId: counterpartyIdMap[it.counterpartyId] || null,
          }),
        }))
      );
    }
  }

  async function loadFromAirtable() {
    const [entRecs, cpRecs, itemRecs, mapRecs, paymentRecs, catRecs, projRecs, logRecs] = await Promise.all([
      atListAll(TABLES.entities),
      atListAll(TABLES.counterparties),
      atListAll(TABLES.items),
      atListAll(TABLES.nameMappings),
      atListAll(TABLES.payments),
      atListAll(TABLES.categories),
      atListAll(TABLES.projects),
      atListAll(TABLES.actionLog),
    ]);
    return {
      entities: entRecs.map(entityFromRecord),
      counterparties: cpRecs.map(counterpartyFromRecord),
      items: itemRecs.map(itemFromRecord),
      nameMappings: mapRecs.map((r) => ({
        id: r.id,
        pattern: r.fields.Patroon || "",
        correctName: r.fields.CorrecteNaam || "",
        matchType: r.fields.MatchType || "Bevat",
      })),
      payments: paymentRecs.map(paymentFromRecord),
      categories: catRecs.map(categoryFromRecord),
      projects: projRecs.map(projectFromRecord),
      actionLog: logRecs.map((r) => ({
        id: r.id,
        actie: r.fields.Actie || "",
        tijdstip: r.fields.Tijdstip || "",
        entityId: r.fields.Boekhouding?.[0] || null,
        details: r.fields.Details || "",
      })),
    };
  }

  useEffect(() => {
    (async () => {
      try {
        let data = await loadFromAirtable();

        // Empty base: either migrate an existing local cache, or seed the defaults.
        if (data.entities.length === 0 && data.items.length === 0) {
          let cached = null;
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) cached = JSON.parse(raw);
          } catch (e) {}

          if (cached && (cached.entities?.length || cached.items?.length)) {
            await pushLocalDataToAirtable(cached);
          } else {
            await pushLocalDataToAirtable({ entities: DEFAULT_ENTITIES, items: [], counterparties: [] });
          }
          data = await loadFromAirtable();
        }

        setEntities(data.entities);
        setCounterparties(data.counterparties);
        setItems(data.items);
        setNameMappings(data.nameMappings || []);
        setPayments(data.payments || []);
        setCategories(data.categories || []);
        setProjects(data.projects || []);
        setActionLog(data.actionLog || []);
        setOfflineMode(false);
        setAirtableError("");
        markSynced();
      } catch (err) {
        setAirtableError(err.message);
        // Fallback: show the last known local cache, read-only-ish, so the person
        // isn't staring at a blank screen if the network/token is the problem.
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            setEntities(parsed.entities || DEFAULT_ENTITIES);
            setCounterparties(parsed.counterparties || []);
            setItems(parsed.items || []);
            setOfflineMode(true);
          }
        } catch (e2) {}
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function retrySync() {
    setAirtableError("");
    setLoading(true);
    try {
      const data = await loadFromAirtable();
      setEntities(data.entities);
      setCounterparties(data.counterparties);
      setItems(data.items);
      setNameMappings(data.nameMappings || []);
      setPayments(data.payments || []);
      setCategories(data.categories || []);
      setProjects(data.projects || []);
      setActionLog(data.actionLog || []);
      setOfflineMode(false);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
      setOfflineMode(true);
    } finally {
      setLoading(false);
    }
  }

  function exportData() {
    setShowExportModal(true);
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportPayload);
      setCopyMsg("Gekopieerd naar klembord.");
    } catch (e) {
      setCopyMsg("Kopiëren lukte niet automatisch — selecteer de tekst hieronder handmatig.");
    }
    setTimeout(() => setCopyMsg(""), 3000);
  }

  function downloadExport() {
    const blob = new Blob([exportPayload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashflow-data-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        setImportMsg("Bezig met importeren naar Airtable…");
        await pushLocalDataToAirtable(parsed);
        const data = await loadFromAirtable();
        setEntities(data.entities);
        setCounterparties(data.counterparties);
        setItems(data.items);
        setNameMappings(data.nameMappings || []);
        setPayments(data.payments || []);
        setCategories(data.categories || []);
        setProjects(data.projects || []);
        setActionLog(data.actionLog || []);
        markSynced();
        logAction("JSON-import", null, `${parsed.items?.length ?? "?"} posten, ${parsed.counterparties?.length ?? "?"} tegenpartijen`);
        setImportMsg("Geïmporteerd als nieuwe records in Airtable.");
      } catch (err) {
        setImportMsg(`Import mislukt: ${err.message}`);
      }
      setTimeout(() => setImportMsg(""), 5000);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function openBankModal() {
    setBankParsed(null);
    setBankResult(null);
    setBankError("");
    setBankEntityId(activeEntity !== "all" ? activeEntity : "");
    setShowBankModal(true);
  }

  async function handleBankFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankError("");
    setBankResult(null);
    try {
      const text = await file.text();
      const isCsv = /\.csv$/i.test(file.name) || (!text.trimStart().startsWith("<") && text.includes(";"));
      const parsed = isCsv ? parseBankCsv(text) : parseCamt053(text);
      if (!parsed.entries.length) {
        setBankError(isCsv
          ? "Geen geaccepteerde verrichtingen gevonden in deze CSV."
          : "Geen verrichtingen gevonden in dit bestand — is het een geldig CAMT.053-bestand?");
        setBankParsed(null);
      } else {
        setBankParsed(parsed);
        const mapped = findEntityByIban(entities, parsed.iban);
        if (mapped) setBankEntityId(mapped.id);
      }
    } catch (err) {
      setBankError(`Kon bestand niet lezen: ${err.message}`);
      setBankParsed(null);
    }
    e.target.value = "";
  }

  const [pocketsmithSyncing, setPocketsmithSyncing] = useState(false);
  async function triggerPocketsmithSync() {
    setPocketsmithSyncing(true);
    setImportMsg("PocketSmith synchroniseren…");
    try {
      const res = await fetch("/api/pocketsmith-sync");
      const data = await res.json();
      if (!res.ok) {
        setImportMsg(`PocketSmith-sync mislukt: ${data.error || res.status}`);
      } else {
        let msg = `PocketSmith: ${data.matched} gekoppeld, ${data.created} document(en) automatisch aangemaakt, ${data.proposed ?? 0} wachten in Koppelen, ${data.skipped} overgeslagen, ${data.balancesUpdated ?? 0} saldi bijgewerkt.`;
        if (data.balanceError) msg += ` Saldi-fout: ${data.balanceError}`;
        else if ((data.balancesUpdated ?? 0) === 0 && data.pocketsmithAccountNames?.length) {
          msg += ` PocketSmith-rekeningnamen: ${data.pocketsmithAccountNames.join(", ")}`;
        }
        setImportMsg(msg);
        await logAction("PocketSmith-sync", null, msg);
        const reloaded = await loadFromAirtable();
        setEntities(reloaded.entities);
        setCounterparties(reloaded.counterparties);
        setItems(reloaded.items);
        setNameMappings(reloaded.nameMappings || []);
        setPayments(reloaded.payments || []);
        setCategories(reloaded.categories || []);
        setProjects(reloaded.projects || []);
        setActionLog(reloaded.actionLog || []);
        markSynced();
      }
    } catch (err) {
      setImportMsg(`PocketSmith-sync mislukt: ${err.message}`);
    }
    setPocketsmithSyncing(false);
    setTimeout(() => setImportMsg(""), 20000);
  }

  async function confirmBankImport() {
    if (!bankParsed || !bankEntityId) return;
    setBankImporting(true);
    setBankError("");
    let matched = 0, created = 0, proposed = 0, skipped = 0, errors = 0, volgnummersAangevuld = 0;
    const errorDetails = [];

    // Work off local snapshots so matches within this same import don't
    // collide with each other before React state catches up.
    let workingItems = items;
    let workingPayments = payments;
    let workingPaymentsById = { ...paymentsById };

    // Cross-bron-dedup: PocketSmith-betalingen dragen "ps-<id>" als
    // referentie, terwijl CAMT/CSV de échte bankreferentie hebben — dezelfde
    // verrichting matcht dus nooit op referentie alleen. Tweede sleutel:
    // boekhouding + datum + bedrag + richting, uitsluitend tegen
    // PocketSmith-betalingen (om vals-positieven te beperken), en elke
    // bestaande betaling is maar één keer "claimbaar" zodat twee echte
    // verrichtingen met hetzelfde bedrag op dezelfde dag niet allebei tegen
    // dezelfde PocketSmith-betaling wegvallen.
    const crossClaimed = new Set();

    for (const entry of bankParsed.entries) {
      try {
        let existingPayment = entry.ref ? workingPayments.find((p) => p.bankRef === entry.ref) : null;
        if (!existingPayment) {
          existingPayment = workingPayments.find(
            (p) =>
              !crossClaimed.has(p.id) &&
              p.source === "PocketSmith" &&
              p.entityId === bankEntityId &&
              p.date === entry.bookingDate &&
              p.direction === entry.direction &&
              Math.abs(p.amount - entry.amount) < 0.01
          ) || null;
          if (existingPayment) crossClaimed.add(existingPayment.id);
        }
        if (existingPayment) {
          // Al eerder geïmporteerd (via CAMT, CSV of PocketSmith). Enige wat
          // we alsnog doen: een ontbrekend volgnummer aanvullen als deze
          // bron er wél een heeft — nooit een bestaand volgnummer of de
          // bankreferentie overschrijven (de "ps-"-referentie blijft nodig
          // voor de PocketSmith-dedup zelf).
          if (entry.volgnummer && !existingPayment.volgnummer) {
            await atUpdate(TABLES.payments, [{ id: existingPayment.id, fields: { Volgnummer: entry.volgnummer } }]);
            workingPayments = workingPayments.map((p) =>
              p.id === existingPayment.id ? { ...p, volgnummer: entry.volgnummer } : p
            );
            volgnummersAangevuld++;
          }
          skipped++;
          continue;
        }

        const candidates = workingItems.filter(
          (i) => i.entityId === bankEntityId && i.direction === entry.direction &&
            Math.abs(i.amount - entry.amount) < 0.01
        );

        let matchedItem = null, matchedDate = null;
        const entryDate = fromISO(entry.bookingDate);
        for (const cand of candidates) {
          const windowStart = toISO(addDays(entryDate, -10));
          const windowEnd = toISO(addDays(entryDate, 10));
          const candPaidOcc = occurrencePaymentMap(cand, workingPaymentsById);
          const occ = generateOccurrences(cand, windowStart, windowEnd)
            .filter((o) => !candPaidOcc.has(o.date));
          if (occ.length > 0) {
            occ.sort((a, b) => Math.abs(fromISO(a.date) - entryDate) - Math.abs(fromISO(b.date) - entryDate));
            matchedItem = cand;
            matchedDate = occ[0].date;
            break;
          }
        }

        // Crediteur/debiteur vooraf bepalen, zodat de Betaling meteen bij
        // aanmaak al gekoppeld is. Bij een match op een bestaand document
        // nemen we diens crediteur over; anders gaat de banknaam door
        // resolveCounterpartyId, dat ook de naammappings toepast (de
        // vroegere aparte exacte-naam-lookup hier omzeilde die mappings en
        // diende enkel nog het afgeschafte vertrouwd-mechanisme).
        let counterpartyId = null;
        if (matchedItem?.counterpartyId) {
          counterpartyId = matchedItem.counterpartyId;
        } else if (entry.counterpartyName) {
          counterpartyId = await resolveCounterpartyId(entry.counterpartyName);
        }
        // Crediteur-instelling "standaard geen document nodig": enkel
        // relevant als er geen matchedItem is (dan is er sowieso al een
        // gekoppeld document, "geen document nodig" is dan moot).
        const noDocByDefault = !matchedItem && counterpartyId
          ? !!counterpartiesRef.current.find((c) => c.id === counterpartyId)?.noDocDefault
          : false;

        const snapshot = { ...entry, wasCreated: !matchedItem };
        const paymentFields = paymentToFields({
          description: entry.counterpartyName || (entry.remittance || "Bankverrichting").slice(0, 80),
          date: entry.bookingDate,
          amount: entry.amount,
          direction: entry.direction,
          entityId: bankEntityId,
          source: "Bank-import",
          bankRef: entry.ref,
          volgnummer: entry.volgnummer || "",
          raw: snapshot,
          categoryId: null,
          projectId: null,
          counterpartyId,
          documentIds: matchedItem ? [matchedItem.id] : [],
          noDocumentNeeded: noDocByDefault,
        });
        const [paymentRec] = await atCreate(TABLES.payments, [{ fields: paymentFields }]);
        let newPayment = paymentFromRecord(paymentRec);
        workingPayments = [...workingPayments, newPayment];
        workingPaymentsById = { ...workingPaymentsById, [newPayment.id]: newPayment };

        if (matchedItem) {
          const newDocPaymentIds = [...(matchedItem.paymentIds || []), newPayment.id];
          await atUpdate(TABLES.items, [{
            id: matchedItem.id,
            fields: { Betalingen: newDocPaymentIds, Bron: "Bank-import", Gelezen: false },
          }]);
          workingItems = workingItems.map((i) =>
            i.id === matchedItem.id
              ? { ...i, paymentIds: newDocPaymentIds, source: "Bank-import", read: false }
              : i
          );
          matched++;
        } else {
          // Geen match met een bestaande post: de betaling blijft
          // ongekoppeld en wacht in het Koppelen-scherm. Er wordt bewust
          // GEEN automatische "al-betaalde" post meer aangemaakt — ook niet
          // voor vertrouwde crediteuren (dat gedrag is op vraag van de
          // gebruiker verwijderd; de vertrouwd-vlag blijft enkel nog
          // relevant voor factuurstromen zoals Billtobox/PocketSmith).
          proposed++;
        }
      } catch (err) {
        errors++;
        errorDetails.push(`${entry.bookingDate} · ${(entry.counterpartyName || entry.remittance || "?").slice(0, 40)} · ${eur(entry.amount)}: ${err.message}`);
      }
    }

    // Officieel eindsaldo uit het bestand zelf wegschrijven op de boekhouding,
    // los van de verrichtingen — enkel als het bestand er een bevatte.
    if (bankParsed.closingBalance !== null) {
      try {
        await atUpdate(TABLES.entities, [{
          id: bankEntityId,
          fields: { BankSaldo: bankParsed.closingBalance, BankSaldoDatum: bankParsed.closingBalanceDate },
        }]);
        setEntities((prev) =>
          prev.map((e) =>
            e.id === bankEntityId
              ? { ...e, bankBalance: bankParsed.closingBalance, bankBalanceDate: bankParsed.closingBalanceDate }
              : e
          )
        );
      } catch (err) {
        setAirtableError(err.message);
      }
    }

    setItems(workingItems);
    setPayments(workingPayments);
    markSynced();
    logAction("Bank-import", bankEntityId, `${matched} gekoppeld, ${created} aangemaakt, ${proposed} wachten, ${skipped} overgeslagen, ${errors} fout(en) — van ${bankParsed.entries.length} verrichtingen.`);
    setBankResult({ matched, created, proposed, skipped, errors, errorDetails, volgnummersAangevuld, total: bankParsed.entries.length });
    setBankImporting(false);
  }

  // Undo a wrong bank match/creation on `wrongItem`, and instead link the
  // same bank entry (from its stored snapshot) to `targetItemId`.
  async function relinkBankEntry(wrongItem, targetItemId) {
    try {
      let snapshot;
      try {
        snapshot = JSON.parse(wrongItem.bankSnapshot || "{}");
      } catch (e) {
        snapshot = null;
      }
      if (!snapshot || !snapshot.bookingDate) {
        setAirtableError("Kon de originele bankgegevens niet terugvinden voor deze post.");
        return;
      }

      // --- undo on the wrong item ---
      // Betaalstatus is nu afgeleid uit gelinkte Betalingen, dus enkel de
      // gekoppelde Betalingen (paymentIds) bepalen nog of het item "puur
      // bank-aangemaakt" was; het bankSnapshot/BankRef op de Post zelf is
      // legacy en draagt niet meer bij aan de betaalstatus.
      const wasPurelyBankCreated = wrongItem.recurrence === "once" && (wrongItem.paymentIds || []).length === 0;

      if (wasPurelyBankCreated) {
        await atDelete(TABLES.items, [wrongItem.id]);
        setItems((prev) => prev.filter((i) => i.id !== wrongItem.id));
      } else {
        const fields = { Bron: "Handmatig", BankRef: "", BankSnapshot: "" };
        await atUpdate(TABLES.items, [{ id: wrongItem.id, fields }]);
        setItems((prev) =>
          prev.map((i) =>
            i.id === wrongItem.id ? { ...i, source: "Handmatig", bankRef: "", bankSnapshot: "" } : i
          )
        );
      }

      // --- apply to the correct target item ---
      const targetItem = items.find((i) => i.id === targetItemId);
      if (!targetItem) {
        setAirtableError("Doelpost niet gevonden.");
        return;
      }
      const relinkedSnapshot = JSON.stringify({ ...snapshot, wasCreated: false });
      const fields = {
        Bron: "Bank-import",
        BankRef: snapshot.ref || "",
        BankSnapshot: relinkedSnapshot,
        Gelezen: false,
      };
      await atUpdate(TABLES.items, [{ id: targetItem.id, fields }]);
      setItems((prev) =>
        prev.map((i) =>
          i.id === targetItem.id
            ? { ...i, source: "Bank-import", bankRef: snapshot.ref || "", bankSnapshot: relinkedSnapshot, read: false }
            : i
        )
      );
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Voegt duplicateItem samen met targetItemId: duplicateItem verdwijnt, en
  // zijn betaalstatus (indien betaald) verhuist naar de dichtstbijzijnde
  // onbetaalde vervaldatum van de doelpost. Geen bank-brongegevens nodig —
  // werkt voor elke post, handmatig of automatisch.
  async function mergeDuplicateItem(duplicateItem, targetItemId) {
    try {
      const targetItem = items.find((i) => i.id === targetItemId);
      if (!targetItem) {
        setAirtableError("Doelpost niet gevonden.");
        return;
      }

      // Betaalstatus volgt nu uit gelinkte Betalingen: bij een merge
      // verhuizen we de echte Betaling-records van de duplicate naar de
      // doelpost (i.p.v. vroeger een paidDates-datum te kopiëren), zodat de
      // occurrence-matching op de doelpost meteen klopt.
      const duplicatePaymentIds = duplicateItem.paymentIds || [];
      if (duplicatePaymentIds.length > 0) {
        const newTargetPaymentIds = Array.from(new Set([...(targetItem.paymentIds || []), ...duplicatePaymentIds]));
        await atUpdate(TABLES.items, [{ id: targetItem.id, fields: { Betalingen: newTargetPaymentIds } }]);
        setItems((prev) => prev.map((i) => (i.id === targetItem.id ? { ...i, paymentIds: newTargetPaymentIds } : i)));
        await atUpdate(TABLES.payments, duplicatePaymentIds.map((pid) => ({ id: pid, fields: { GekoppeldeDocumenten: [targetItem.id] } })));
        setPayments((prev) => prev.map((p) => (duplicatePaymentIds.includes(p.id) ? { ...p, documentIds: [targetItem.id] } : p)));
      }

      await atDelete(TABLES.items, [duplicateItem.id]);
      setItems((prev) => prev.filter((i) => i.id !== duplicateItem.id));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function markRead(id, read) {
    try {
      await atUpdate(TABLES.items, [{ id, fields: { Gelezen: read } }]);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read } : i)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // ---- Betalingen <-> Documenten koppeling (Fase 1 van de herstructurering) ----

  // Koppelt een Betaling aan een Document: legt de wederzijdse link. De
  // betaalstatus (Planning/Crediteuren/Rapport) volgt automatisch uit deze
  // link via occurrencePaymentMap, geen apart veld meer om bij te werken.
  async function linkPaymentToDocument(payment, doc) {
    try {
      // Betaalstatus volgt nu automatisch uit de link zelf, via
      // occurrencePaymentMap — hier hoeft enkel de koppeling gelegd te
      // worden, geen aparte "betaalde datum" meer te worden bepaald.
      const newDocPaymentIds = [...(doc.paymentIds || []), payment.id];
      const newPaymentDocIds = [...(payment.documentIds || []), doc.id];

      await Promise.all([
        atUpdate(TABLES.items, [{ id: doc.id, fields: { Betalingen: newDocPaymentIds } }]),
        atUpdate(TABLES.payments, [{ id: payment.id, fields: { GekoppeldeDocumenten: newPaymentDocIds } }]),
      ]);

      setItems((prev) => prev.map((i) => (i.id === doc.id ? { ...i, paymentIds: newDocPaymentIds } : i)));
      setPayments((prev) => prev.map((p) => (p.id === payment.id ? { ...p, documentIds: newPaymentDocIds } : p)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function unlinkPaymentFromDocument(payment, docId) {
    try {
      const doc = items.find((i) => i.id === docId);
      const newPaymentDocIds = (payment.documentIds || []).filter((id) => id !== docId);
      await atUpdate(TABLES.payments, [{ id: payment.id, fields: { GekoppeldeDocumenten: newPaymentDocIds } }]);
      setPayments((prev) => prev.map((p) => (p.id === payment.id ? { ...p, documentIds: newPaymentDocIds } : p)));
      if (doc) {
        // Ontkoppelen van de link is genoeg — de occurrence-status volgt
        // meteen uit occurrencePaymentMap zodra deze Betaling niet meer in
        // doc.paymentIds voorkomt, geen apart veld meer om op te schonen.
        const newDocPaymentIds = (doc.paymentIds || []).filter((id) => id !== payment.id);
        await atUpdate(TABLES.items, [{ id: doc.id, fields: { Betalingen: newDocPaymentIds } }]);
        setItems((prev) => prev.map((i) => (i.id === doc.id ? { ...i, paymentIds: newDocPaymentIds } : i)));
      }
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function toggleNoDocumentNeeded(payment) {
    try {
      const next = !payment.noDocumentNeeded;
      await atUpdate(TABLES.payments, [{ id: payment.id, fields: { GeenDocumentNodig: next } }]);
      setPayments((prev) => prev.map((p) => (p.id === payment.id ? { ...p, noDocumentNeeded: next } : p)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function addManualPayment(draft) {
    try {
      const cp = draft.counterpartyId ? counterpartiesRef.current.find((c) => c.id === draft.counterpartyId) : null;
      const fields = paymentToFields({
        description: draft.description || "Handmatige betaling",
        date: draft.date,
        amount: Math.abs(Number(draft.amount)) || 0,
        direction: draft.direction,
        entityId: draft.entityId,
        source: draft.source, // "Cash-handmatig" | "Andere-bank-handmatig"
        bankRef: "",
        raw: null,
        categoryId: draft.categoryId || null,
        projectId: draft.projectId || null,
        counterpartyId: draft.counterpartyId || null,
        documentIds: [],
        noDocumentNeeded: !!cp?.noDocDefault,
      });
      const [rec] = await atCreate(TABLES.payments, [{ fields }]);
      const created = paymentFromRecord(rec);
      setPayments((prev) => [...prev, created]);
      markSynced();
      return created;
    } catch (err) {
      setAirtableError(err.message);
      return null;
    }
  }

  // Verwijdert een Betaling. Was ze nog gekoppeld, dan wordt eerst netjes
  // ontkoppeld (zodat de betaalstatus van de gekoppelde post meteen klopt)
  // voor de betaling zelf verdwijnt.
  async function deletePayment(payment) {
    if (!window.confirm(`Betaling "${payment.description}" (${eur(payment.amount)}) verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return;
    try {
      let working = payment;
      for (const docId of payment.documentIds || []) {
        await unlinkPaymentFromDocument(working, docId);
        working = { ...working, documentIds: (working.documentIds || []).filter((id) => id !== docId) };
      }
      await atDelete(TABLES.payments, [payment.id]);
      setPayments((prev) => prev.filter((p) => p.id !== payment.id));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Eenmalige (maar veilig herhaalbare) migratie: voor elk bestaand document
  // met Bron=Bank-import dat nog geen gekoppelde Betaling heeft (dus van vóór
  // de Betalingen-tabel bestond), alsnog een echte Betaling-record aanmaken
  // en koppelen — puur op basis van wat al op het document zelf staat
  // (BankSnapshot indien aanwezig, anders de eigen velden als terugval).
  async function backfillHistoricBankPayments() {
    const targets = items.filter((i) => i.source === "Bank-import" && (i.paymentIds || []).length === 0);
    let done = 0, failed = 0;
    let workingItems = items;
    let workingPayments = payments;

    for (const doc of targets) {
      try {
        let snap = null;
        try { snap = doc.bankSnapshot ? JSON.parse(doc.bankSnapshot) : null; } catch (e) {}

        const bankRef = doc.bankRef || (snap && snap.ref) || "";
        const isPocketSmith = bankRef.startsWith("ps-");
        const paymentDraft = {
          description: (snap && (snap.counterpartyName || snap.remittance)) || doc.description,
          date: (snap && snap.bookingDate) || doc.dueDate,
          amount: (snap && snap.amount) || doc.amount,
          direction: (snap && snap.direction) || doc.direction,
          entityId: doc.entityId,
          source: isPocketSmith ? "PocketSmith" : "Bank-import",
          bankRef,
          raw: snap || { amount: doc.amount, direction: doc.direction, bookingDate: doc.dueDate, counterpartyName: doc.description, remittance: doc.note || "", wasCreated: null },
          categoryId: null,
          projectId: null,
          counterpartyId: doc.counterpartyId || null,
          documentIds: [doc.id],
          noDocumentNeeded: false,
        };
        const fields = paymentToFields(paymentDraft);
        const [rec] = await atCreate(TABLES.payments, [{ fields }]);
        const created = paymentFromRecord(rec);
        workingPayments = [...workingPayments, created];

        const newDocPaymentIds = [...(doc.paymentIds || []), created.id];
        await atUpdate(TABLES.items, [{ id: doc.id, fields: { Betalingen: newDocPaymentIds } }]);
        workingItems = workingItems.map((i) => (i.id === doc.id ? { ...i, paymentIds: newDocPaymentIds } : i));
        done++;
      } catch (err) {
        failed++;
      }
    }

    setItems(workingItems);
    setPayments(workingPayments);
    markSynced();
    return { total: targets.length, done, failed };
  }

  // Voor een Document zonder gekoppelde Betaling en zonder document-aanmaak-
  // vertrouwen bij de crediteur: maakt een nieuw Document aan vanuit een
  // ongekoppelde Betaling, na bevestiging in de UI (het "voorstel").
  async function createDocumentFromPayment(payment, extra = {}) {
    try {
      const counterpartyId = extra.counterpartyId || null;
      const fields = itemToFields({
        description: extra.description || payment.description,
        entityId: payment.entityId,
        counterpartyId,
        accountNumber: "",
        note: payment.raw?.remittance || "",
        amount: payment.amount,
        direction: payment.direction,
        dueDate: payment.date,
        payDate: payment.date,
        invoiceDate: null,
        recurrence: "once",
        endDate: null,
        viaPaypal: false,
        source: payment.source,
        bankRef: payment.bankRef,
        bankSnapshot: payment.raw ? JSON.stringify({ ...payment.raw, wasCreated: true }) : "",
        read: false,
        categoryId: payment.categoryId,
        projectId: payment.projectId,
      });
      const [rec] = await atCreate(TABLES.items, [{ fields }]);
      const created = itemFromRecord(rec);
      setItems((prev) => [...prev, created]);
      await linkPaymentToDocument(payment, created);
      return created;
    } catch (err) {
      setAirtableError(err.message);
      return null;
    }
  }

  // Vanuit een betaling een HERHALENDE post opzetten (i.p.v. de eenmalige
  // "maak document" hierboven) — voor het geval waarin je weet dat een
  // betaling zich periodiek zal herhalen nog vóór er een formele factuur
  // per periode binnenkomt. Deze betaling zelf wordt als eerste betaalde
  // occurrence gekoppeld, net als bij "maak document".
  async function createRecurringPostFromPayment(payment, draft) {
    try {
      const fields = itemToFields({
        description: draft.description,
        entityId: draft.entityId,
        counterpartyId: draft.counterpartyId,
        accountNumber: "",
        note: "Aangemaakt vanuit een betaling als herhalende post — wordt bijgewerkt zodra de formele factuur binnenkomt (Billtobox of handmatig), i.p.v. verdubbeld.",
        amount: Number(draft.amount),
        direction: payment.direction,
        dueDate: draft.dueDate,
        payDate: payment.date,
        invoiceDate: null,
        recurrence: draft.recurrence,
        endDate: draft.endDate || null,
        viaPaypal: false,
        source: payment.source,
        bankRef: payment.bankRef,
        bankSnapshot: payment.raw ? JSON.stringify({ ...payment.raw, wasCreated: true }) : "",
        read: false,
        categoryId: payment.categoryId,
        projectId: payment.projectId,
      });
      const [rec] = await atCreate(TABLES.items, [{ fields }]);
      const created = itemFromRecord(rec);
      setItems((prev) => [...prev, created]);
      await linkPaymentToDocument(payment, created);
      return created;
    } catch (err) {
      setAirtableError(err.message);
      return null;
    }
  }

  // Toegepast op ALLE bestaande crediteuren, niet enkel nieuwe: elke naam die
  // een Patroon uit de Naammapping-tabel bevat (hoofdletterongevoelig, losse
  // substring) wordt hernoemd naar CorrecteNaam. Bestaat er al een crediteur
  // met die correcte naam, dan worden alle posten van de foute variant
  // verhuisd naar die bestaande crediteur, en wordt de foute verwijderd
  // (samenvoegen i.p.v. dubbele crediteuren laten bestaan).
  async function applyNameMappings() {
    if (nameMappings.length === 0) return { renamed: 0, merged: 0 };
    let renamed = 0, merged = 0;
    let workingCounterparties = counterparties;
    let workingItems = items;

    for (const cp of workingCounterparties) {
      let mapping = null, matchResult = null;
      for (const m of nameMappings) {
        const result = matchNamePattern(cp.name, m);
        if (result) { mapping = m; matchResult = result; break; }
      }
      if (!mapping || !mapping.correctName) continue;
      const target = resolveMappedName(mapping, matchResult.captured).trim();
      if (!target || target.toLowerCase() === cp.name.trim().toLowerCase()) continue;

      try {
        const existingTarget = workingCounterparties.find(
          (c) => c.id !== cp.id && c.name.trim().toLowerCase() === target.toLowerCase()
        );

        if (existingTarget) {
          const affectedItems = workingItems.filter((i) => i.counterpartyId === cp.id);
          for (const it of affectedItems) {
            await atUpdate(TABLES.items, [{ id: it.id, fields: { DebiteurCrediteur: [existingTarget.id] } }]);
          }
          await atDelete(TABLES.counterparties, [cp.id]);
          workingItems = workingItems.map((i) =>
            i.counterpartyId === cp.id ? { ...i, counterpartyId: existingTarget.id } : i
          );
          workingCounterparties = workingCounterparties.filter((c) => c.id !== cp.id);
          merged++;
        } else {
          await atUpdate(TABLES.counterparties, [{ id: cp.id, fields: { Naam: target } }]);
          workingCounterparties = workingCounterparties.map((c) =>
            c.id === cp.id ? { ...c, name: target } : c
          );
          renamed++;
        }
      } catch (err) {
        setAirtableError(err.message);
      }
    }

    setCounterparties(workingCounterparties);
    setItems(workingItems);
    if (renamed || merged) markSynced();
    return { renamed, merged };
  }

  async function addNameMapping(pattern, correctName, matchType) {
    const p = pattern.trim();
    const c = correctName.trim();
    if (!p || !c) return;
    try {
      const [rec] = await atCreate(TABLES.nameMappings, [{ fields: { Patroon: p, CorrecteNaam: c, MatchType: matchType || "Bevat" } }]);
      setNameMappings((prev) => [
        ...prev,
        { id: rec.id, pattern: rec.fields.Patroon, correctName: rec.fields.CorrecteNaam, matchType: rec.fields.MatchType || "Bevat" },
      ]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  function updateNameMappingLocal(id, key, value) {
    setNameMappings((prev) => prev.map((m) => (m.id === id ? { ...m, [key]: value } : m)));
  }
  async function commitNameMapping(id) {
    const mapping = nameMappings.find((m) => m.id === id);
    if (!mapping) return;
    try {
      await atUpdate(TABLES.nameMappings, [{
        id,
        fields: { Patroon: mapping.pattern, CorrecteNaam: mapping.correctName, MatchType: mapping.matchType || "Bevat" },
      }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }
  async function deleteNameMapping(id) {
    try {
      await atDelete(TABLES.nameMappings, [id]);
      setNameMappings((prev) => prev.filter((m) => m.id !== id));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // ---- derived: visible entities for tabs ----
  const entityById = useMemo(() => {
    const m = {};
    entities.forEach((e) => (m[e.id] = e));
    return m;
  }, [entities]);

  const sortedEntities = useMemo(
    () => [...entities].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name)),
    [entities]
  );

  const unreadCount = useMemo(
    () => items.filter((i) => (i.source === "Bank-import" || i.source === "Billtobox") && !i.read).length,
    [items]
  );

  // Rekeningsaldi per boekhouding met bekend banksaldo. BankSaldoDatum wordt
  // bijgewerkt door zowel PocketSmith-sync als CAMT/CSV-bankimport — dit is
  // dus het laatst gekende banksaldo, niet exclusief een PocketSmith-tijdstip
  // (er is geen apart "laatste PocketSmith-sync"-veld in Airtable).
  const accountBalances = useMemo(
    () =>
      sortedEntities
        .filter((e) => e.bankBalance !== null && e.bankBalance !== undefined)
        .sort((a, b) => {
          const ad = a.bankBalanceDate || "";
          const bd = b.bankBalanceDate || "";
          return bd < ad ? -1 : bd > ad ? 1 : 0;
        }),
    [sortedEntities]
  );

  // Laatst uitgevoerd tijdstip per actietype, uit het persistente
  // ActieLog (zie logAction). Simpele "hoogste Tijdstip per Actie"-reductie.
  const lastRunByAction = useMemo(() => {
    const map = {};
    actionLog.forEach((entry) => {
      if (!entry.actie || !entry.tijdstip) return;
      if (!map[entry.actie] || entry.tijdstip > map[entry.actie]) map[entry.actie] = entry.tijdstip;
    });
    return map;
  }, [actionLog]);
  // Laatste Bank-import-tijdstip per boekhouding (Bank-import wordt per
  // entiteit gelogd, in tegenstelling tot PocketSmith-sync dat globaal is).
  const lastBankImportByEntity = useMemo(() => {
    const map = {};
    actionLog.forEach((entry) => {
      if (entry.actie !== "Bank-import" || !entry.entityId || !entry.tijdstip) return;
      if (!map[entry.entityId] || entry.tijdstip > map[entry.entityId]) map[entry.entityId] = entry.tijdstip;
    });
    return map;
  }, [actionLog]);
  function formatActionTimestamp(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? `vandaag ${d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}`
      : `${d.toLocaleDateString("nl-BE")} ${d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}`;
  }

  // Meest recente verrichting per boekhouding, per bron — gebaseerd op de
  // transactiedatum zelf (bankSnapshot-datum indien bekend, anders de
  // vervaldatum van de post). Geen apart "laatst gesynchroniseerd"-tijdstip
  // per item, dus dit is een proxy: "hoe recent is de data", niet letterlijk
  // "wanneer liep de sync laatst".
  const lastUpdateByEntity = useMemo(() => {
    const map = {};
    items.forEach((item) => {
      if (item.source !== "Bank-import" && item.source !== "Billtobox") return;
      let date = item.dueDate;
      if (item.bankSnapshot) {
        try {
          const snap = JSON.parse(item.bankSnapshot);
          if (snap.bookingDate) date = snap.bookingDate;
        } catch (e) {}
      }
      if (!map[item.entityId]) map[item.entityId] = { bank: null, billtobox: null };
      const key = item.source === "Bank-import" ? "bank" : "billtobox";
      if (!map[item.entityId][key] || date > map[item.entityId][key]) {
        map[item.entityId][key] = date;
      }
    });
    return map;
  }, [items]);

  // Vroegste bankverrichting per boekhouding — het spiegelbeeld van
  // lastUpdateByEntity, maar dan de oudste datum i.p.v. de meest recente.
  // Enkel Bank-import (niet Billtobox), en enkel op posten: bank-betalingen
  // zonder gekoppeld document tellen hier niet mee, dat blijft dus een
  // proxy op basis van wat effectief als post is ingelezen/gematcht.
  const firstBankStatementByEntity = useMemo(() => {
    const map = {};
    items.forEach((item) => {
      if (item.source !== "Bank-import") return;
      let date = item.dueDate;
      if (item.bankSnapshot) {
        try {
          const snap = JSON.parse(item.bankSnapshot);
          if (snap.bookingDate) date = snap.bookingDate;
        } catch (e) {}
      }
      if (!map[item.entityId] || date < map[item.entityId]) {
        map[item.entityId] = date;
      }
    });
    // Ook betalingen zelf meenemen (niet enkel posten), zodat een boekhouding
    // waar bank-betalingen nog ongekoppeld in "Koppelen" staan toch een
    // correcte vroegste datum toont.
    payments.forEach((p) => {
      if (p.source !== "Bank-import") return;
      if (!map[p.entityId] || p.date < map[p.entityId]) {
        map[p.entityId] = p.date;
      }
    });
    return map;
  }, [items, payments]);

  const filteredEntityIds = activeEntity === "all" ? sortedEntities.map((e) => e.id) : [activeEntity];

  // Voor de A-Z-sprongbalk in de Crediteuren-header: eerste crediteur per
  // beginletter, enkel onder crediteuren die effectief posten hebben binnen
  // de actieve boekhouding-filter.
  const counterpartyLetterIndex = useMemo(() => {
    const withItems = new Set(
      items.filter((it) => it.counterpartyId && filteredEntityIds.includes(it.entityId)).map((it) => it.counterpartyId)
    );
    const relevant = counterparties
      .filter((c) => withItems.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const map = {};
    for (const c of relevant) {
      const first = c.name.trim().charAt(0).toUpperCase();
      const key = /[A-Z]/.test(first) ? first : "#";
      if (!map[key]) map[key] = c.id;
    }
    return map;
  }, [items, counterparties, filteredEntityIds]);

  // ---- occurrence list for planning window ----
  // Lookback is intentionally far in the past: an unpaid invoice must stay visible
  // until it's marked paid, no matter how old. Only the forward window (windowDays)
  // is user-adjustable; the backward lookback is fixed to avoid ever hiding a debt.
  const rangeStart = toISO(addDays(new Date(), -3650));
  const rangeEnd = toISO(addDays(new Date(), windowDays));

  const occurrenceRows = useMemo(() => {
    const rows = [];
    items.forEach((item) => {
      if (!filteredEntityIds.includes(item.entityId)) return;
      const paidOcc = occurrencePaymentMap(item, paymentsById);
      const occ = generateOccurrences(item, rangeStart, rangeEnd);
      occ.forEach((o) => {
        const paid = paidOcc.has(o.date);
        const row = { itemId: item.id, date: o.date, paid, item };
        row.displayDate = projectedPayDate(row);
        rows.push(row);
      });
    });
    rows.sort((a, b) => {
      if (a.displayDate !== b.displayDate) return a.displayDate < b.displayDate ? -1 : 1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    return rows;
  }, [items, filteredEntityIds, rangeStart, rangeEnd, paymentsById]);

  const upcomingRows = occurrenceRows.filter((r) => !r.paid && r.displayDate <= rangeEnd);
  const recentPaidRows = occurrenceRows
    .filter((r) => r.paid && r.displayDate >= toISO(addDays(new Date(), -14)))
    .sort((a, b) => (a.displayDate < b.displayDate ? 1 : -1));

  const groupedByDate = useMemo(() => {
    const groups = {};
    upcomingRows.forEach((r) => {
      if (!groups[r.displayDate]) groups[r.displayDate] = [];
      groups[r.displayDate].push(r);
    });
    return Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [upcomingRows]);

  // ---- summary numbers (within window, unpaid + today..end only, excludes overdue-before-today for "upcoming" totals) ----
  const windowFutureRows = upcomingRows.filter((r) => r.displayDate >= todayISO());
  const overdueRows = upcomingRows.filter((r) => r.displayDate < todayISO());

  const summary = useMemo(() => {
    let inSum = 0, uitSum = 0;
    windowFutureRows.forEach((r) => {
      if (r.item.direction === "in") inSum += Number(r.item.amount);
      else uitSum += Number(r.item.amount);
    });
    return { inSum, uitSum, net: inSum - uitSum };
  }, [windowFutureRows]);

  // Entity-independent version, used by the Report tab so switching Planning
  // tabs never hides a boekhouding from the report overview.
  const allOccurrenceRows = useMemo(() => {
    const rows = [];
    items.forEach((item) => {
      const paidOcc = occurrencePaymentMap(item, paymentsById);
      const occ = generateOccurrences(item, rangeStart, rangeEnd);
      occ.forEach((o) => {
        const paid = paidOcc.has(o.date);
        rows.push({ itemId: item.id, date: o.date, paid, item });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  }, [items, rangeStart, rangeEnd, paymentsById]);
  const allUpcomingRows = allOccurrenceRows.filter((r) => !r.paid && r.date <= rangeEnd);

  // ---- report data: per entity totals + daily net series — ALWAYS all boekhoudingen ----
  const reportEntities = sortedEntities;

  // All-time payment history — every recorded paidDate on every item, regardless
  // of the forward-looking window used elsewhere. This is retrospective, not projected.
  const paymentHistory = useMemo(() => {
    const rows = [];
    items.forEach((item) => {
      (item.paymentIds || []).forEach((pid) => {
        const p = paymentsById[pid];
        if (p) rows.push({ date: p.date, item });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  }, [items, paymentsById]);

  // "Interne overschrijving"-categorie: telt wél mee in elke boekhouding
  // afzonderlijk (echte cashflow voor die ene boekhouding), maar wordt
  // uitgesloten uit de GECOMBINEERDE ("Alle boekhoudingen") cijfers, waar
  // een overschrijving tussen twee eigen boekhoudingen anders dubbel zou
  // tellen (uitgave bij de ene, inkomst bij de andere, netto nul voor de
  // groep als geheel). Berekend hier al, ver vóór het eerste gebruik
  // (grandTotal), want const-declaraties in dit component worden niet
  // gehoist.
  // Categorieën die per boekhouding gewoon meetellen (echte cashflow voor
  // die ene boekhouding), maar uit de GECOMBINEERDE ("Alle boekhoudingen")
  // cijfers gesloten worden omdat ze daar vertekenen: interne
  // overschrijvingen tussen eigen boekhoudingen (dubbeltelling) en
  // kas/contant-verrichtingen (eigen geld dat van vorm verandert, geen
  // externe uitgave/inkomst).
  const COMBINED_EXCLUDED_CATEGORY_NAMES = ["Interne overschrijving", "Kas/Contant"];
  const combinedExcludedCategoryIds = categories
    .filter((c) => COMBINED_EXCLUDED_CATEGORY_NAMES.includes(c.name))
    .map((c) => c.id);

  const reportTotals = useMemo(() => {
    return reportEntities.map((e) => {
      let inSum = 0, uitSum = 0;
      allOccurrenceRows
        .filter((r) => r.item.entityId === e.id && !r.paid && r.date >= todayISO())
        .forEach((r) => {
          if (r.item.direction === "in") inSum += Number(r.item.amount);
          else uitSum += Number(r.item.amount);
        });
      return { entity: e, inSum, uitSum, net: inSum - uitSum };
    });
  }, [reportEntities, allOccurrenceRows]);

  const grandTotal = useMemo(() => {
    let inSum = 0, uitSum = 0;
    allOccurrenceRows
      .filter((r) => !r.paid && r.date >= todayISO() && !combinedExcludedCategoryIds.includes(r.item.categoryId))
      .forEach((r) => {
        if (r.item.direction === "in") inSum += Number(r.item.amount);
        else uitSum += Number(r.item.amount);
      });
    return { inSum, uitSum, net: inSum - uitSum };
  }, [allOccurrenceRows, combinedExcludedCategoryIds]);

  // ---- counterparties (debiteuren/crediteuren) — kept as a separate normalized list
  // so it can later be split into its own file/table without restructuring anything else.
  const counterpartyById = useMemo(() => {
    const m = {};
    counterparties.forEach((c) => (m[c.id] = c));
    return m;
  }, [counterparties]);

  // BELANGRIJK: resolveCounterpartyId wordt tientallen/honderden keren na
  // elkaar aangeroepen binnen één grote import (CAMT.053 met honderden
  // verrichtingen). Het `counterparties`-state-array is dan een "bevroren"
  // momentopname van vóór de import — setCounterparties(...) plant een
  // update, maar de closure van déze functie ziet die pas na een render,
  // niet meteen bij de volgende aanroep verderop in dezelfde loop. Zonder
  // ref checkte elke aanroep voor dezelfde naam dus tegen een lijst die de
  // net-aangemaakte duplicaten van eerder in diezelfde import nog niet
  // bevatte — vandaar tientallen identiek genaamde crediteuren na een grote
  // import. counterpartiesRef wordt synchroon bijgewerkt, dus is altijd
  // actueel binnen één lopende import.
  const counterpartiesRef = useRef(counterparties);
  useEffect(() => { counterpartiesRef.current = counterparties; }, [counterparties]);

  // Zelfde extractielogica als api/billtobox-import.js (incl. de fix die het
  // UBLExtensions-blok wegknipt vóór elke tag-extractie — dat blok bevat
  // metadata met een eigen <cbc:ID>, die anders per ongeluk als factuurnummer
  // gepakt wordt). Bewust gedupliceerd i.p.v. gedeeld: dit draait in de
  // browser, het origineel in een serverless functie.
  function extractUblTag(xml, tagName) {
    const re = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i");
    const m = xml.match(re);
    return m ? m[1].trim() : null;
  }
  function parseUblXml(rawXml) {
    const xml = rawXml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "");
    const invoiceNumber = extractUblTag(xml, "ID") || "(onbekend nummer)";
    const issueDate = extractUblTag(xml, "IssueDate");
    const dueDate = extractUblTag(xml, "DueDate") || issueDate || todayISO();
    const payableAmountRaw = extractUblTag(xml, "PayableAmount");
    const amount = payableAmountRaw ? Math.abs(parseFloat(payableAmountRaw)) : 0;
    const supplierBlock = extractUblTag(xml, "AccountingSupplierParty") || xml;
    const supplierName =
      extractUblTag(supplierBlock, "RegistrationName") ||
      extractUblTag(supplierBlock, "Name") ||
      "Onbekende leverancier";
    const paymentBlock = extractUblTag(xml, "PaymentMeans") || "";
    const payeeAccountBlock = extractUblTag(paymentBlock, "PayeeFinancialAccount") || "";
    const iban = extractUblTag(payeeAccountBlock, "ID") || "";
    return {
      description: `${supplierName} — factuur ${invoiceNumber}`,
      counterparty: supplierName,
      amount: amount || "",
      dueDate,
      invoiceDate: issueDate || "",
      accountNumber: iban,
      parseWarning: amount ? null : "Kon geen bedrag (PayableAmount) uit dit bestand halen — vul het handmatig aan.",
    };
  }
  function handleUblFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // zodat hetzelfde bestand opnieuw gekozen kan worden
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseUblXml(String(reader.result || ""));
      setUblDraft({
        entityId: activeEntity !== "all" ? activeEntity : "",
        fileName: file.name,
        source: "UBL",
        ...parsed,
      });
      setUblError("");
    };
    reader.onerror = () => setAirtableError("Kon het bestand niet lezen.");
    reader.readAsText(file);
  }

  // PDF-facturen hebben geen gestructureerde tags zoals UBL — dit is dus
  // altijd een ruwe gok op basis van tekstherkenning (via pdf.js, dynamisch
  // geladen), nooit een garantie. Vandaar de permanente waarschuwing en het
  // feit dat élk veld hier standaard leeg/onzeker mag zijn: de gebruiker
  // moet alles nakijken in het reviewscherm vóór opslaan.
  async function ensurePdfJsLoaded() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Kon de PDF-leesbibliotheek niet laden (controleer je internetverbinding)."));
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return window.pdfjsLib;
  }
  async function extractPdfText(arrayBuffer) {
    const pdfjsLib = await ensurePdfJsLoaded();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return fullText;
  }
  const DUTCH_MONTHS = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
  function parseLooseDate(str) {
    if (!str) return null;
    let m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = str.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);
    if (m) return `${m[3]}-${String(DUTCH_MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }
  function parsePdfInvoiceText(rawText) {
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
      description: invoiceNumber ? `${firstLine} — factuur ${invoiceNumber}` : firstLine,
      counterparty: firstLine,
      invoiceNumber,
      amount,
      dueDate: dueDate || invoiceDate || todayISO(),
      invoiceDate,
      accountNumber: "",
      parseWarning: "PDF-herkenning is een ruwe gok, geen gestructureerde data zoals bij UBL — controleer élk veld hieronder (zeker crediteur en datums) vóór je opslaat.",
    };
  }
  function handlePdfFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPdfParsing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = await extractPdfText(reader.result);
        const parsed = parsePdfInvoiceText(text);
        setUblDraft({
          entityId: activeEntity !== "all" ? activeEntity : "",
          fileName: file.name,
          source: "PDF",
          pdfFile: file,
          ...parsed,
        });
        setUblError("");
      } catch (err) {
        setAirtableError(`PDF inlezen mislukt: ${err.message}`);
      } finally {
        setPdfParsing(false);
      }
    };
    reader.onerror = () => { setAirtableError("Kon het bestand niet lezen."); setPdfParsing(false); };
    reader.readAsArrayBuffer(file);
  }

  // Vindt een bestaande HERHALENDE post (Herhaling ≠ once) van dezelfde
  // crediteur/boekhouding/richting met een nog-onbetaalde occurrence dicht
  // bij de vervaldatum van een binnenkomende factuur. Gebruikt door zowel
  // UBL- als PDF-import: als zo'n post bestaat, wordt hij BIJGEWERKT i.p.v.
  // dat er een dubbele, aparte post naast komt te staan.
  function findRecurringMatch({ entityId, counterpartyId, direction, dueDate }) {
    if (!counterpartyId) return null;
    const target = fromISO(dueDate);
    const candidates = items.filter(
      (i) => i.entityId === entityId && i.counterpartyId === counterpartyId && i.direction === direction && i.recurrence !== "once"
    );
    let best = null;
    let bestDiff = Infinity;
    for (const it of candidates) {
      // Tolerantie op maat van het ritme — ruim genoeg om een factuur die
      // wat vroeger/later valt dan de vorige keer toch te herkennen, strak
      // genoeg om nooit de verkeerde periode te raken.
      const tolerance = toleranceDaysFor(it.recurrence);
      const paidOcc = occurrencePaymentMap(it, paymentsById);
      const occs = generateOccurrences(it, toISO(addDays(target, -tolerance)), toISO(addDays(target, tolerance)))
        .filter((o) => !paidOcc.has(o.date));
      for (const o of occs) {
        const diff = Math.abs(fromISO(o.date) - target);
        if (diff < bestDiff) { bestDiff = diff; best = it; }
      }
    }
    return best;
  }

  async function submitUblImport() {
    if (!ublDraft) return;
    if (!ublDraft.entityId) { setUblError("Kies eerst een boekhouding."); return; }
    if (!ublDraft.amount || Number(ublDraft.amount) <= 0) { setUblError("Vul een geldig bedrag in."); return; }
    if (!ublDraft.dueDate) { setUblError("Vul een vervaldatum in."); return; }
    setUblError("");
    setUblSaving(true);
    try {
      const counterpartyId = await resolveCounterpartyId(ublDraft.counterparty);
      const recurringMatch = findRecurringMatch({
        entityId: ublDraft.entityId,
        counterpartyId,
        direction: "uit",
        dueDate: ublDraft.dueDate,
      });

      let created;
      if (recurringMatch) {
        // Bestaande herhalende post bijwerken i.p.v. een dubbele aanmaken.
        // De vervalanchor (Datum) en Herhaling blijven ongewijzigd — enkel
        // de gegevens die per levering kunnen verschillen worden ververst.
        const updateFields = {
          Bedrag: Math.abs(Number(ublDraft.amount)),
          Factuurdatum: ublDraft.invoiceDate || null,
          Rekeningnummer: ublDraft.accountNumber || recurringMatch.accountNumber || "",
          Opmerking: `Bijgewerkt via ${ublDraft.source === "PDF" ? "'PDF-factuur inlezen'" : "'UBL inlezen'"} op ${todayISO()} — was een herhalende post, geen dubbele aangemaakt.`,
          Bron: ublDraft.source === "PDF" ? "Handmatig" : "Billtobox",
        };
        await atUpdate(TABLES.items, [{ id: recurringMatch.id, fields: updateFields }]);
        created = {
          ...recurringMatch,
          amount: updateFields.Bedrag,
          invoiceDate: updateFields.Factuurdatum,
          accountNumber: updateFields.Rekeningnummer,
          note: updateFields.Opmerking,
          source: updateFields.Bron,
        };
        setItems((prev) => prev.map((i) => (i.id === recurringMatch.id ? created : i)));
        setImportNotice(`Herhalende post "${recurringMatch.description}" bijgewerkt (bedrag/factuurdatum) — geen nieuwe post aangemaakt.`);
      } else {
        const draft = {
          entityId: ublDraft.entityId,
          description: ublDraft.description.trim(),
          accountNumber: ublDraft.accountNumber || "",
          note: ublDraft.source === "PDF" ? "Handmatig ingelezen via 'PDF-factuur inlezen' — controleer de gegevens" : "Handmatig ingelezen via 'UBL inlezen'",
          counterpartyId,
          amount: Math.abs(Number(ublDraft.amount)),
          direction: "uit",
          dueDate: ublDraft.dueDate,
          payDate: ublDraft.dueDate,
          invoiceDate: ublDraft.invoiceDate || null,
          recurrence: "once",
          endDate: null,
          viaPaypal: false,
          priority: "",
          };
        const fields = itemToFields(draft);
        fields.Bron = ublDraft.source === "PDF" ? "Handmatig" : "Billtobox";
        const [rec] = await atCreate(TABLES.items, [{ fields }]);
        created = itemFromRecord(rec);
        setItems((prev) => [...prev, created]);
      }
      markSynced();
      logAction(
        ublDraft.source === "PDF" ? "PDF-inlezen" : "UBL-inlezen",
        ublDraft.entityId,
        `${ublDraft.counterparty || "?"} — ${eur(ublDraft.amount)}`
      );

      if (ublDraft.source === "PDF" && ublDraft.pdfFile) {
        const entity = entities.find((en) => en.id === ublDraft.entityId);
        const sanitize = (s) => (s || "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60);
        const filename = `${sanitize(ublDraft.counterparty) || "Factuur"} - ${ublDraft.dueDate} - ${ublDraft.amount}.pdf`;
        setUblFollowUp({ pdfFile: ublDraft.pdfFile, filename, entity });
      }
      setUblDraft(null);
    } catch (err) {
      setAirtableError(err.message);
      setUblError(`Opslaan mislukt: ${err.message}`);
    } finally {
      setUblSaving(false);
    }
  }

  const ITEM_QUICK_FIELD_MAP = {
    description: "Omschrijving", amount: "Bedrag", direction: "Richting", dueDate: "Datum",
    payDate: "Betaaldatum", invoiceDate: "Factuurdatum", recurrence: "Herhaling", endDate: "Einddatum",
    accountNumber: "Rekeningnummer", note: "Opmerking", categoryId: "Categorie",
  };
  async function updateItemQuickField(id, key, value) {
    const airtableField = ITEM_QUICK_FIELD_MAP[key];
    if (!airtableField) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
    try {
      const fieldValue = key === "categoryId" ? (value ? [value] : []) : value === "" ? null : value;
      await atUpdate(TABLES.items, [{ id, fields: { [airtableField]: fieldValue } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }
  const PAYMENT_QUICK_FIELD_MAP = { description: "Omschrijving", amount: "Bedrag", direction: "Richting", date: "Datum", transferType: "OverschrijvingType", categoryId: "Categorie" };
  async function updatePaymentQuickField(id, key, value) {
    const airtableField = PAYMENT_QUICK_FIELD_MAP[key];
    if (!airtableField) return;
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
    try {
      const fieldValue = key === "categoryId" ? (value ? [value] : []) : value;
      await atUpdate(TABLES.payments, [{ id, fields: { [airtableField]: fieldValue } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function submitRecurringDraft() {
    if (!recurringDraft) return;
    if (!recurringDraft.description.trim() || !recurringDraft.amount || !recurringDraft.dueDate) return;
    setRecurringSaving(true);
    try {
      let counterpartyId = recurringDraft.counterpartyId;
      if (!counterpartyId && recurringDraft.counterparty.trim()) {
        counterpartyId = await resolveCounterpartyId(recurringDraft.counterparty.trim());
      }
      await createRecurringPostFromPayment(recurringDraft.payment, { ...recurringDraft, counterpartyId });
      setRecurringDraft(null);
    } finally {
      setRecurringSaving(false);
    }
  }

  function downloadRenamedPdf() {
    if (!ublFollowUp?.pdfFile) return;
    const url = URL.createObjectURL(ublFollowUp.pdfFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = ublFollowUp.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function sendToAccountant() {
    if (!ublFollowUp?.entity?.exactOnlineEmail || !ublFollowUp?.pdfFile) return;
    setSendingToAccountant(true);
    setSendResult(null);
    try {
      const pdfBase64 = await fileToBase64(ublFollowUp.pdfFile);
      const res = await fetch("/api/send-to-accountant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ublFollowUp.entity.exactOnlineEmail,
          subject: `Factuur — ${ublFollowUp.filename.replace(/\.pdf$/i, "")}`,
          text: `Bijgevoegd de factuur "${ublFollowUp.filename}", automatisch doorgestuurd vanuit Cashflow Planner.`,
          filename: ublFollowUp.filename,
          pdfBase64,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Versturen mislukt (${res.status})`);
      setSendResult({ ok: true, message: `Verstuurd naar ${ublFollowUp.entity.exactOnlineEmail}.` });
    } catch (err) {
      setSendResult({ ok: false, message: err.message });
    } finally {
      setSendingToAccountant(false);
    }
  }

  async function resolveCounterpartyId(rawName) {
    let trimmed = (rawName || "").trim();
    if (!trimmed) return null;
    // Naammappings hier al toepassen — vóór het zoeken/aanmaken — zodat een
    // bankvariant als "Mr. Franklin" meteen bij de bestaande "Mr Franklin"
    // uitkomt, in plaats van eerst een duplicaat-crediteur te worden die je
    // achteraf via "Toepassen" moet samenvoegen. Zelfde mapping-logica als
    // de Toepassen-knop en de PocketSmith-sync; eerste treffer wint.
    for (const m of nameMappings) {
      try {
        const match = matchNamePattern(trimmed, m);
        if (match && m.correctName) {
          trimmed = resolveMappedName(m, match.captured).trim();
          break;
        }
      } catch (e) {
        console.error("resolveCounterpartyId: naammapping oversloeg fout:", m, e);
      }
    }
    const existing = counterpartiesRef.current.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const [rec] = await atCreate(TABLES.counterparties, [{ fields: { Naam: trimmed } }]);
    const created = counterpartyFromRecord(rec);
    counterpartiesRef.current = [...counterpartiesRef.current, created];
    setCounterparties((prev) => [...prev, created]);
    return created.id;
  }

  // Wordt zowel automatisch aangeroepen (propagatie vanuit een post die als
  // eerste een prioriteit krijgt) als rechtstreeks vanuit het Crediteuren-
  // scherm, waar de debiteur/crediteur-prioriteit ook manueel ingesteld kan
  // worden.
  async function updateCounterpartyPriority(counterpartyId, priority) {
    try {
      await atUpdate(TABLES.counterparties, [{ id: counterpartyId, fields: { Prioriteit: priority || null } }]);
      setCounterparties((prev) => prev.map((c) => (c.id === counterpartyId ? { ...c, priority: priority || "" } : c)));
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Bewerkformulier voor een debiteur/crediteur zelf (naam, BTW-nummer,
  // rekeningnummer, adres): lokale state per toetsaanslag voor directe
  // feedback, wegschrijven pas on-blur — zelfde patroon als de
  // boekhouding-velden in BoekhoudingenView.
  const COUNTERPARTY_FIELD_MAP = { name: "Naam", vatNumber: "BTWNummer", accountNumber: "Rekeningnummer", address: "Adres" };
  function updateCounterpartyFieldLocal(id, key, value) {
    setCounterparties((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)));
  }
  async function commitCounterpartyField(id, key) {
    const cp = counterparties.find((c) => c.id === id);
    if (!cp) return;
    const airtableField = COUNTERPARTY_FIELD_MAP[key];
    if (!airtableField) return;
    try {
      await atUpdate(TABLES.counterparties, [{ id, fields: { [airtableField]: cp[key] || "" } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }
  async function toggleCounterpartyNoDocDefault(id, next) {
    setCounterparties((prev) => prev.map((c) => (c.id === id ? { ...c, noDocDefault: next } : c)));
    try {
      await atUpdate(TABLES.counterparties, [{ id, fields: { StandaardGeenDocumentNodig: next } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Wijst een debiteur/crediteur toe aan een bestaande Betaling — nodig
  // omdat het "+ Nieuwe betaling"-formulier dit al kon instellen bij
  // aanmaak, maar er voorheen geen manier was om dit nadien nog aan te
  // passen (bv. vanuit het detailscherm).
  async function updatePaymentCounterparty(paymentId, counterpartyId) {
    try {
      await atUpdate(TABLES.payments, [{ id: paymentId, fields: { DebiteurCrediteur: counterpartyId ? [counterpartyId] : [] } }]);
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, counterpartyId } : p)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Bulk-variant: wijst dezelfde crediteur toe aan een geselecteerde reeks
  // betalingen ineens — voor het opruimen van bv. "Zonder crediteur" in
  // groep, i.p.v. één voor één via het detailscherm.
  async function bulkAssignCounterparty(paymentIds, counterpartyId) {
    try {
      for (const id of paymentIds) {
        await atUpdate(TABLES.payments, [{ id, fields: { DebiteurCrediteur: counterpartyId ? [counterpartyId] : [] } }]);
      }
      setPayments((prev) => prev.map((p) => (paymentIds.includes(p.id) ? { ...p, counterpartyId } : p)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
      throw err;
    }
  }

  // Directe "Samenvoegen met…"-actie in Crediteuren: verhuist zowel posten
  // als betalingen (Naammapping deed voorheen enkel posten) van sourceId
  // naar targetId, en verwijdert de bronrecord nadien.
  async function mergeCounterparties(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    try {
      const affectedItems = items.filter((i) => i.counterpartyId === sourceId);
      for (const it of affectedItems) {
        await atUpdate(TABLES.items, [{ id: it.id, fields: { DebiteurCrediteur: [targetId] } }]);
      }
      const affectedPayments = payments.filter((p) => p.counterpartyId === sourceId);
      for (const p of affectedPayments) {
        await atUpdate(TABLES.payments, [{ id: p.id, fields: { DebiteurCrediteur: [targetId] } }]);
      }
      await atDelete(TABLES.counterparties, [sourceId]);

      setItems((prev) => prev.map((i) => (i.counterpartyId === sourceId ? { ...i, counterpartyId: targetId } : i)));
      setPayments((prev) => prev.map((p) => (p.counterpartyId === sourceId ? { ...p, counterpartyId: targetId } : p)));
      setCounterparties((prev) => prev.filter((c) => c.id !== sourceId));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Ruimt in één klik alle debiteuren/crediteuren met exact dezelfde naam op:
  // kiest als canonieke record bij voorkeur eentje dat al gebruikt wordt
  // (heeft posten/betalingen), anders de eerste, en voegt de rest daarin
  // samen (verhuist koppelingen, verwijdert de duplicaten) — het "opruim
  // rommel"-paneel in Crediteuren roept dit per naam aan.
  async function cleanupDuplicateGroup(name) {
    const group = counterparties.filter((c) => c.name === name);
    if (group.length <= 1) return { merged: 0 };
    const withRefs = group.filter(
      (c) => items.some((i) => i.counterpartyId === c.id) || payments.some((p) => p.counterpartyId === c.id)
    );
    const canonical = withRefs[0] || group[0];
    const duplicates = group.filter((c) => c.id !== canonical.id);
    for (const dup of duplicates) {
      await mergeCounterparties(dup.id, canonical.id);
    }
    return { merged: duplicates.length };
  }

  const unusedCounterparties = useMemo(() => {
    const usedIds = new Set();
    items.forEach((i) => { if (i.counterpartyId) usedIds.add(i.counterpartyId); });
    payments.forEach((p) => { if (p.counterpartyId) usedIds.add(p.counterpartyId); });
    return counterparties.filter((c) => !usedIds.has(c.id));
  }, [items, payments, counterparties]);

  async function deleteUnusedCounterparties(ids) {
    try {
      for (let i = 0; i < ids.length; i += 10) {
        await atDelete(TABLES.counterparties, ids.slice(i, i + 10));
      }
      setCounterparties((prev) => prev.filter((c) => !ids.includes(c.id)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // ---- mutations ----
  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  // Always-visible entry point (header button) — jumps to Planning, where the
  // new-item form actually lives, and opens it.
  function openNewItemForm() {
    setView("planning");
    setEditingId(null);
    setShowForm(true);
    setForm({ ...emptyForm, entityId: activeEntity !== "all" ? activeEntity : sortedEntities[0]?.id || "" });
  }

  async function submitForm(e) {
    e.preventDefault();
    if (!form.entityId || !form.description.trim() || !form.amount || !form.dueDate) return;
    try {
      const counterpartyId = await resolveCounterpartyId(form.counterparty);
      const draft = {
        entityId: form.entityId,
        description: form.description.trim(),
        accountNumber: form.accountNumber.trim(),
        note: form.note.trim(),
        counterpartyId,
        amount: Math.abs(Number(form.amount)),
        direction: form.direction,
        dueDate: form.dueDate,
        payDate: form.payDate || form.dueDate,
        invoiceDate: form.invoiceDate || null,
        recurrence: form.recurrence,
        endDate: form.recurrence !== "once" && form.endDate ? form.endDate : null,
        viaPaypal: !!form.viaPaypal,
        priority: form.priority || "",
      };

      // Standaard neemt een post de prioriteit van zijn debiteur/crediteur
      // over; hier gebeurt de omgekeerde uitzondering: als de post een eigen
      // prioriteit krijgt terwijl de debiteur/crediteur nog geen prioriteit
      // heeft, wordt die waarde meteen naar de debiteur/crediteur gekopieerd
      // zodat toekomstige posten daar automatisch van overerven.
      if (draft.priority && counterpartyId) {
        const cp = counterparties.find((c) => c.id === counterpartyId);
        if (cp && !cp.priority) {
          await updateCounterpartyPriority(counterpartyId, draft.priority);
        }
      }

      const fields = itemToFields(draft);
      if (editingId) {
        const [rec] = await atUpdate(TABLES.items, [{ id: editingId, fields }]);
        const updated = itemFromRecord(rec);
        setItems((prev) => prev.map((i) => (i.id === editingId ? updated : i)));
      } else {
        const [rec] = await atCreate(TABLES.items, [{ fields }]);
        const created = itemFromRecord(rec);
        setItems((prev) => [...prev, created]);
      }
      markSynced();
      resetForm();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  function startEdit(item) {
    setForm({
      entityId: item.entityId,
      description: item.description,
      accountNumber: item.accountNumber || "",
      note: item.note || "",
      counterparty: item.counterpartyId ? (counterpartyById[item.counterpartyId]?.name || "") : "",
      amount: String(item.amount),
      direction: item.direction,
      dueDate: item.dueDate,
      payDate: item.payDate || item.dueDate,
      invoiceDate: item.invoiceDate || "",
      recurrence: item.recurrence,
      endDate: item.endDate || "",
      viaPaypal: !!item.viaPaypal,
      priority: item.priority || "",
    });
    setShowForm(false);
    setEditingId(item.id);
  }

  async function deleteItem(id) {
    const item = items.find((i) => i.id === id);
    const label = item?.description || "deze post";
    if (!window.confirm(`"${label}" verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (editingId === id) resetForm();
    try {
      await atDelete(TABLES.items, [id]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function duplicateItem(item) {
    try {
      const fields = itemToFields(item);
      const [rec] = await atCreate(TABLES.items, [{ fields }]);
      const created = itemFromRecord(rec);
      setItems((prev) => [...prev, created]);
      markSynced();
      startEdit(created);
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Vervangt de vroegere togglePaid (die enkel een datum in BetaaldeData
  // omschakelde). Betaalstatus wordt nu uitsluitend afgeleid uit gelinkte
  // Betalingen, dus "betaald markeren" maakt/koppelt een echte Betaling i.p.v.
  // een los datumveld te zetten — elke betaalmarkering heeft nu altijd een
  // onderliggende Betaling-record (Bron: Handmatig indien hier aangemaakt).
  async function markOccurrencePaid(itemId, date) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const paidOcc = occurrencePaymentMap(item, paymentsById);
    const existing = paidOcc.get(date);
    if (existing) {
      // Al betaald op deze occurrence: ontkoppelen. De Betaling zelf blijft
      // bestaan (het geld is en blijft uitgegeven), enkel de koppeling aan
      // déze post verdwijnt.
      await unlinkPaymentFromDocument(existing, itemId);
      return;
    }
    try {
      const fields = paymentToFields({
        description: item.description,
        date,
        amount: item.amount,
        direction: item.direction,
        entityId: item.entityId,
        source: "Cash-handmatig",
        categoryId: item.categoryId,
        projectId: item.projectId,
        counterpartyId: item.counterpartyId,
        documentIds: [itemId],
        noDocumentNeeded: false,
      });
      const [rec] = await atCreate(TABLES.payments, [{ fields }]);
      const created = paymentFromRecord(rec);
      setPayments((prev) => [...prev, created]);
      const newDocPaymentIds = [...(item.paymentIds || []), created.id];
      await atUpdate(TABLES.items, [{ id: itemId, fields: { Betalingen: newDocPaymentIds } }]);
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, paymentIds: newDocPaymentIds } : i)));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function addEntity() {
    const name = newEntityName.trim();
    if (!name) return;
    try {
      const nextOrder = entities.reduce((max, e) => Math.max(max, e.order ?? 0), -1) + 1;
      const [rec] = await atCreate(TABLES.entities, [{ fields: { Naam: name, Startsaldo: 0, Volgorde: nextOrder } }]);
      const created = entityFromRecord(rec);
      setEntities((prev) => [...prev, created]);
      setNewEntityName("");
      setActiveEntity(created.id);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function removeEntity(id) {
    const hasItems = items.some((i) => i.entityId === id);
    if (hasItems) {
      alert("Deze boekhouding heeft nog posten. Verwijder of verplaats die eerst.");
      return;
    }
    setEntities((prev) => prev.filter((e) => e.id !== id));
    if (activeEntity === id) setActiveEntity("all");
    try {
      await atDelete(TABLES.entities, [id]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Local state updates on every keystroke for instant feedback; the Airtable
  // write is committed on blur so typing a number doesn't hammer the API.
  function updateOpeningBalanceLocal(id, value) {
    const num = value === "" ? 0 : Number(value);
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, openingBalance: num } : e)));
  }
  async function commitOpeningBalance(id) {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    try {
      await atUpdate(TABLES.entities, [{ id, fields: { Startsaldo: entity.openingBalance || 0 } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  function updateEntityFieldLocal(id, key, value) {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, [key]: value } : e)));
  }
  async function commitEntityIban(id) {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    try {
      await atUpdate(TABLES.entities, [{ id, fields: { IBAN: entity.iban || "" } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }
  async function commitEntityPocketsmith(id) {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    try {
      await atUpdate(TABLES.entities, [{ id, fields: { PocketSmithRekening: entity.pocketsmithAccount || "" } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }
  async function commitEntityExactOnlineEmail(id) {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    try {
      await atUpdate(TABLES.entities, [{ id, fields: { ExactOnlineEmail: entity.exactOnlineEmail || "" } }]);
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // Swap an entity with its neighbor and persist a fresh sequential order for
  // ALL entities (handles the case where none had an order yet, e.g. right
  // after adding the Volgorde field in Airtable for the first time).
  async function moveEntity(id, direction) {
    const list = [...sortedEntities];
    const idx = list.findIndex((e) => e.id === id);
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= list.length) return;
    [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
    const updates = list.map((e, i) => ({ id: e.id, order: i }));

    setEntities((prev) =>
      prev.map((e) => {
        const u = updates.find((u) => u.id === e.id);
        return u ? { ...e, order: u.order } : e;
      })
    );
    try {
      await atUpdate(TABLES.entities, updates.map((u) => ({ id: u.id, fields: { Volgorde: u.order } })));
      markSynced();
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  // ---- running balance per entity, and combined total ----
  // Opening balance = balance today. Projected forward through every unpaid
  // occurrence (overdue + future) in chronological order.
  const runningBalances = useMemo(() => {
    // Startpunt van de projectie: banksaldo-datum indien bekend, anders vandaag.
    // Alles van vóór dat startpunt telt niet mee — dat is al verrekend in het
    // getoonde saldo zelf.
    function startDateFor(entity) {
      const hasBankBalance = entity.bankBalance !== null && entity.bankBalance !== undefined;
      return hasBankBalance && entity.bankBalanceDate ? entity.bankBalanceDate : todayISO();
    }

    const perEntity = sortedEntities.map((e) => {
      const startDate = startDateFor(e);
      const rows = allUpcomingRows
        .filter((r) => r.item.entityId === e.id)
        .map((r) => ({ ...r, date: projectedPayDate(r) }))
        .filter((r) => r.date >= startDate)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const startBalance = effectiveBalance(e);
      let balance = startBalance;
      const ledger = rows.map((r) => {
        const delta = r.item.direction === "in" ? Number(r.item.amount) : -Number(r.item.amount);
        balance += delta;
        return { ...r, delta, balance };
      });
      return { entity: e, opening: startBalance, openingDate: startDate, ledger, ending: balance };
    });

    const entityStartDates = {};
    sortedEntities.forEach((e) => { entityStartDates[e.id] = startDateFor(e); });

    const combinedRows = allUpcomingRows
      .filter((r) => !combinedExcludedCategoryIds.includes(r.item.categoryId))
      .map((r) => ({ ...r, date: projectedPayDate(r) }))
      .filter((r) => r.date >= (entityStartDates[r.item.entityId] || todayISO()))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const combinedOpening = entities.reduce((sum, e) => sum + effectiveBalance(e), 0);
    let combinedBalance = combinedOpening;
    const combinedLedger = combinedRows.map((r) => {
      const delta = r.item.direction === "in" ? Number(r.item.amount) : -Number(r.item.amount);
      combinedBalance += delta;
      return { ...r, delta, balance: combinedBalance };
    });

    return { perEntity, combinedOpening, combinedLedger, combinedEnding: combinedBalance };
  }, [sortedEntities, entities, allUpcomingRows, combinedExcludedCategoryIds]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F6F5] text-[#93999F] gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Verbinden met Airtable…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6F5] text-[#12181F] font-sans">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .font-display { font-family: 'Spectral', Georgia, serif; }
        .font-num { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      `}</style>
      <div className="max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 lg:px-8 pb-28">
        {/* Header */}
        <header className="pt-6 pb-4 sticky top-0 bg-[#F4F6F5]/95 backdrop-blur z-20">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-[22px] font-medium tracking-tight text-[#12181F] flex items-center gap-2">
                Cashflow
                <span className="font-num text-[10.5px] font-medium text-[#93999F] bg-white border border-[#E3E7E4] rounded px-1.5 py-0.5">
                  v{APP_VERSION}
                </span>
              </h1>
              <p className="text-[12.5px] text-[#5B6570] mt-0.5">Te betalen &amp; te ontvangen, per boekhouding</p>
            </div>
            <div ref={viewMenuRef} className="relative shrink-0">
              <button
                onClick={() => setShowViewMenu((s) => !s)}
                className="flex items-center gap-1.5 bg-white border border-[#E3E7E4] rounded-full px-4 py-1.5 text-sm text-[#12181F] font-medium"
              >
                {VIEW_LABELS[view]}
                {view === "beheer" && beheerTab === "afpunten" && unreadCount > 0 ? ` (${unreadCount})` : ""}
                <ChevronDown className={`w-4 h-4 text-[#93999F] transition-transform ${showViewMenu ? "rotate-180" : ""}`} />
              </button>
              {showViewMenu && (
                <div className="absolute z-50 mt-1.5 right-0 w-52 bg-white border border-[#E3E7E4] rounded-xl shadow-lg py-1 overflow-hidden">
                  {Object.entries(VIEW_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setView(key); setShowViewMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between ${
                        view === key ? "bg-[#12181F] text-[#F4F6F5]" : "text-[#12181F] hover:bg-slate-50"
                      }`}
                    >
                      {label}
                      {key === "beheer" && unreadCount > 0 && (
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${view === key ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3">
            <button
              onClick={openNewItemForm}
              className="w-full flex items-center justify-center gap-2 bg-[#12181F] text-[#F4F6F5] rounded-lg py-2.5 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Nieuwe post (factuur / inkomst)
            </button>
          </div>

          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
            {offlineMode ? (
              <span className="text-amber-600">Offline — laatste lokale kopie getoond, niet gesynchroniseerd met Airtable</span>
            ) : lastSyncedAt ? (
              <span className={syncToast ? "text-[#1E8E5A] font-medium" : ""}>
                {syncToast ? "● Gesynchroniseerd met Airtable" : `Laatst gesynchroniseerd: ${new Date(lastSyncedAt).toLocaleTimeString("nl-BE")}`}
              </span>
            ) : null}
          </div>

          <div ref={actionsMenuRef} className="relative mt-2">
            <button
              onClick={() => setShowActionsMenu((s) => !s)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600"
            >
              Acties
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showActionsMenu ? "rotate-180" : ""}`} />
            </button>
            {showActionsMenu && (
              <div className="absolute z-30 mt-1.5 left-0 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1">
                <button
                  onClick={() => { exportData(); setShowActionsMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" /> Exporteer JSON
                </button>
                <button
                  onClick={() => { triggerImport(); setShowActionsMenu(false); }}
                  title="Importeert als nieuwe records in Airtable"
                  className="w-full flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span className="flex-1 text-left">
                    Importeer JSON
                    {lastRunByAction["JSON-import"] && (
                      <span className="block text-[10px] text-slate-400">laatst: {formatActionTimestamp(lastRunByAction["JSON-import"])}</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => { openBankModal(); setShowActionsMenu(false); }}
                  title="Bankuittreksel inlezen (CAMT.053 XML of CSV-export) en matchen"
                  className="w-full flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Landmark className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span className="flex-1 text-left">
                    Bank importeren
                    {lastRunByAction["Bank-import"] && (
                      <span className="block text-[10px] text-slate-400">laatst: {formatActionTimestamp(lastRunByAction["Bank-import"])}</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => { ublFileInputRef.current?.click(); setShowActionsMenu(false); }}
                  title="Eén UBL-factuur (.xml) rechtstreeks inlezen als post"
                  className="w-full flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span className="flex-1 text-left">
                    UBL inlezen
                    {lastRunByAction["UBL-inlezen"] && (
                      <span className="block text-[10px] text-slate-400">laatst: {formatActionTimestamp(lastRunByAction["UBL-inlezen"])}</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => { pdfFileInputRef.current?.click(); setShowActionsMenu(false); }}
                  disabled={pdfParsing}
                  title="Een factuur als PDF inlezen als post — minder betrouwbaar dan UBL"
                  className="w-full flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  {pdfParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 mt-0.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />}
                  <span className="flex-1 text-left">
                    PDF-factuur inlezen
                    {lastRunByAction["PDF-inlezen"] && (
                      <span className="block text-[10px] text-slate-400">laatst: {formatActionTimestamp(lastRunByAction["PDF-inlezen"])}</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => { triggerPocketsmithSync(); setShowActionsMenu(false); }}
                  disabled={pocketsmithSyncing}
                  title="Haalt nieuwe transacties op via PocketSmith en matcht/maakt posten aan"
                  className="w-full flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  {pocketsmithSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 mt-0.5 shrink-0" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />}
                  <span className="flex-1 text-left">
                    PocketSmith syncen
                    {lastRunByAction["PocketSmith-sync"] && (
                      <span className="block text-[10px] text-slate-400">laatst: {formatActionTimestamp(lastRunByAction["PocketSmith-sync"])}</span>
                    )}
                  </span>
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => { setShowBilltoboxRecent(true); setShowActionsMenu(false); }}
                  title="Toont de meest recent via Billtobox geïmporteerde facturen"
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  Recente Billtobox-facturen{billtoboxRecentItems.length > 0 ? ` (${billtoboxRecentItems.length})` : ""}
                </button>
                <button
                  onClick={() => { setShowAccountBalances(true); setShowActionsMenu(false); }}
                  title="Laatst gekende rekeningsaldi (via PocketSmith-sync of bank-import) per boekhouding"
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Landmark className="w-3.5 h-3.5 text-slate-400" />
                  Rekeningsaldi &amp; laatste sync
                </button>
              </div>
            )}
            <input
              ref={ublFileInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={handleUblFileSelected}
            />
            <input
              ref={pdfFileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={handlePdfFileSelected}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(airtableError || offlineMode) && (
              <button
                onClick={retrySync}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Opnieuw verbinden
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
            {importMsg && <span className="text-xs text-slate-500">{importMsg}</span>}
          </div>

          {airtableError && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{airtableError}</span>
            </div>
          )}

          {importNotice && (
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
              <span className="flex-1">✓ {importNotice}</span>
              <button onClick={() => setImportNotice("")} className="shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Entity menu */}
          <div ref={entityMenuRef} className="relative mt-3">
            <button
              onClick={() => setShowEntityMenu((s) => !s)}
              className="flex items-center gap-1.5 bg-white border border-[#E3E7E4] rounded-full pl-3 pr-3 py-1.5 text-sm text-[#12181F]"
            >
              {activeEntity !== "all" && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: entityColor(entityById[activeEntity]).dot }} />
              )}
              {activeEntity === "all" ? "Alle boekhoudingen" : entityById[activeEntity]?.name}
              <ChevronDown className={`w-4 h-4 text-[#93999F] transition-transform ${showEntityMenu ? "rotate-180" : ""}`} />
            </button>
            {showEntityMenu && (
              <div className="absolute z-50 mt-1.5 left-0 w-64 max-h-80 overflow-y-auto bg-white border border-[#E3E7E4] rounded-xl shadow-lg py-1">
                <button
                  onClick={() => { setActiveEntity("all"); setShowEntityMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm ${activeEntity === "all" ? "bg-[#12181F] text-[#F4F6F5]" : "text-[#12181F] hover:bg-slate-50"}`}
                >
                  Alle boekhoudingen
                </button>
                {sortedEntities.map((e) => {
                  const c = entityColor(e);
                  const active = activeEntity === e.id;
                  return (
                    <button
                      key={e.id}
                      onClick={() => { setActiveEntity(e.id); setShowEntityMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm flex items-center gap-1.5 ${active ? "bg-[#12181F] text-[#F4F6F5]" : "text-[#12181F] hover:bg-slate-50"}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? "white" : c.dot }} />
                      {e.name}
                    </button>
                  );
                })}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={() => { setView("beheer"); setBeheerTab("boekhoudingen"); setShowEntityMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-[#93999F] flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Boekhouding toevoegen
                  </button>
                </div>
              </div>
            )}
          </div>

          {view === "beheer" && beheerTab === "crediteuren" && (
            <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1.5 mt-2">
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((letter) => {
                const targetId = counterpartyLetterIndex[letter];
                return (
                  <button
                    key={letter}
                    disabled={!targetId}
                    onClick={() => targetId && setJumpToCounterpartyId(targetId)}
                    className={`w-6 h-6 text-[11px] rounded flex items-center justify-center ${
                      targetId ? "text-slate-600 hover:bg-slate-100" : "text-slate-200"
                    }`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {view === "planning" ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <SummaryCard label="Te ontvangen" value={summary.inSum} tone="pos" />
              <SummaryCard label="Te betalen" value={summary.uitSum} tone="neg" />
              <SummaryCard label="Netto" value={summary.net} tone={summary.net >= 0 ? "pos" : "neg"} />
            </div>

            <div className="flex items-center justify-between mt-4 text-xs text-slate-500">
              <span>Periode: volgende</span>
              <div className="flex gap-1">
                {[30, 60, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setWindowDays(d)}
                    className={`px-2.5 py-1 rounded-md border text-xs ${
                      windowDays === d ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {/* New-item form (trigger button now lives in the always-visible header) */}
            {showForm && (
              <div className="mt-5">
                <ItemForm
                  form={form}
                  setForm={setForm}
                  entities={sortedEntities}
                  counterparties={counterparties}
                  onSubmit={submitForm}
                  onCancel={resetForm}
                  editing={false}
                />
              </div>
            )}

            {overdueRows.length > 0 && (
              <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3">
                <button
                  onClick={() => setShowOverdue((s) => !s)}
                  className="w-full flex items-center justify-between text-xs font-medium text-rose-700"
                >
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {overdueRows.length} openstaand en verlopen
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOverdue ? "rotate-180" : ""}`} />
                </button>
                {showOverdue && (
                  <div className="space-y-1.5 mt-2">
                    {overdueRows.map((r) => (
                      <React.Fragment key={`${r.itemId}-${r.date}`}>
                        <ItemRow row={r} entity={entityById[r.item.entityId]}
                          counterparty={r.item.counterpartyId ? counterpartyById[r.item.counterpartyId] : null}
                          onTogglePaid={markOccurrencePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem} overdue showDate
                          onCounterpartyClick={goToCounterparty}
                          payments={payments} onLinkPayment={linkPaymentToDocument} onUnlinkPayment={unlinkPaymentFromDocument}
                          onOpenDetail={openDetail} />
                        {editingId === r.itemId && (
                          <ItemForm
                            form={form}
                            setForm={setForm}
                            entities={sortedEntities}
                            counterparties={counterparties}
                            onSubmit={submitForm}
                            onCancel={resetForm}
                            editing
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Grouped list */}
            <div className="mt-6 space-y-5">
              {groupedByDate.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">Niets gepland in deze periode.</p>
              )}
              {groupedByDate.map(([date, rows]) => {
                const dateIn = rows.filter((r) => r.item.direction === "in").reduce((s, r) => s + Number(r.item.amount), 0);
                const dateUit = rows.filter((r) => r.item.direction === "uit").reduce((s, r) => s + Number(r.item.amount), 0);
                const dateNet = dateIn - dateUit;
                return (
                <div key={date}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <p className={`font-display italic text-[15px] ${date < todayISO() ? "text-[#B3462C] not-italic font-semibold" : "text-[#12181F]"}`}>
                      {formatDateLabel(date)}
                    </p>
                    <p className="font-num text-xs font-medium shrink-0">
                      {dateIn > 0 && dateUit > 0 && (
                        <span className="text-[#93999F] font-normal mr-1.5">
                          +{eur(dateIn)} / −{eur(dateUit)}
                        </span>
                      )}
                      <span className={dateNet >= 0 ? "text-[#1E8E5A]" : "text-[#B3462C]"}>
                        {dateNet >= 0 ? "+" : ""}{eur(dateNet)}
                      </span>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((r) => (
                      <React.Fragment key={`${r.itemId}-${r.date}`}>
                        <ItemRow row={r} entity={entityById[r.item.entityId]}
                          counterparty={r.item.counterpartyId ? counterpartyById[r.item.counterpartyId] : null}
                          onTogglePaid={markOccurrencePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem}
                          onCounterpartyClick={goToCounterparty}
                          payments={payments} onLinkPayment={linkPaymentToDocument} onUnlinkPayment={unlinkPaymentFromDocument}
                          onOpenDetail={openDetail} />
                        {editingId === r.itemId && (
                          <ItemForm
                            form={form}
                            setForm={setForm}
                            entities={sortedEntities}
                            counterparties={counterparties}
                            onSubmit={submitForm}
                            onCancel={resetForm}
                            editing
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>

            {/* Paid history */}
            <div className="mt-6">
              <button
                onClick={() => setShowPaidHistory((s) => !s)}
                className="text-xs text-slate-400 flex items-center gap-1"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPaidHistory ? "rotate-180" : ""}`} />
                Recent betaald ({recentPaidRows.length})
              </button>
              {showPaidHistory && (
                <div className="mt-2 space-y-1.5">
                  {recentPaidRows.length === 0 && <p className="text-xs text-slate-300">Nog niets betaald in de laatste 14 dagen.</p>}
                  {recentPaidRows.map((r) => (
                    <React.Fragment key={`${r.itemId}-${r.date}-paid`}>
                      <ItemRow row={r} entity={entityById[r.item.entityId]}
                        counterparty={r.item.counterpartyId ? counterpartyById[r.item.counterpartyId] : null}
                        onTogglePaid={markOccurrencePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem}
                        onCounterpartyClick={goToCounterparty}
                        payments={payments} onLinkPayment={linkPaymentToDocument} onUnlinkPayment={unlinkPaymentFromDocument}
                        onOpenDetail={openDetail} />
                      {editingId === r.itemId && (
                        <ItemForm
                          form={form}
                          setForm={setForm}
                          entities={sortedEntities}
                          counterparties={counterparties}
                          onSubmit={submitForm}
                          onCancel={resetForm}
                          editing
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : view === "budget" ? (
          <>
            <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 mt-2 w-fit">
              <button
                onClick={() => setBudgetTab("rapport")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                  budgetTab === "rapport" ? "bg-[#12181F] text-[#F4F6F5]" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Rapport
              </button>
              <button
                onClick={() => setBudgetTab("grafiek")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                  budgetTab === "grafiek" ? "bg-[#12181F] text-[#F4F6F5]" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Grafiek
              </button>
            </div>
            {budgetTab === "rapport" ? (
              <ReportView
                reportTotals={reportTotals}
                grandTotal={grandTotal}
                showGrand={reportEntities.length > 1}
                entities={reportEntities}
                runningBalances={runningBalances}
                counterpartyById={counterpartyById}
                paymentHistory={paymentHistory}
                entityById={entityById}
                onCounterpartyClick={goToCounterparty}
              />
            ) : (
              <ChartView
                runningBalances={runningBalances}
                activeEntity={activeEntity}
                entities={sortedEntities}
              />
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl p-1 mt-2 w-fit">
              {BEHEER_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setBeheerTab(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 ${
                    beheerTab === t.key ? "bg-[#12181F] text-[#F4F6F5]" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {t.label}
                  {t.key === "afpunten" && unreadCount > 0 && (
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${beheerTab === t.key ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {beheerTab === "crediteuren" ? (
              <CounterpartyView
                items={items}
                payments={payments}
                counterparties={counterparties}
                entities={sortedEntities}
                entityById={entityById}
                filteredEntityIds={filteredEntityIds}
                onTogglePaid={markOccurrencePaid}
                onEdit={startEdit}
                onDelete={deleteItem}
                onDuplicate={duplicateItem}
                editingId={editingId}
                form={form}
                setForm={setForm}
                onSubmit={submitForm}
                onCancel={resetForm}
                onApplyMappings={applyNameMappings}
                nameMappings={nameMappings}
                onAddMapping={addNameMapping}
                onUpdateMappingLocal={updateNameMappingLocal}
                onCommitMapping={commitNameMapping}
                onDeleteMapping={deleteNameMapping}
                jumpToCounterpartyId={jumpToCounterpartyId}
                onJumpHandled={() => setJumpToCounterpartyId(null)}
                onRelink={relinkBankEntry}
                onMerge={mergeDuplicateItem}
                onLinkPayment={linkPaymentToDocument}
                onUnlinkPayment={unlinkPaymentFromDocument}
                onOpenDetail={openDetail}
                onUpdatePriority={updateCounterpartyPriority}
                onUpdateFieldLocal={updateCounterpartyFieldLocal}
                onCommitField={commitCounterpartyField}
                onToggleNoDocDefault={toggleCounterpartyNoDocDefault}
                onMergeCounterparties={mergeCounterparties}
                onCleanupDuplicateGroup={cleanupDuplicateGroup}
                unusedCounterparties={unusedCounterparties}
                onDeleteUnusedCounterparties={deleteUnusedCounterparties}
              />
            ) : beheerTab === "afpunten" ? (
              <ReconciliationView
                items={items}
                entityById={entityById}
                counterpartyById={counterpartyById}
                filteredEntityIds={filteredEntityIds}
                onRelink={relinkBankEntry}
                onMarkRead={markRead}
                onCounterpartyClick={goToCounterparty}
              />
            ) : beheerTab === "koppelen" ? (
              <KoppelenView
                items={items}
                payments={payments}
                entities={sortedEntities}
                entityById={entityById}
                counterpartyById={counterpartyById}
                counterparties={counterparties}
                filteredEntityIds={filteredEntityIds}
                activeEntity={activeEntity}
                categories={categories}
                projects={projects}
                onLink={linkPaymentToDocument}
                onUnlink={unlinkPaymentFromDocument}
                onToggleNoDocNeeded={toggleNoDocumentNeeded}
                onAddManualPayment={addManualPayment}
                onCreateDocFromPayment={createDocumentFromPayment}
                onResolveCounterparty={resolveCounterpartyId}
                onDeletePayment={deletePayment}
                onBackfill={backfillHistoricBankPayments}
                onOpenDetail={openDetail}
                onCounterpartyClick={goToCounterparty}
              />
            ) : beheerTab === "betalingen" ? (
              <BetalingenView
                payments={payments}
                entityById={entityById}
                counterpartyById={counterpartyById}
                counterparties={counterparties}
                filteredEntityIds={filteredEntityIds}
                categories={categories}
                projects={projects}
                onOpenDetail={openDetail}
                onDeletePayment={deletePayment}
                onCounterpartyClick={goToCounterparty}
                onResolveCounterparty={resolveCounterpartyId}
                onBulkAssignCounterparty={bulkAssignCounterparty}
                onOpenRecurringDraft={(payment) =>
                  setRecurringDraft({
                    payment,
                    entityId: payment.entityId,
                    counterparty: counterpartyById[payment.counterpartyId]?.name || payment.description,
                    counterpartyId: payment.counterpartyId || null,
                    description: payment.description,
                    amount: payment.amount,
                    dueDate: payment.date,
                    recurrence: "monthly",
                    endDate: "",
                  })
                }
              />
            ) : (
              <BoekhoudingenView
                entities={sortedEntities}
                newEntityName={newEntityName}
                setNewEntityName={setNewEntityName}
                onAddEntity={addEntity}
                onMoveEntity={moveEntity}
                onUpdateOpeningBalanceLocal={updateOpeningBalanceLocal}
                onCommitOpeningBalance={commitOpeningBalance}
                onUpdateEntityFieldLocal={updateEntityFieldLocal}
                onCommitEntityIban={commitEntityIban}
                onCommitEntityPocketsmith={commitEntityPocketsmith}
                onCommitEntityExactOnlineEmail={commitEntityExactOnlineEmail}
                onRemoveEntity={removeEntity}
                lastUpdateByEntity={lastUpdateByEntity}
                firstBankStatementByEntity={firstBankStatementByEntity}
              />
            )}
          </>
        )}
      </div>

      {/* Bank import modal */}
      {showBankModal && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-30" onClick={() => setShowBankModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[32rem] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-slate-900 flex items-center gap-2"><Landmark className="w-4 h-4" /> Bankuittreksel importeren</h3>
              <button onClick={() => setShowBankModal(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              CAMT.053 XML-bestand of CSV-export van je bank. Verrichtingen die matchen met een openstaande post worden als betaald gemarkeerd; alles wat niet matcht komt als ongekoppelde betaling in het Koppelen-scherm terecht — er worden geen posten automatisch aangemaakt.
            </p>

            {!bankParsed && !bankResult && (
              <>
                <button
                  onClick={() => bankFileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-200 rounded-lg py-6 text-sm text-slate-500 hover:border-slate-300"
                >
                  Klik om een .XML-bestand te kiezen
                </button>
                <input ref={bankFileInputRef} type="file" accept=".xml,application/xml,text/xml,.csv,text/csv" className="hidden" onChange={handleBankFile} />
              </>
            )}

            {bankError && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {bankError}
              </div>
            )}

            {bankParsed && !bankResult && (
              <div className="mt-1 space-y-3">
                <div className="bg-slate-50 rounded-lg p-3 text-sm">
                  <p className="text-slate-700 font-medium">{bankParsed.accountName || findEntityByIban(sortedEntities, bankParsed.iban)?.name || "Onbekende rekening"}</p>
                  <p className="text-xs text-slate-400 font-mono">{bankParsed.iban || "geen IBAN gevonden"}</p>
                  <p className="text-xs text-slate-500 mt-1">{bankParsed.entries.length} verrichting{bankParsed.entries.length !== 1 ? "en" : ""} gevonden</p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Boekhouding</label>
                  <select
                    value={bankEntityId}
                    onChange={(e) => setBankEntityId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="" disabled>Kies boekhouding…</option>
                    {sortedEntities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  {bankParsed.iban && !findEntityByIban(entities, bankParsed.iban) && (
                    <p className="text-[11px] text-amber-600 mt-1">Onbekend IBAN — kies zelf de juiste boekhouding, of vul het IBAN-veld bij deze boekhouding in ("+ Boekhouding" hierboven) zodat dit voortaan automatisch gaat.</p>
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-100 rounded-lg p-2">
                  {bankParsed.entries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1">
                      <span className="text-slate-400 shrink-0 w-20">{e.bookingDate}</span>
                      <span className="flex-1 min-w-0 truncate px-2 text-slate-600">{e.counterpartyName || e.remittance || "—"}</span>
                      <span className={`shrink-0 font-medium ${e.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                        {e.direction === "in" ? "+" : "−"}{eur(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={confirmBankImport}
                  disabled={!bankEntityId || bankImporting}
                  className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {bankImporting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {bankImporting ? "Bezig met importeren…" : `Importeer ${bankParsed.entries.length} verrichting${bankParsed.entries.length !== 1 ? "en" : ""}`}
                </button>
              </div>
            )}

            {bankResult && (
              <div className="mt-2 space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                  <p className="font-medium mb-1">Import voltooid</p>
                  <p>{bankResult.matched} gekoppeld aan bestaand document</p>
                  {bankResult.proposed > 0 && <p>{bankResult.proposed} betaling(en) wachten in "Koppelen" — geen match met een bestaande post</p>}
                  {bankResult.skipped > 0 && <p>{bankResult.skipped} overgeslagen (al eerder geïmporteerd)</p>}
                  {bankResult.volgnummersAangevuld > 0 && <p>{bankResult.volgnummersAangevuld} volgnummer(s) aangevuld op bestaande betalingen</p>}
                  {bankResult.errors > 0 && (
                    <div className="text-rose-600">
                      <p>{bankResult.errors} mislukt:</p>
                      {(bankResult.errorDetails || []).map((d, i) => (
                        <p key={i} className="text-[11px] pl-2">• {d}</p>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setShowBankModal(false)} className="w-full py-2 rounded-lg border border-slate-200 text-sm">
                  Sluiten
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-30" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[32rem]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-slate-900 flex items-center gap-2"><Download className="w-4 h-4" /> Gegevens exporteren</h3>
              <button onClick={() => setShowExportModal(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Kopieer deze tekst en bewaar 'm als <code>.json</code>-bestand (bv. in Dropbox), of plak 'm later terug bij "Importeer JSON".
            </p>
            <textarea
              readOnly
              value={exportPayload}
              onClick={(e) => e.target.select()}
              className="w-full h-56 text-xs font-mono border border-slate-200 rounded-lg p-2.5 outline-none focus:border-slate-400 resize-none"
            />
            <div className="flex items-center gap-2 mt-3">
              <button onClick={downloadExport} className="flex-1 bg-white border border-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium">
                Download bestand
              </button>
              <button onClick={copyExport} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium">
                Kopieer naar klembord
              </button>
            </div>
            <button onClick={() => setShowExportModal(false)} className="w-full mt-2 py-2 rounded-lg border border-slate-200 text-sm">
              Sluiten
            </button>
            {copyMsg && <p className="text-xs text-slate-500 mt-2">{copyMsg}</p>}
          </div>
        </div>
      )}

      {/* Recente Billtobox-facturen modal */}
      {showBilltoboxRecent && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-30" onClick={() => setShowBilltoboxRecent(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[32rem] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4" /> Recente Billtobox-facturen</h3>
              <button onClick={() => setShowBilltoboxRecent(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Laatste {billtoboxRecentItems.length} posten met Bron = Billtobox, gesorteerd op factuurdatum. Tik op een rij voor details.
            </p>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {billtoboxRecentItems.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Geen Billtobox-facturen gevonden.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {billtoboxRecentItems.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => { setShowBilltoboxRecent(false); openDetail("item", it.id); }}
                      className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50 px-1 rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800 truncate">{it.description || "(geen omschrijving)"}</p>
                        <p className="text-[11px] text-slate-400">
                          {entityById[it.entityId]?.name || "?"}
                          {it.invoiceDate ? ` · factuurdatum ${new Date(it.invoiceDate).toLocaleDateString("nl-BE")}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-num text-slate-700 shrink-0">{eur(it.amount)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowBilltoboxRecent(false)} className="w-full mt-3 py-2 rounded-lg border border-slate-200 text-sm shrink-0">
              Sluiten
            </button>
          </div>
        </div>
      )}

      {/* Rekeningsaldi & laatste sync modal */}
      {showAccountBalances && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-30" onClick={() => setShowAccountBalances(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[28rem] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-slate-900 flex items-center gap-2"><Landmark className="w-4 h-4" /> Rekeningsaldi &amp; laatste sync</h3>
              <button onClick={() => setShowAccountBalances(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Laatst gekend banksaldo per boekhouding — "saldodatum" komt uit PocketSmith of het bankbestand zelf,
              "sync-tijdstip" uit het actielog hieronder (wanneer de app dit effectief heeft opgehaald).
              {lastRunByAction["PocketSmith-sync"] && ` Laatste PocketSmith-sync: ${formatActionTimestamp(lastRunByAction["PocketSmith-sync"])}.`}
            </p>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {accountBalances.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Nog geen banksaldo bekend — sync via PocketSmith of importeer een bankuittreksel.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {accountBalances.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 px-1">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: entityColor(e).dot }} />
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">{e.name}</p>
                          <p className="text-[11px] text-slate-400">
                            saldodatum: {e.bankBalanceDate ? new Date(e.bankBalanceDate).toLocaleDateString("nl-BE") : "onbekend"}
                            {e.pocketsmithAccount ? " · PocketSmith gekoppeld" : e.iban ? " · alleen IBAN gekoppeld" : ""}
                          </p>
                          {lastBankImportByEntity[e.id] && (
                            <p className="text-[11px] text-slate-400">
                              laatste bank-import: {formatActionTimestamp(lastBankImportByEntity[e.id])}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-num text-slate-700 shrink-0">{eur(e.bankBalance)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowAccountBalances(false)} className="w-full mt-3 py-2 rounded-lg border border-slate-200 text-sm shrink-0">
              Sluiten
            </button>
          </div>
        </div>
      )}

      {/* UBL-inleesmodal: preview/bewerken vóór opslaan */}
      {ublDraft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-4 space-y-2.5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">{ublDraft.source === "PDF" ? "PDF-factuur inlezen" : "UBL-factuur inlezen"}</p>
              <button onClick={() => setUblDraft(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-[11px] text-slate-400 truncate">{ublDraft.fileName}</p>
            {ublDraft.parseWarning && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                ⚠ {ublDraft.parseWarning}
              </p>
            )}
            <div>
              <label className="text-[11px] text-slate-400">Boekhouding</label>
              <select
                value={ublDraft.entityId}
                onChange={(e) => setUblDraft({ ...ublDraft, entityId: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              >
                <option value="" disabled>Kies een boekhouding…</option>
                {sortedEntities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Omschrijving</label>
              <input
                value={ublDraft.description}
                onChange={(e) => setUblDraft({ ...ublDraft, description: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Debiteur/crediteur</label>
              <CounterpartyAutocomplete
                value={ublDraft.counterparty}
                onChange={(v) => setUblDraft({ ...ublDraft, counterparty: v })}
                counterparties={counterparties}
                inputClassName="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Bedrag</label>
                <input
                  type="number" step="0.01"
                  value={ublDraft.amount}
                  onChange={(e) => setUblDraft({ ...ublDraft, amount: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Vervaldatum</label>
                <input
                  type="date"
                  value={ublDraft.dueDate}
                  onChange={(e) => setUblDraft({ ...ublDraft, dueDate: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Factuurdatum</label>
                <input
                  type="date"
                  value={ublDraft.invoiceDate}
                  onChange={(e) => setUblDraft({ ...ublDraft, invoiceDate: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Rekeningnummer</label>
                <input
                  value={ublDraft.accountNumber}
                  onChange={(e) => setUblDraft({ ...ublDraft, accountNumber: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono outline-none focus:border-slate-400"
                />
              </div>
            </div>
            {ublError && (
              <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{ublError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={submitUblImport}
                disabled={ublSaving}
                className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              >
                {ublSaving ? "Bezig…" : "Post aanmaken"}
              </button>
              <button onClick={() => { setUblDraft(null); setUblError(""); }} className="px-4 rounded-lg border border-slate-200 text-sm">
                Annuleer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Na opslaan van een PDF-import: hernoemd bestand downloaden + evt. e-mail naar boekhouding openen */}
      {ublFollowUp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 space-y-3">
            <p className="text-sm font-medium text-slate-800">Post aangemaakt ✓</p>
            <p className="text-xs text-slate-500">
              Volgende stap: bewaar de PDF onder een duidelijke naam en stuur 'm door naar de boekhouding.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-600 break-all">
              {ublFollowUp.filename}
            </div>
            {ublFollowUp.entity?.exactOnlineEmail ? (
              <button
                onClick={sendToAccountant}
                disabled={sendingToAccountant}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              >
                {sendingToAccountant ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {sendingToAccountant ? "Bezig met versturen…" : `Verstuur automatisch naar ${ublFollowUp.entity.name}'s boekhouding`}
              </button>
            ) : (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                Geen "ExactOnlineEmail" ingesteld bij {ublFollowUp.entity?.name || "deze boekhouding"} — voeg dat toe in Boekhoudingen om hier automatisch te kunnen versturen.
              </p>
            )}
            {sendResult && (
              <p className={`text-[11px] rounded-lg px-2.5 py-1.5 border ${sendResult.ok ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200"}`}>
                {sendResult.ok ? "✓ " : "⚠ "}{sendResult.message}
              </p>
            )}
            <button
              onClick={downloadRenamedPdf}
              className="w-full flex items-center justify-center gap-2 border border-slate-200 rounded-lg py-2 text-sm font-medium text-slate-700"
            >
              <Download className="w-4 h-4" /> Download hernoemd (voor je eigen archief)
            </button>
            <button onClick={() => { setUblFollowUp(null); setSendResult(null); }} className="w-full text-xs text-slate-400 pt-1">
              Sluiten
            </button>
          </div>
        </div>
      )}

      {/* Herhalende post aanmaken vanuit een betaling */}
      {recurringDraft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-4 space-y-2.5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">Herhalende post opzetten</p>
              <button onClick={() => setRecurringDraft(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-[11px] text-slate-400">
              Deze betaling wordt meteen als eerste betaalde occurrence gekoppeld. Zodra de formele factuur binnenkomt (Billtobox of handmatig via UBL/PDF) voor eenzelfde crediteur rond een volgende vervaldag, wordt deze post bijgewerkt in plaats van verdubbeld.
            </p>
            <div>
              <label className="text-[11px] text-slate-400">Omschrijving</label>
              <input
                value={recurringDraft.description}
                onChange={(e) => setRecurringDraft({ ...recurringDraft, description: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Debiteur/crediteur</label>
              <CounterpartyAutocomplete
                value={recurringDraft.counterparty}
                onChange={(v) => setRecurringDraft({ ...recurringDraft, counterparty: v, counterpartyId: null })}
                counterparties={counterparties}
                inputClassName="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Bedrag</label>
                <input
                  type="number" step="0.01"
                  value={recurringDraft.amount}
                  onChange={(e) => setRecurringDraft({ ...recurringDraft, amount: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Eerste vervaldatum</label>
                <input
                  type="date"
                  value={recurringDraft.dueDate}
                  onChange={(e) => setRecurringDraft({ ...recurringDraft, dueDate: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Herhaling</label>
                <select
                  value={recurringDraft.recurrence}
                  onChange={(e) => setRecurringDraft({ ...recurringDraft, recurrence: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                >
                  <option value="weekly">Wekelijks</option>
                  <option value="biweekly">Tweewekelijks</option>
                  <option value="monthly">Maandelijks</option>
                  <option value="bimonthly">Tweemaandelijks</option>
                  <option value="quarterly">Driemaandelijks</option>
                  <option value="yearly">Jaarlijks</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Einddatum (optioneel)</label>
                <input
                  type="date"
                  value={recurringDraft.endDate}
                  onChange={(e) => setRecurringDraft({ ...recurringDraft, endDate: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={submitRecurringDraft}
                disabled={recurringSaving || !recurringDraft.description.trim() || !recurringDraft.amount || !recurringDraft.dueDate}
                className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              >
                {recurringSaving ? "Bezig…" : "Herhalende post aanmaken"}
              </button>
              <button onClick={() => setRecurringDraft(null)} className="px-4 rounded-lg border border-slate-200 text-sm">
                Annuleer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailscherm (post of betaling) */}
      {detailTarget && (
        <DetailModal
          key={`${detailTarget.type}-${detailTarget.id}`}
          target={detailTarget}
          items={items}
          payments={payments}
          entityById={entityById}
          counterpartyById={counterpartyById}
          counterparties={counterparties}
          categories={categories}
          projects={projects}
          onClose={() => setDetailTarget(null)}
          onOpenDetail={openDetail}
          onEditItem={(item) => { startEdit(item); setView("planning"); setDetailTarget(null); }}
          onDeleteItem={async (id) => { await deleteItem(id); setDetailTarget(null); }}
          onUnlinkPayment={unlinkPaymentFromDocument}
          onLinkPayment={linkPaymentToDocument}
          onDeletePayment={async (payment) => { await deletePayment(payment); setDetailTarget(null); }}
          onResolveCounterparty={resolveCounterpartyId}
          onUpdatePaymentCounterparty={updatePaymentCounterparty}
          onCounterpartyClick={goToCounterparty}
          onUpdateItemField={updateItemQuickField}
          onUpdatePaymentField={updatePaymentQuickField}
          onToggleNoDocNeeded={toggleNoDocumentNeeded}
          onCreateDocFromPayment={createDocumentFromPayment}
        />
      )}

    </div>
  );
}

// ---------- subcomponents ----------

function SummaryCard({ label, value, tone, isCount }) {
  const color = tone === "pos" ? "#1E8E5A" : "#B3462C";
  return (
    <div className="bg-white border border-[#E3E7E4] rounded-xl px-3 py-2.5">
      <p className="text-[10.5px] uppercase tracking-wide text-[#93999F]">{label}</p>
      <p className="font-num text-[17px] font-medium mt-0.5" style={{ color: isCount ? "#12181F" : color }}>
        {isCount ? value : eur(value)}
      </p>
    </div>
  );
}

function ItemRow({ row, entity, counterparty, onTogglePaid, onEdit, onDelete, onDuplicate, overdue, showDate, onCounterpartyClick, payments, onLinkPayment, onUnlinkPayment, onOpenDetail }) {
  const c = entityColor(entity);
  const isIn = row.item.direction === "in";
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [chosenPaymentId, setChosenPaymentId] = useState("");
  const [linking, setLinking] = useState(false);
  const paymentIds = row.item.paymentIds || [];
  const linkCandidates = (payments || [])
    .filter((p) => p.entityId === row.item.entityId && (p.documentIds || []).length === 0 && !p.noDocumentNeeded)
    .sort((a, b) => a.amount - b.amount);
  const effPriority = row.item.priority || counterparty?.priority || "";
  const priorityInfo = priorityMeta(effPriority);

  return (
    <>
    <div className={`flex items-stretch bg-white border rounded-lg overflow-hidden ${overdue ? "border-[#E9C7B9]" : "border-[#E3E7E4]"}`}>
      <div className="w-[3px] shrink-0" style={{ background: c.dot }} />
      <div className="flex-1 min-w-0 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
      <button
        onClick={() => onTogglePaid(row.itemId, row.date)}
        className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition ${
          row.paid ? "bg-[#1E8E5A] border-[#1E8E5A]" : "border-[#C7CCC9]"
        }`}
        title={row.paid ? "Markeer als niet betaald" : "Markeer als betaald"}
      >
        {row.paid && <Check className="w-3 h-3 text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#5B6570] truncate">{entity?.name || "?"}</span>
          {showDate && <span className="text-xs text-[#B3462C] font-medium shrink-0">{formatDateLabel(row.displayDate)}</span>}
          {row.item.recurrence !== "once" && <RotateCcw className="w-3 h-3 text-[#C7CCC9] shrink-0" />}
          {row.item.viaPaypal && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#003087] bg-[#e6ecff] rounded px-1.5 py-0.5 shrink-0">PayPal</span>
          )}
          {row.item.source === "Bank-import" && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#0B6E5C] bg-[#E4F0EC] rounded px-1.5 py-0.5 shrink-0">Bank</span>
          )}
          {row.item.source === "Billtobox" && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#4C4E8A] bg-[#EEEEF6] rounded px-1.5 py-0.5 shrink-0">Billtobox</span>
          )}
          {priorityInfo && priorityInfo.value !== "Laag" && (
            <span
              className="text-[9.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0"
              style={{ color: priorityInfo.color, background: `${priorityInfo.color}1A` }}
              title={row.item.priority ? "Eigen prioriteit op deze post" : "Overgenomen van debiteur/crediteur"}
            >
              {priorityInfo.label}
            </span>
          )}
        </div>
        <p className={`text-sm truncate ${row.paid ? "line-through text-[#93999F]" : "text-[#12181F]"}`}>
          {row.item.description}
          {counterparty && (
            <>
              {" — "}
              <button
                onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(counterparty.id); }}
                className="text-[#5B6570] font-normal underline decoration-dotted hover:text-[#12181F]"
              >
                {counterparty.name}
              </button>
            </>
          )}
        </p>
        <p className="text-[11px] text-[#93999F] truncate">
          Verval: {row.date}
          {row.item.payDate && row.item.payDate !== row.item.dueDate && <> · Betaal: {row.item.payDate}</>}
          {row.item.invoiceDate && <> · Fact.: {row.item.invoiceDate}</>}
        </p>
        {(row.item.accountNumber || row.item.note) && (
          <p className="text-[11px] text-[#93999F] truncate">
            {row.item.accountNumber && <span className="font-num">{row.item.accountNumber}</span>}
            {row.item.accountNumber && row.item.note && " · "}
            {row.item.note}
          </p>
        )}
        {paymentIds.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {paymentIds.map((pid) => {
              const linkedPayment = (payments || []).find((p) => p.id === pid);
              return (
                <div key={pid} className="flex items-center gap-1.5 text-[11px]">
                  <Link2 className="w-3 h-3 text-[#1E8E5A] shrink-0" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenDetail?.("payment", pid); }}
                    className="text-[#1E8E5A] truncate underline decoration-dotted text-left"
                  >
                    {linkedPayment
                      ? `${linkedPayment.description} · ${linkedPayment.date} · ${eur(linkedPayment.amount)}`
                      : "(betaling niet gevonden)"}
                  </button>
                  {linkedPayment && onUnlinkPayment && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onUnlinkPayment(linkedPayment, row.itemId); }}
                      className="text-[#B3462C] underline decoration-dotted shrink-0"
                    >
                      ontkoppel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className={`font-num text-[15px] font-medium ${isIn ? "text-[#1E8E5A]" : "text-[#B3462C]"}`}>
          {isIn ? "+" : "−"}{eur(row.item.amount)}
        </p>
      </div>
      </div>

      <div className="flex items-center justify-end gap-0.5 mt-1">
        {onOpenDetail && (
          <button onClick={() => onOpenDetail("item", row.itemId)} className="p-1 text-[#C7CCC9] hover:text-[#12181F]" title="Alle details bekijken">
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
        {paymentIds.length === 0 && onLinkPayment && (
          <button
            onClick={() => { setLinkPickerOpen((s) => !s); setChosenPaymentId(""); }}
            className="p-1 text-[#C7CCC9] hover:text-[#12181F]"
            title="Koppel aan een betaling"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => onEdit(row.item)} className="p-1 text-[#C7CCC9] hover:text-[#12181F]">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDuplicate(row.item)} className="p-1 text-[#C7CCC9] hover:text-[#12181F]" title="Dupliceren">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(row.itemId)}
          className="p-1 text-[#C7CCC9] hover:text-[#B3462C]"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      </div>
    </div>
    {linkPickerOpen && (
      <div className="bg-white border border-[#E3E7E4] rounded-lg px-3 py-2.5 -mt-1 space-y-2">
        {linkCandidates.length === 0 ? (
          <p className="text-[11px] text-[#93999F]">Geen ongekoppelde betalingen gevonden voor deze boekhouding.</p>
        ) : (
          <>
            <select
              value={chosenPaymentId}
              onChange={(e) => setChosenPaymentId(e.target.value)}
              className="w-full border border-[#E3E7E4] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#12181F]"
            >
              <option value="" disabled>Kies de juiste betaling…</option>
              {linkCandidates.map((p) => (
                <option key={p.id} value={p.id}>{p.description} — {eur(p.amount)} ({p.date})</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const payment = linkCandidates.find((p) => p.id === chosenPaymentId);
                  if (!payment) return;
                  setLinking(true);
                  await onLinkPayment(payment, row.item);
                  setLinking(false);
                  setLinkPickerOpen(false);
                }}
                disabled={!chosenPaymentId || linking}
                className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {linking ? "Bezig…" : "Bevestig koppeling"}
              </button>
              <button onClick={() => setLinkPickerOpen(false)} className="px-3 rounded-lg border border-slate-200 text-xs">
                Annuleer
              </button>
            </div>
          </>
        )}
      </div>
    )}
    </>
  );
}

// Vervangt native <datalist>-suggesties (onbetrouwbaar in Safari op
// iPad/iOS, zeker binnen een modal) door een zelf getekende, zelf
// aangestuurde dropdown. Werkt overal identiek, ongeacht browser.
function CounterpartyAutocomplete({ value, onChange, counterparties, placeholder, className, inputClassName, onKeyDown }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, []);

  const query = (value || "").trim().toLowerCase();
  const suggestions = (query
    ? counterparties.filter((c) => c.name.toLowerCase().includes(query))
    : counterparties
  )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);

  return (
    <div ref={wrapRef} className={`relative ${className || ""}`}>
      <input
        value={value || ""}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={inputClassName || "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(c.name); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemForm({ form, setForm, entities, counterparties, onSubmit, onCancel, editing }) {
  return (
    <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{editing ? "Post bewerken" : "Nieuwe post"}</p>
        <button type="button" onClick={onCancel}><X className="w-4 h-4 text-slate-400" /></button>
      </div>

      <input
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Omschrijving (bv. Factuur elektriciteit)"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
        required
      />

      <CounterpartyAutocomplete
        value={form.counterparty}
        onChange={(v) => setForm({ ...form, counterparty: v })}
        counterparties={counterparties}
        placeholder="Debiteur / crediteur (optioneel, bv. Elektriciteitsleverancier X)"
        inputClassName="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
      />

      {(() => {
        const matchedCp = counterparties.find(
          (c) => c.name.trim().toLowerCase() === form.counterparty.trim().toLowerCase()
        );
        const inherited = matchedCp?.priority || "";
        return (
          <div>
            <label className="text-[11px] text-slate-400">Prioriteit</label>
            <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs mt-0.5">
              <button
                type="button"
                onClick={() => setForm({ ...form, priority: "" })}
                className={`flex-1 py-1.5 rounded-md ${!form.priority ? "bg-white shadow-sm text-slate-700 font-medium" : "text-slate-400"}`}
              >
                Standaard
              </button>
              {PRIORITY_LEVELS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setForm({ ...form, priority: p.value })}
                  className="flex-1 py-1.5 rounded-md font-medium"
                  style={form.priority === p.value ? { background: "white", color: p.color, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#94A3B8" }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              {form.priority
                ? "Overrulet de debiteur/crediteur. Heeft die nog geen eigen prioriteit, dan wordt deze waarde automatisch ingesteld als standaard voor de debiteur/crediteur."
                : inherited
                ? `Standaard neemt over van de debiteur/crediteur: ${inherited}.`
                : "Standaard — deze debiteur/crediteur heeft nog geen eigen prioriteit ingesteld."}
            </p>
          </div>
        );
      })()}

      <input
        value={form.accountNumber}
        onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
        placeholder="Rekeningnummer (optioneel, bv. BE00 0000 0000 0000)"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
      />

      <textarea
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder="Opmerking (optioneel)"
        rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400 resize-none"
      />

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={!!form.viaPaypal}
          onChange={(e) => setForm({ ...form, viaPaypal: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300"
        />
        Betaling via PayPal
      </label>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number" step="0.01" min="0"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          placeholder="Bedrag (€)"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
          required
        />
        <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
          <button type="button" onClick={() => setForm({ ...form, direction: "uit" })}
            className={`flex-1 py-2 flex items-center justify-center gap-1 ${form.direction === "uit" ? "bg-rose-50 text-rose-600" : "text-slate-400"}`}>
            <TrendingDown className="w-3.5 h-3.5" /> Uitgave
          </button>
          <button type="button" onClick={() => setForm({ ...form, direction: "in" })}
            className={`flex-1 py-2 flex items-center justify-center gap-1 ${form.direction === "in" ? "bg-emerald-50 text-emerald-600" : "text-slate-400"}`}>
            <TrendingUp className="w-3.5 h-3.5" /> Inkomst
          </button>
        </div>
      </div>

      <select
        value={form.entityId}
        onChange={(e) => setForm({ ...form, entityId: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
        required
      >
        <option value="" disabled>Kies boekhouding…</option>
        {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-slate-400">Factuurdatum (optioneel)</label>
          <input
            type="date"
            value={form.invoiceDate}
            onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-400">Vervaldatum</label>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => {
              const newDue = e.target.value;
              // Betaaldatum volgt automatisch mee zolang ze nog niet apart is aangepast.
              setForm((f) => ({ ...f, dueDate: newDue, payDate: f.payDate === f.dueDate ? newDue : f.payDate }));
            }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
            required
          />
        </div>
      </div>

      <div>
        <label className="text-[11px] text-slate-400">Betaaldatum</label>
        <input
          type="date"
          value={form.payDate}
          onChange={(e) => setForm({ ...form, payDate: e.target.value })}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <p className="text-[10px] text-slate-400 mt-0.5">Standaard gelijk aan de vervaldatum. Bepaalt het verwachte lopend saldo in Rapport/Grafiek — de vervaldatum blijft leidend voor Planning en herinneringen.</p>
      </div>

      <div>
        <label className="text-[11px] text-slate-400">Herhaling</label>
        <select
          value={form.recurrence}
          onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
        >
          {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {form.recurrence !== "once" && (
        <div>
          <label className="text-[11px] text-slate-400">Einddatum (optioneel)</label>
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </div>
      )}

      <button type="submit" className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium mt-1">
        {editing ? "Opslaan" : "Toevoegen"}
      </button>
    </form>
  );
}

function ReportView({ reportTotals, grandTotal, showGrand, entities, runningBalances, counterpartyById, paymentHistory, entityById, onCounterpartyClick }) {
  const [openLedgers, setOpenLedgers] = useState({});
  const [showCombinedLedger, setShowCombinedLedger] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);

  function toggleLedger(id) {
    setOpenLedgers((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const balanceByEntityId = useMemo(() => {
    const m = {};
    (runningBalances?.perEntity || []).forEach((b) => (m[b.entity.id] = b));
    return m;
  }, [runningBalances]);

  return (
    <div className="mt-4 space-y-4">
      {showGrand && entities.length > 1 && (
        <div className="bg-slate-900 text-white rounded-xl p-3.5">
          <p className="text-xs text-slate-300 mb-2">Gezamenlijk totaal</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-[11px] text-slate-400">Te ontvangen</p>
              <p className="text-emerald-400 font-medium">{eur(grandTotal.inSum)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Te betalen</p>
              <p className="text-rose-400 font-medium">{eur(grandTotal.uitSum)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Netto</p>
              <p className="font-medium">{eur(grandTotal.net)}</p>
            </div>
          </div>

          {runningBalances && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-[11px] text-slate-400">Huidig saldo (vandaag, alle rekeningen)</p>
                  <p className="font-medium">{eur(runningBalances.combinedOpening)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-400">Verwacht totaalsaldo na deze periode</p>
                  <p className="font-medium">{eur(runningBalances.combinedEnding)}</p>
                </div>
              </div>
              {runningBalances.combinedLedger.length > 0 && (
                <button
                  onClick={() => setShowCombinedLedger((s) => !s)}
                  className="mt-2 text-xs text-slate-400 flex items-center gap-1"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCombinedLedger ? "rotate-180" : ""}`} />
                  Lopend saldo — detail ({runningBalances.combinedLedger.length})
                </button>
              )}
              {showCombinedLedger && (
                <div className="mt-2 space-y-1">
                  {runningBalances.combinedLedger.map((row) => {
                    const cp = row.item.counterpartyId ? counterpartyById[row.item.counterpartyId] : null;
                    const extraDates = [
                      row.item.dueDate !== row.date ? `verval ${row.item.dueDate}` : null,
                      row.item.invoiceDate ? `fact. ${row.item.invoiceDate}` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <div key={`${row.itemId}-${row.date}`} className="flex items-center justify-between text-xs py-1 border-b border-slate-800 last:border-0" title={extraDates || undefined}>
                        <span className="text-slate-500 shrink-0 w-16">{row.date.slice(5)}</span>
                        <span className="flex-1 min-w-0 truncate text-slate-300 px-2">
                          {row.item.description}
                          {cp && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                              className="text-slate-500 underline decoration-dotted hover:text-slate-300"
                            >
                              {" — "}{cp.name}
                            </button>
                          )}
                          {extraDates && <span className="text-slate-500"> ({extraDates})</span>}
                        </span>
                        <span className={`shrink-0 w-20 text-right ${row.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {row.delta >= 0 ? "+" : ""}{eur(row.delta)}
                        </span>
                        <span className="shrink-0 w-24 text-right font-medium">{eur(row.balance)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">Openstaande (onbetaalde) posten vanaf vandaag, per boekhouding</p>
      <div className="space-y-2">
        {reportTotals.map(({ entity, inSum, uitSum, net }) => {
          const c = entityColor(entity);
          const rb = balanceByEntityId[entity.id];
          const ledgerOpen = openLedgers[entity.id];
          return (
            <div key={entity.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />
                <span className="text-sm font-medium text-slate-800">{entity.name}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-slate-400">Te ontvangen</p>
                  <p className="text-emerald-600 font-medium">{eur(inSum)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400">Te betalen</p>
                  <p className="text-rose-600 font-medium">{eur(uitSum)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400">Netto</p>
                  <p className={`font-medium ${net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(net)}</p>
                </div>
              </div>

              {rb && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <p className="text-[11px] text-slate-400">
                        {rb.entity.bankBalance !== null && rb.entity.bankBalance !== undefined
                          ? `Banksaldo (${rb.openingDate})`
                          : "Startsaldo (vandaag)"}
                      </p>
                      <p className="font-medium text-slate-700">{eur(rb.opening)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-400">Verwacht saldo na deze periode</p>
                      <p className={`font-medium ${rb.ending >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(rb.ending)}</p>
                    </div>
                  </div>
                  {rb.ledger.length > 0 && (
                    <button
                      onClick={() => toggleLedger(entity.id)}
                      className="mt-2 text-xs text-slate-400 flex items-center gap-1"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${ledgerOpen ? "rotate-180" : ""}`} />
                      Lopend saldo — detail ({rb.ledger.length})
                    </button>
                  )}
                  {ledgerOpen && (
                    <div className="mt-2 space-y-1">
                      {rb.ledger.map((row) => {
                        const cp = row.item.counterpartyId ? counterpartyById[row.item.counterpartyId] : null;
                        const extraDates = [
                          row.item.dueDate !== row.date ? `verval ${row.item.dueDate}` : null,
                          row.item.invoiceDate ? `fact. ${row.item.invoiceDate}` : null,
                        ].filter(Boolean).join(" · ");
                        return (
                          <div key={`${row.itemId}-${row.date}`} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0" title={extraDates || undefined}>
                            <span className="text-slate-400 shrink-0 w-16">{row.date.slice(5)}</span>
                            <span className="flex-1 min-w-0 truncate text-slate-600 px-2">
                              {row.item.description}
                              {cp && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                                  className="text-slate-400 underline decoration-dotted hover:text-slate-600"
                                >
                                  {" — "}{cp.name}
                                </button>
                              )}
                              {extraDates && <span className="text-slate-400"> ({extraDates})</span>}
                            </span>
                            <span className={`shrink-0 w-20 text-right ${row.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {row.delta >= 0 ? "+" : ""}{eur(row.delta)}
                            </span>
                            <span className="shrink-0 w-24 text-right font-medium text-slate-700">{eur(row.balance)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paymentHistory && paymentHistory.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <button
            onClick={() => setShowPaymentHistory((s) => !s)}
            className="w-full flex items-center justify-between text-sm font-medium text-slate-800"
          >
            <span>Alle betalingen ({paymentHistory.length})</span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showPaymentHistory ? "rotate-180" : ""}`} />
          </button>
          {showPaymentHistory && (
            <div className="mt-3 space-y-1 max-h-96 overflow-y-auto">
              {paymentHistory.map((row, idx) => {
                const entity = entityById?.[row.item.entityId];
                const cp = row.item.counterpartyId ? counterpartyById?.[row.item.counterpartyId] : null;
                const isIn = row.item.direction === "in";
                return (
                  <div key={`${row.item.id}-${row.date}-${idx}`} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-slate-400 shrink-0 w-20">{row.date}</span>
                    <span className="flex-1 min-w-0 truncate px-2">
                      <span className="text-slate-700">{row.item.description}</span>
                      {cp && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                          className="text-slate-400 underline decoration-dotted hover:text-slate-600"
                        >
                          {" — "}{cp.name}
                        </button>
                      )}
                      {entity && <span className="text-slate-400"> · {entity.name}</span>}
                    </span>
                    <span className={`shrink-0 font-medium ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                      {isIn ? "+" : "−"}{eur(row.item.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChartView({ runningBalances, activeEntity, entities }) {
  const source =
    activeEntity === "all"
      ? { ledger: runningBalances?.combinedLedger || [], opening: runningBalances?.combinedOpening || 0, label: "Alle boekhoudingen", isBank: false, openingDate: todayISO() }
      : (() => {
          const found = (runningBalances?.perEntity || []).find((b) => b.entity.id === activeEntity);
          const isBank = found ? found.entity.bankBalance !== null && found.entity.bankBalance !== undefined : false;
          return found
            ? { ledger: found.ledger, opening: found.opening, label: found.entity.name, isBank, openingDate: found.openingDate }
            : { ledger: [], opening: 0, label: entities.find((e) => e.id === activeEntity)?.name || "", isBank: false, openingDate: todayISO() };
        })();

  const data = useMemo(() => {
    const byDate = {};
    source.ledger.forEach((r) => { byDate[r.date] = r.balance; });
    const dates = Object.keys(byDate).sort();
    const points = dates.map((d) => ({ date: d, saldo: byDate[d] }));
    if (points.length === 0 || points[0].date > source.openingDate) {
      points.unshift({ date: source.openingDate, saldo: source.opening });
    }
    return points;
  }, [source]);

  if (data.length === 0) {
    return <p className="mt-8 text-sm text-slate-400 text-center py-10">Niets gepland om te tonen.</p>;
  }

  const minSaldo = Math.min(0, ...data.map((d) => d.saldo));
  const maxSaldo = Math.max(0, ...data.map((d) => d.saldo));
  const padding = Math.max(50, (maxSaldo - minSaldo) * 0.1);

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-slate-400">Verwacht lopend saldo — {source.label}</p>
      <div className="bg-white border border-slate-200 rounded-xl p-3.5" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              tickFormatter={(d) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              domain={[minSaldo - padding, maxSaldo + padding]}
              tickFormatter={(v) => `€${Math.round(v / 1000)}k`}
              width={44}
            />
            <Tooltip
              formatter={(v) => [eur(v), "Saldo"]}
              labelFormatter={(d) => d}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8F0" }}
            />
            <ReferenceLine y={0} stroke="#F43F5E" strokeDasharray="4 4" />
            <Line
              type="stepAfter"
              dataKey="saldo"
              stroke="#0F172A"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label={source.isBank ? "Huidig banksaldo" : "Huidig saldo"} value={source.opening} tone="pos" />
        <SummaryCard label="Verwacht eindsaldo" value={data[data.length - 1]?.saldo ?? source.opening} tone={data[data.length - 1]?.saldo >= 0 ? "pos" : "neg"} />
      </div>
    </div>
  );
}

function KoppelenView({
  items, payments, entities, entityById, counterpartyById, counterparties, filteredEntityIds, activeEntity, categories, projects,
  onLink, onUnlink, onToggleNoDocNeeded, onAddManualPayment, onCreateDocFromPayment, onResolveCounterparty, onDeletePayment, onBackfill, onOpenDetail, onCounterpartyClick,
}) {
  // Koppelen kan vanuit beide kanten starten: klik eerst een betaling (dan
  // markeer je daarna het passende document), of omgekeerd — klik eerst een
  // document, en markeer daarna de passende betaling. `selection` onthoudt
  // welke kant als eerste is aangeklikt.
  const [selection, setSelection] = useState(null); // { type: "payment" | "doc", id }
  const [showLinked, setShowLinked] = useState(false);
  const [showUnlinkedPayments, setShowUnlinkedPayments] = useState(true);
  const [showUnlinkedDocs, setShowUnlinkedDocs] = useState(true);
  const [showNewPayment, setShowNewPayment] = useState(false);
  const emptyNewPayment = {
    description: "", date: todayISO(), amount: "", direction: "uit",
    entityId: activeEntity !== "all" ? activeEntity : "", source: "Cash-handmatig",
    categoryId: "", projectId: "", counterparty: "",
  };
  const [newPayment, setNewPayment] = useState(emptyNewPayment);
  const [adding, setAdding] = useState(false);
  const [creatingDocForId, setCreatingDocForId] = useState(null);
  const [docDraft, setDocDraft] = useState({ description: "", counterpartyName: "" });
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  // Volgorde van "Ongekoppelde documenten" — bewust apart instelbaar, want bij
  // het koppelen zoek je soms het oudste (langst openstaande) document eerst,
  // en soms net het duurste of een specifieke naam.
  const [docSortField, setDocSortField] = useState("dueDate"); // dueDate | amount | description
  const [docSortDir, setDocSortDir] = useState("asc"); // asc | desc
  const [paySortField, setPaySortField] = useState("date"); // date | amount | description
  const [paySortDir, setPaySortDir] = useState("desc"); // asc | desc

  const unlinkedPayments = payments
    .filter((p) => filteredEntityIds.includes(p.entityId) && (p.documentIds || []).length === 0 && !p.noDocumentNeeded)
    .sort((a, b) => {
      let cmp;
      if (paySortField === "amount") cmp = a.amount - b.amount;
      else if (paySortField === "description") cmp = a.description.localeCompare(b.description);
      else cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return paySortDir === "asc" ? cmp : -cmp;
    });

  const unlinkedDocs = items
    .filter((it) =>
      filteredEntityIds.includes(it.entityId) &&
      (it.paymentIds || []).length === 0
    )
    .sort((a, b) => {
      let cmp;
      if (docSortField === "amount") cmp = a.amount - b.amount;
      else if (docSortField === "description") cmp = a.description.localeCompare(b.description);
      else cmp = a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      return docSortDir === "asc" ? cmp : -cmp;
    });

  const linkedPayments = payments
    .filter((p) => filteredEntityIds.includes(p.entityId) && (p.documentIds || []).length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const selectedPayment = selection?.type === "payment" ? unlinkedPayments.find((p) => p.id === selection.id) || null : null;
  const selectedDoc = selection?.type === "doc" ? unlinkedDocs.find((d) => d.id === selection.id) || null : null;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-slate-400">
        Koppel binnengekomen betalingen aan de bijhorende documenten. Selecteer eerst een betaling, klik dan het passende document aan.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Oudere bank-posten (van vóór dit scherm) missen nog een echte Betaling-koppeling.</p>
          <button
            onClick={async () => {
              setBackfilling(true);
              setBackfillResult(null);
              const result = await onBackfill();
              setBackfillResult(result);
              setBackfilling(false);
            }}
            disabled={backfilling}
            className="shrink-0 text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
          >
            {backfilling ? "Bezig…" : "Aanvullen"}
          </button>
        </div>
        {backfillResult && (
          <p className="text-[11px] text-emerald-700 mt-1.5">
            {backfillResult.done} aangevuld{backfillResult.failed > 0 ? `, ${backfillResult.failed} mislukt` : ""} (van {backfillResult.total}).
          </p>
        )}
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start space-y-4 lg:space-y-0">

      {/* Sectie 1: Betalingen */}
      <div>
        <button
          onClick={() => setShowUnlinkedPayments((s) => !s)}
          className="w-full flex items-center justify-between mb-1.5"
        >
          <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <ChevronDown className={`w-3.5 h-3.5 text-slate-300 transition-transform ${showUnlinkedPayments ? "rotate-180" : ""}`} />
            Ongekoppelde betalingen ({unlinkedPayments.length})
            {selectedDoc && <span className="text-slate-400 font-normal"> — klik om te koppelen aan "{selectedDoc.description}"</span>}
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); setShowNewPayment((s) => !s); }}
            className="text-xs text-slate-400 underline decoration-dotted"
          >
            + Nieuwe betaling
          </span>
        </button>

        <div className="flex items-center gap-1.5 mb-1.5">
          <select
            value={paySortField}
            onChange={(e) => setPaySortField(e.target.value)}
            className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600 outline-none focus:border-slate-400"
          >
            <option value="date">Sorteer op datum</option>
            <option value="amount">Sorteer op bedrag</option>
            <option value="description">Sorteer op omschrijving</option>
          </select>
          <button
            onClick={() => setPaySortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center gap-1 text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600"
            title={paySortDir === "asc" ? "Oplopend — klik voor aflopend" : "Aflopend — klik voor oplopend"}
          >
            <ArrowUpDown className="w-3 h-3" />
            {paySortDir === "asc" ? "Oplopend" : "Aflopend"}
          </button>
        </div>

        {showNewPayment && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 mb-2 space-y-2">
            <input
              value={newPayment.description}
              onChange={(e) => setNewPayment({ ...newPayment, description: e.target.value })}
              placeholder="Omschrijving"
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
            />
            <CounterpartyAutocomplete
              value={newPayment.counterparty}
              onChange={(v) => setNewPayment({ ...newPayment, counterparty: v })}
              counterparties={counterparties || []}
              placeholder="Debiteur / crediteur (optioneel)"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={newPayment.date}
                onChange={(e) => setNewPayment({ ...newPayment, date: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              />
              <input
                type="number"
                step="0.01"
                value={newPayment.amount}
                onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                placeholder="Bedrag"
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newPayment.entityId}
                onChange={(e) => setNewPayment({ ...newPayment, entityId: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              >
                <option value="" disabled>Boekhouding…</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
              <select
                value={newPayment.source}
                onChange={(e) => setNewPayment({ ...newPayment, source: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              >
                <option value="Cash-handmatig">Cash</option>
                <option value="Andere-bank-handmatig">Andere bank</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newPayment.categoryId}
                onChange={(e) => setNewPayment({ ...newPayment, categoryId: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              >
                <option value="">Categorie (optioneel)…</option>
                {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                value={newPayment.projectId}
                onChange={(e) => setNewPayment({ ...newPayment, projectId: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              >
                <option value="">Project (optioneel)…</option>
                {(projects || [])
                  .filter((p) => !newPayment.entityId || p.entityId === newPayment.entityId)
                  .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setNewPayment({ ...newPayment, direction: "uit" })}
                className={`flex-1 py-1.5 rounded-md ${newPayment.direction === "uit" ? "bg-white shadow-sm text-rose-600" : "text-slate-400"}`}
              >
                Uitgave
              </button>
              <button
                onClick={() => setNewPayment({ ...newPayment, direction: "in" })}
                className={`flex-1 py-1.5 rounded-md ${newPayment.direction === "in" ? "bg-white shadow-sm text-emerald-600" : "text-slate-400"}`}
              >
                Inkomst
              </button>
            </div>
            <button
              onClick={async () => {
                if (!newPayment.entityId || !newPayment.amount) return;
                setAdding(true);
                const counterpartyId = newPayment.counterparty.trim()
                  ? await onResolveCounterparty(newPayment.counterparty.trim())
                  : null;
                await onAddManualPayment({ ...newPayment, counterpartyId });
                setAdding(false);
                setShowNewPayment(false);
                setNewPayment({ ...emptyNewPayment, entityId: activeEntity !== "all" ? activeEntity : "" });
              }}
              disabled={!newPayment.entityId || !newPayment.amount || adding}
              className="w-full bg-slate-900 text-white rounded-lg py-2 text-xs font-medium disabled:opacity-40"
            >
              {adding ? "Bezig…" : "Betaling toevoegen"}
            </button>
          </div>
        )}

        {showUnlinkedPayments && (unlinkedPayments.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4 bg-white border border-slate-200 rounded-xl">Niets openstaand.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-50">
            {unlinkedPayments.map((p) => {
              const entity = entityById[p.entityId];
              const cp = p.counterpartyId ? counterpartyById[p.counterpartyId] : null;
              const selected = selection?.type === "payment" && selection.id === p.id;
              const isCreatingDocRow = creatingDocForId === p.id;
              return (
                <React.Fragment key={p.id}>
                <div
                  onClick={async () => {
                    if (selectedDoc) {
                      await onLink(p, selectedDoc);
                      setSelection(null);
                      return;
                    }
                    setSelection(selected ? null : { type: "payment", id: p.id });
                  }}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer ${selected ? "bg-slate-900/5" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 truncate">{p.description}</p>
                    <p className="text-[11px] text-slate-400">{entity?.name} · {p.date} · {p.source}</p>
                    {cp && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                        className="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
                      >
                        {cp.name}
                      </button>
                    )}
                  </div>
                  <span className={`text-sm font-medium shrink-0 ${p.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                    {p.direction === "in" ? "+" : "−"}{eur(p.amount)}
                  </span>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenDetail?.("payment", p.id); }}
                      className="text-[10px] text-slate-500 underline decoration-dotted"
                    >
                      details
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCreatingDocForId(isCreatingDocRow ? null : p.id);
                        setDocDraft({ description: p.description, counterpartyName: "" });
                      }}
                      className="text-[10px] text-slate-500 underline decoration-dotted"
                    >
                      maak document
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleNoDocNeeded(p); }}
                      className="text-[10px] text-slate-400 underline decoration-dotted"
                    >
                      geen document
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeletePayment(p); }}
                      className="text-[10px] text-rose-400 underline decoration-dotted"
                    >
                      verwijder
                    </button>
                  </div>
                </div>
                {isCreatingDocRow && (
                  <div className="px-3.5 pb-3.5 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={docDraft.description}
                      onChange={(e) => setDocDraft({ ...docDraft, description: e.target.value })}
                      placeholder="Omschrijving document"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                    />
                    <input
                      value={docDraft.counterpartyName}
                      onChange={(e) => setDocDraft({ ...docDraft, counterpartyName: e.target.value })}
                      placeholder="Crediteur/debiteur (optioneel — bestaande naam of nieuw)"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setCreatingDoc(true);
                          const counterpartyId = docDraft.counterpartyName.trim()
                            ? await onResolveCounterparty(docDraft.counterpartyName.trim())
                            : null;
                          await onCreateDocFromPayment(p, { description: docDraft.description, counterpartyId });
                          setCreatingDoc(false);
                          setCreatingDocForId(null);
                        }}
                        className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium"
                      >
                        Bevestig document
                      </button>
                      <button onClick={() => setCreatingDocForId(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                        Annuleer
                      </button>
                    </div>
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>

      {/* Sectie 2: Documenten */}
      <div>
        <button
          onClick={() => setShowUnlinkedDocs((s) => !s)}
          className="w-full flex items-center gap-1 mb-1.5 text-left"
        >
          <ChevronDown className={`w-3.5 h-3.5 text-slate-300 transition-transform ${showUnlinkedDocs ? "rotate-180" : ""}`} />
          <p className="text-xs font-medium text-slate-500">
            Ongekoppelde documenten ({unlinkedDocs.length})
            {selectedPayment && <span className="text-slate-400 font-normal"> — klik om te koppelen aan "{selectedPayment.description}"</span>}
          </p>
        </button>

        <div className="flex items-center gap-1.5 mb-1.5">
          <select
            value={docSortField}
            onChange={(e) => setDocSortField(e.target.value)}
            className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600 outline-none focus:border-slate-400"
          >
            <option value="dueDate">Sorteer op vervaldatum</option>
            <option value="amount">Sorteer op bedrag</option>
            <option value="description">Sorteer op omschrijving</option>
          </select>
          <button
            onClick={() => setDocSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center gap-1 text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600"
            title={docSortDir === "asc" ? "Oplopend — klik voor aflopend" : "Aflopend — klik voor oplopend"}
          >
            <ArrowUpDown className="w-3 h-3" />
            {docSortDir === "asc" ? "Oplopend" : "Aflopend"}
          </button>
        </div>

        {showUnlinkedDocs && (unlinkedDocs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4 bg-white border border-slate-200 rounded-xl">Niets openstaand.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-50">
            {unlinkedDocs.map((doc) => {
              const entity = entityById[doc.entityId];
              const cp = doc.counterpartyId ? counterpartyById[doc.counterpartyId] : null;
              const docSelected = selection?.type === "doc" && selection.id === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={async () => {
                    if (selectedPayment) {
                      await onLink(selectedPayment, doc);
                      setSelection(null);
                      return;
                    }
                    setSelection(docSelected ? null : { type: "doc", id: doc.id });
                  }}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50 ${docSelected ? "bg-slate-900/5" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 truncate">{doc.description}</p>
                    <p className="text-[11px] text-slate-400">{entity?.name} · Verval: {doc.dueDate}</p>
                    {cp && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                        className="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
                      >
                        {cp.name}
                      </button>
                    )}
                  </div>
                  <span className={`text-sm font-medium shrink-0 ${doc.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                    {doc.direction === "in" ? "+" : "−"}{eur(doc.amount)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenDetail?.("item", doc.id); }}
                    className="p-1 text-slate-300 hover:text-slate-600 shrink-0"
                    title="Alle details bekijken"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      </div>

      {/* Sectie 3: Gekoppelde betalingen — corrigeer een foute koppeling */}
      <div>
        <button
          onClick={() => setShowLinked((s) => !s)}
          className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3.5 py-3"
        >
          <p className="text-xs font-medium text-slate-500">Gekoppelde betalingen ({linkedPayments.length})</p>
          <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${showLinked ? "rotate-180" : ""}`} />
        </button>
        {showLinked && (
          <div className="bg-white border border-t-0 border-slate-200 rounded-b-xl divide-y divide-slate-50 -mt-px">
            {linkedPayments.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Nog geen koppelingen.</p>
            ) : (
              linkedPayments.map((p) => {
                const entity = entityById[p.entityId];
                const cp = p.counterpartyId ? counterpartyById[p.counterpartyId] : null;
                return (
                  <div key={p.id} className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => onOpenDetail?.("payment", p.id)}
                          className="text-sm text-slate-800 truncate underline decoration-dotted text-left"
                        >
                          {p.description}
                        </button>
                        {cp && (
                          <button
                            onClick={() => onCounterpartyClick?.(cp.id)}
                            className="text-sm text-slate-400 font-normal underline decoration-dotted hover:text-slate-600"
                          >
                            {" — "}{cp.name}
                          </button>
                        )}
                        <p className="text-[11px] text-slate-400">{entity?.name} · {p.date}</p>
                      </div>
                      <span className={`text-sm font-medium shrink-0 ${p.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                        {p.direction === "in" ? "+" : "−"}{eur(p.amount)}
                      </span>
                      <button
                        onClick={() => onDeletePayment(p)}
                        className="text-[10px] text-rose-400 underline decoration-dotted shrink-0"
                      >
                        verwijder
                      </button>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {(p.documentIds || []).map((docId) => {
                        const doc = items.find((i) => i.id === docId);
                        return (
                          <div key={docId} className="flex items-center justify-between bg-slate-50 rounded-md px-2 py-1.5">
                            <button
                              onClick={() => onOpenDetail?.("item", docId)}
                              className="text-[11px] text-slate-600 truncate underline decoration-dotted text-left"
                            >
                              → {doc ? doc.description : "(document niet gevonden)"}
                            </button>
                            <button
                              onClick={() => onUnlink(p, docId)}
                              className="text-[10px] text-rose-500 underline decoration-dotted shrink-0 ml-2"
                            >
                              ontkoppel
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BoekhoudingenView({
  entities, newEntityName, setNewEntityName, onAddEntity, onMoveEntity,
  onUpdateOpeningBalanceLocal, onCommitOpeningBalance,
  onUpdateEntityFieldLocal, onCommitEntityIban, onCommitEntityPocketsmith, onCommitEntityExactOnlineEmail,
  onRemoveEntity, lastUpdateByEntity, firstBankStatementByEntity,
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-medium text-slate-900 flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4" /> Nieuwe boekhouding
        </h3>
        <input
          value={newEntityName}
          onChange={(e) => setNewEntityName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAddEntity()}
          placeholder="Naam (bv. O&O, Dr. Luc Belmans BV)"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-slate-400"
        />
        <button onClick={onAddEntity} className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm font-medium">
          Toevoegen
        </button>
      </div>

      {entities.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-3">Bestaande boekhoudingen &amp; startsaldo</p>
          <div className="space-y-3">
            {entities.map((e, idx) => (
              <div key={e.id} className="border-b border-slate-50 last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between gap-2 text-sm py-1">
                  <div className="flex flex-col shrink-0 -my-1">
                    <button
                      onClick={() => onMoveEntity(e.id, -1)}
                      disabled={idx === 0}
                      className="text-slate-300 hover:text-slate-600 disabled:opacity-20 disabled:hover:text-slate-300 leading-none"
                      title="Naar boven"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => onMoveEntity(e.id, 1)}
                      disabled={idx === entities.length - 1}
                      className="text-slate-300 hover:text-slate-600 disabled:opacity-20 disabled:hover:text-slate-300 leading-none"
                      title="Naar onder"
                    >
                      ▼
                    </button>
                  </div>
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entityColor(e).dot }} />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={e.openingBalance ?? 0}
                    onChange={(ev) => onUpdateOpeningBalanceLocal(e.id, ev.target.value)}
                    onBlur={() => onCommitOpeningBalance(e.id)}
                    className="w-24 border border-slate-200 rounded-md px-2 py-1 text-xs text-right outline-none focus:border-slate-400"
                    title="Huidig saldo op deze rekening"
                  />
                  <button onClick={() => onRemoveEntity(e.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 pl-5 mt-1">
                  <input
                    value={e.iban || ""}
                    onChange={(ev) => onUpdateEntityFieldLocal(e.id, "iban", ev.target.value)}
                    onBlur={() => onCommitEntityIban(e.id)}
                    placeholder="IBAN (voor bank-import)"
                    className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-400"
                  />
                  <input
                    value={e.pocketsmithAccount || ""}
                    onChange={(ev) => onUpdateEntityFieldLocal(e.id, "pocketsmithAccount", ev.target.value)}
                    onBlur={() => onCommitEntityPocketsmith(e.id)}
                    placeholder="PocketSmith-rekeningnaam"
                    className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                  />
                </div>
                <div className="flex items-center gap-1.5 pl-5 mt-1">
                  <input
                    value={e.exactOnlineEmail || ""}
                    onChange={(ev) => onUpdateEntityFieldLocal(e.id, "exactOnlineEmail", ev.target.value)}
                    onBlur={() => onCommitEntityExactOnlineEmail(e.id)}
                    placeholder="E-mailadres boekhouding (bv. Exact Online)"
                    className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                  />
                </div>
                {(lastUpdateByEntity[e.id]?.bank || lastUpdateByEntity[e.id]?.billtobox) && (
                  <p className="text-[11px] text-slate-400 pl-5 mt-1.5">
                    {lastUpdateByEntity[e.id]?.bank && <>Laatste bank: {lastUpdateByEntity[e.id].bank}</>}
                    {lastUpdateByEntity[e.id]?.bank && lastUpdateByEntity[e.id]?.billtobox && " · "}
                    {lastUpdateByEntity[e.id]?.billtobox && <>Laatste Billtobox: {lastUpdateByEntity[e.id].billtobox}</>}
                  </p>
                )}
                {firstBankStatementByEntity[e.id] && (
                  <p className="text-[11px] text-slate-400 pl-5 mt-0.5">
                    Eerste bankafschrift: {firstBankStatementByEntity[e.id]}
                  </p>
                )}
                {(e.iban || e.pocketsmithAccount) && e.bankBalance !== null && (
                  <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1 pl-5 mt-1.5 inline-block">
                    Meest recent banksaldo: {eur(e.bankBalance)}{e.bankBalanceDate ? ` (${e.bankBalanceDate})` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Startsaldo = je actuele banksaldo vandaag. Wordt gebruikt voor het lopend saldo in het Rapport. IBAN en PocketSmith-rekening koppelen automatische bank-import aan de juiste boekhouding.
          </p>
        </div>
      )}
    </div>
  );
}

function ReconciliationView({ items, entityById, counterpartyById, filteredEntityIds, onRelink, onMarkRead, onCounterpartyClick }) {
  const [expandedId, setExpandedId] = useState(null);
  const [relinkingId, setRelinkingId] = useState(null);
  const [targetId, setTargetId] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const allAutoItems = items
    .filter((i) => (i.source === "Bank-import" || i.source === "Billtobox") && filteredEntityIds.includes(i.entityId))
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const autoItems = onlyUnread ? allAutoItems.filter((i) => !i.read) : allAutoItems;
  const unreadInScope = allAutoItems.filter((i) => !i.read).length;

  if (allAutoItems.length === 0) {
    return (
      <p className="mt-8 text-sm text-slate-400 text-center py-10">
        Nog geen automatisch geïmporteerde posten (Bank-import of Billtobox).
      </p>
    );
  }

  const totalIn = autoItems.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0);
  const totalUit = autoItems.filter((i) => i.direction === "uit").reduce((s, i) => s + i.amount, 0);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOnlyUnread((s) => !s)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition ${
            onlyUnread ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
          }`}
        >
          Enkel ongelezen{unreadInScope > 0 ? ` (${unreadInScope})` : ""}
        </button>
        {autoItems.length > 0 && (
          <button
            onClick={() => autoItems.forEach((i) => !i.read && onMarkRead(i.id, true))}
            className="text-xs text-slate-400 underline decoration-dotted"
          >
            Alles gelezen
          </button>
        )}
      </div>

      {autoItems.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Niets ongelezen.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard label="Aantal" value={autoItems.length} tone="pos" isCount />
            <SummaryCard label="Totaal in" value={totalIn} tone="pos" />
            <SummaryCard label="Totaal uit" value={totalUit} tone="neg" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-50">
            {autoItems.map((item) => {
              let snapshot = null;
              try {
                snapshot = item.bankSnapshot ? JSON.parse(item.bankSnapshot) : null;
              } catch (e) {}
              if (!snapshot) {
                snapshot = {
                  ref: item.bankRef || `manual-${item.id}`,
                  amount: item.amount,
                  direction: item.direction,
                  bookingDate: item.dueDate,
                  counterpartyName: item.description,
                  remittance: item.note || "",
                  wasCreated: null, // onbekend — geen echte snapshot om dit uit af te leiden
                };
              }
              const entity = entityById[item.entityId];
              const cp = item.counterpartyId ? counterpartyById[item.counterpartyId] : null;
              const expanded = expandedId === item.id;
              const relinking = relinkingId === item.id;
              const isIn = item.direction === "in";

              const candidates = items.filter(
                (i) => i.id !== item.id && i.entityId === item.entityId && i.direction === item.direction
              );

              return (
                <div key={item.id} className={!item.read ? "bg-amber-50/40" : ""}>
                  <button
                    onClick={() => { setExpandedId(expanded ? null : item.id); setRelinkingId(null); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
                  >
                    <span
                      onClick={(e) => { e.stopPropagation(); onMarkRead(item.id, !item.read); }}
                      className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ${
                        item.read ? "border-slate-300" : "bg-amber-400 border-amber-400"
                      }`}
                      title={item.read ? "Markeer als ongelezen" : "Markeer als gelezen"}
                    >
                      {item.read && <Check className="w-2.5 h-2.5 text-slate-400" />}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0 w-16">{item.dueDate}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800 truncate">
                        {item.description}
                        {cp && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(cp.id); }}
                            className="text-slate-400 font-normal underline decoration-dotted hover:text-slate-600"
                          >
                            {" — "}{cp.name}
                          </button>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {entity?.name} · {item.source === "Billtobox" ? "Billtobox" : "Bank"}
                        {item.payDate && item.payDate !== item.dueDate && <> · Betaal: {item.payDate}</>}
                        {item.invoiceDate && <> · Fact.: {item.invoiceDate}</>}
                      </p>
                    </div>
                    <span className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                      {isIn ? "+" : "−"}{eur(item.amount)}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-300 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>

                  {expanded && (
                    <div className="px-3.5 pb-3.5 space-y-2">
                      <div className="bg-slate-50 rounded-lg p-2.5 text-xs space-y-1">
                        <p>
                          <span className="text-slate-400">Status: </span>
                          {snapshot?.wasCreated === false ? (
                            <span className="text-emerald-700 font-medium">Gematcht met bestaande post</span>
                          ) : snapshot?.wasCreated === true ? (
                            <span className="text-indigo-700 font-medium">Nieuw aangemaakt</span>
                          ) : (
                            <span className="text-slate-400">Onbekend (van vóór deze functie)</span>
                          )}
                        </p>
                        <p className="text-slate-400">
                          {snapshot
                            ? <>Bank zei: <span className="text-slate-700">{snapshot.counterpartyName || snapshot.remittance || "—"}</span> · {snapshot.bookingDate} · {eur(snapshot.amount || 0)}</>
                            : "Geen ruwe brongegevens beschikbaar voor deze post."}
                        </p>
                        {snapshot?.remittance && snapshot.remittance !== snapshot.counterpartyName && (
                          <p className="text-slate-400 break-words">Mededeling: {snapshot.remittance}</p>
                        )}
                      </div>

                      {!relinking ? (
                        <button
                          onClick={() => { setRelinkingId(item.id); setTargetId(""); }}
                          className="text-xs text-slate-400 underline decoration-dotted"
                        >
                          Klopt niet — herkoppelen
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <select
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                          >
                            <option value="" disabled>Kies de juiste post…</option>
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>{c.description} — {eur(c.amount)} ({c.dueDate})</option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                if (!targetId || !snapshot) return;
                                await onRelink(item, targetId);
                                setRelinkingId(null);
                              }}
                              disabled={!targetId || !snapshot}
                              className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                            >
                              Bevestig herkoppeling
                            </button>
                            <button onClick={() => setRelinkingId(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                              Annuleer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CounterpartyView({ items, payments, counterparties, entities, entityById, filteredEntityIds, onTogglePaid, onEdit, onDelete, onDuplicate, editingId, form, setForm, onSubmit, onCancel, onApplyMappings, nameMappings, onAddMapping, onUpdateMappingLocal, onCommitMapping, onDeleteMapping, jumpToCounterpartyId, onJumpHandled, onRelink, onMerge, onLinkPayment, onUnlinkPayment, onOpenDetail, onUpdatePriority, onUpdateFieldLocal, onCommitField, onToggleNoDocDefault, onMergeCounterparties, onCleanupDuplicateGroup, unusedCounterparties, onDeleteUnusedCounterparties }) {
  const [openId, setOpenId] = useState(jumpToCounterpartyId || null);
  const cpPaymentsById = useMemo(() => {
    const map = {};
    for (const p of payments) map[p.id] = p;
    return map;
  }, [payments]);
  const [editDetailsFor, setEditDetailsFor] = useState(null);
  const [mergingFor, setMergingFor] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [relinkingId, setRelinkingId] = useState(null);
  const [relinkTargetId, setRelinkTargetId] = useState("");
  const [linkingItemId, setLinkingItemId] = useState(null);
  const [linkPaymentId, setLinkPaymentId] = useState("");
  const [linking, setLinking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [showMappings, setShowMappings] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [cleaningName, setCleaningName] = useState(null);
  const [cleanupResults, setCleanupResults] = useState({});
  const [showUnused, setShowUnused] = useState(false);
  const [deletingUnused, setDeletingUnused] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newCorrectName, setNewCorrectName] = useState("");
  const [newMatchType, setNewMatchType] = useState("Bevat");

  useEffect(() => {
    if (!jumpToCounterpartyId) return;
    setOpenId(jumpToCounterpartyId);
    const el = document.getElementById(`crediteur-${jumpToCounterpartyId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    onJumpHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToCounterpartyId]);

  const scoped = items.filter((it) => filteredEntityIds.includes(it.entityId));
  const paymentById = useMemo(() => {
    const m = {};
    (payments || []).forEach((p) => (m[p.id] = p));
    return m;
  }, [payments]);

  const groups = useMemo(() => {
    const byId = {};
    counterparties.forEach((c) => { byId[c.id] = { counterparty: c, items: [], payments: [] }; });
    const zonder = [];
    scoped.forEach((it) => {
      if (it.counterpartyId && byId[it.counterpartyId]) byId[it.counterpartyId].items.push(it);
      else zonder.push(it);
    });
    // Crediteuren die enkel via een Betaling gekend zijn (nog geen post) —
    // anders zouden ze nergens in dit scherm verschijnen, ook al kan je er
    // via Betalingen wél naartoe klikken.
    (payments || [])
      .filter((p) => filteredEntityIds.includes(p.entityId))
      .forEach((p) => {
        if (p.counterpartyId && byId[p.counterpartyId]) byId[p.counterpartyId].payments.push(p);
      });
    const list = Object.values(byId)
      .filter((g) => g.items.length > 0 || g.payments.length > 0)
      .sort((a, b) => a.counterparty.name.localeCompare(b.counterparty.name));
    return { list, zonder };
  }, [scoped, counterparties, payments, filteredEntityIds]);

  // "Rommel"-overzicht: crediteuren met exact dezelfde naam, ongeacht of ze
  // posten/betalingen hebben (dus ook de volledig wees geraakte duplicaten
  // die nergens anders in dit scherm zichtbaar zijn). Los van de
  // boekhouding-filter — dubbels zijn boekhouding-onafhankelijk.
  const duplicateGroups = useMemo(() => {
    const byName = {};
    counterparties.forEach((c) => {
      if (!byName[c.name]) byName[c.name] = [];
      byName[c.name].push(c);
    });
    return Object.entries(byName)
      .filter(([, recs]) => recs.length > 1)
      .map(([name, recs]) => ({ name, count: recs.length }))
      .sort((a, b) => b.count - a.count);
  }, [counterparties]);

  const mappingBar = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Alle posten per debiteur/crediteur, ongeacht betaalstatus</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setShowUnused((s) => !s)}
            className={`text-xs px-2.5 py-1.5 rounded-full border ${
              unusedCounterparties.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            Ongebruikt{unusedCounterparties.length > 0 ? ` (${unusedCounterparties.length})` : ""}
          </button>
          <button
            onClick={() => setShowDuplicates((s) => !s)}
            className={`text-xs px-2.5 py-1.5 rounded-full border ${
              duplicateGroups.length > 0 ? "border-rose-200 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            Dubbels{duplicateGroups.length > 0 ? ` (${duplicateGroups.length})` : ""}
          </button>
          <button
            onClick={() => setShowMappings((s) => !s)}
            className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600"
          >
            Naammapping beheren{nameMappings?.length ? ` (${nameMappings.length})` : ""}
          </button>
          <button
            onClick={async () => {
              setApplying(true);
              setApplyResult(null);
              const result = await onApplyMappings();
              setApplyResult(result);
              setApplying(false);
            }}
            disabled={applying}
            className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 disabled:opacity-40 flex items-center gap-1"
          >
            {applying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Toepassen
          </button>
        </div>
      </div>

      {showUnused && (
        <div className="bg-white border border-amber-200 rounded-xl p-3.5 space-y-2">
          {unusedCounterparties.length === 0 ? (
            <p className="text-xs text-slate-400">Geen ongebruikte crediteuren gevonden.</p>
          ) : (
            <>
              <p className="text-[11px] text-slate-400">
                Nergens aan een post of betaling gekoppeld — vaak losse rommel (enkele letters/cijfers, rauwe banktekst) die geen exacte naam-duplicaat is en dus niet bij "Dubbels" staat. Veilig om in bulk te verwijderen.
              </p>
              <div className="max-h-40 overflow-y-auto -mx-3.5 px-3.5 flex flex-wrap gap-1.5">
                {unusedCounterparties.slice(0, 200).map((c) => (
                  <span key={c.id} className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 truncate max-w-[220px]">
                    {c.name || "(leeg)"}
                  </span>
                ))}
                {unusedCounterparties.length > 200 && (
                  <span className="text-[11px] text-slate-400">en {unusedCounterparties.length - 200} meer…</span>
                )}
              </div>
              <button
                onClick={async () => {
                  if (deletingUnused) return;
                  setDeletingUnused(true);
                  await onDeleteUnusedCounterparties(unusedCounterparties.map((c) => c.id));
                  setDeletingUnused(false);
                  setShowUnused(false);
                }}
                disabled={deletingUnused}
                className="w-full bg-rose-600 text-white rounded-lg py-2 text-xs font-medium disabled:opacity-40"
              >
                {deletingUnused ? "Bezig…" : `Verwijder alle ${unusedCounterparties.length} ongebruikte crediteuren`}
              </button>
            </>
          )}
        </div>
      )}

      {showDuplicates && (
        <div className="bg-white border border-rose-200 rounded-xl p-3.5 space-y-2">
          {duplicateGroups.length === 0 ? (
            <p className="text-xs text-slate-400">Geen dubbele namen gevonden.</p>
          ) : (
            <>
              <p className="text-[11px] text-slate-400">
                Crediteuren met exact dezelfde naam — vaak wees geraakt door een oudere import-bug. "Opruimen" bewaart er één (bij voorkeur een die al gekoppeld is) en voegt de rest daarin samen.
              </p>
              <div className="divide-y divide-slate-50 -mx-3.5">
                {duplicateGroups.map((g) => (
                  <div key={g.name} className="flex items-center justify-between gap-2 px-3.5 py-2">
                    <span className="text-xs text-slate-700 truncate">{g.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400">{g.count}x</span>
                      {cleanupResults[g.name] ? (
                        <span className="text-[11px] text-emerald-600">{cleanupResults[g.name]} verwijderd</span>
                      ) : (
                        <button
                          onClick={async () => {
                            setCleaningName(g.name);
                            const result = await onCleanupDuplicateGroup(g.name);
                            setCleanupResults((prev) => ({ ...prev, [g.name]: result?.merged ?? 0 }));
                            setCleaningName(null);
                          }}
                          disabled={cleaningName === g.name}
                          className="text-[11px] px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                        >
                          {cleaningName === g.name ? "Bezig…" : "Opruimen"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showMappings && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
          {(nameMappings || []).map((m) => (
            <div key={m.id} className="flex items-center gap-1.5 flex-wrap">
              <input
                value={m.pattern}
                onChange={(e) => onUpdateMappingLocal(m.id, "pattern", e.target.value)}
                onBlur={() => onCommitMapping(m.id)}
                placeholder="Patroon"
                className="flex-1 min-w-[6rem] border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              />
              <select
                value={m.matchType || "Bevat"}
                onChange={(e) => { onUpdateMappingLocal(m.id, "matchType", e.target.value); onCommitMapping(m.id); }}
                className="shrink-0 border border-slate-200 rounded-md px-1.5 py-1.5 text-[11px] outline-none focus:border-slate-400"
              >
                <option value="Bevat">bevat</option>
                <option value="Begint met">begint met</option>
                <option value="Eindigt met">eindigt met</option>
                <option value="Exact">exact</option>
              </select>
              <span className="text-slate-300 text-xs shrink-0">→</span>
              <input
                value={m.correctName}
                onChange={(e) => onUpdateMappingLocal(m.id, "correctName", e.target.value)}
                onBlur={() => onCommitMapping(m.id)}
                placeholder="Correcte naam"
                className="flex-1 min-w-[6rem] border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
              />
              <button onClick={() => onDeleteMapping(m.id)} className="text-slate-300 hover:text-rose-500 shrink-0 p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-100">
            <input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="Nieuw patroon"
              className="flex-1 min-w-[6rem] border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
            />
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value)}
              className="shrink-0 border border-slate-200 rounded-md px-1.5 py-1.5 text-[11px] outline-none focus:border-slate-400"
            >
              <option value="Bevat">bevat</option>
              <option value="Begint met">begint met</option>
              <option value="Eindigt met">eindigt met</option>
              <option value="Exact">exact</option>
            </select>
            <span className="text-slate-300 text-xs shrink-0">→</span>
            <input
              value={newCorrectName}
              onChange={(e) => setNewCorrectName(e.target.value)}
              placeholder="Correcte naam"
              className="flex-1 min-w-[6rem] border border-slate-200 rounded-md px-2 py-1.5 text-xs outline-none focus:border-slate-400"
            />
            <button
              onClick={async () => {
                if (!newPattern.trim() || !newCorrectName.trim()) return;
                await onAddMapping(newPattern, newCorrectName, newMatchType);
                setNewPattern("");
                setNewCorrectName("");
                setNewMatchType("Bevat");
              }}
              disabled={!newPattern.trim() || !newCorrectName.trim()}
              className="shrink-0 bg-slate-900 text-white rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            "Bevat" herkent het patroon als losse tekst ergens in de naam. "Begint met"/"Eindigt met" kijken enkel aan het begin/einde. "Exact" vereist een volledige overeenkomst. Alles hoofdletterongevoelig.
            {" "}Gebruik <code className="bg-slate-100 px-1 rounded">*</code> in Patroon voor een variabel stuk dat genegeerd wordt, en <code className="bg-slate-100 px-1 rounded">{"{*}"}</code> voor het variabele stuk dat je wil behouden — zet dat laatste dan ook als <code className="bg-slate-100 px-1 rounded">*</code> in CorrecteNaam. Bv. patroon <code className="bg-slate-100 px-1 rounded">Paiement Debit Mastercard * - * - {"{*}"} - * - * - * Numéro de carte *</code> met correcte naam <code className="bg-slate-100 px-1 rounded">*</code> haalt enkel de handelaarsnaam eruit. De matchtype-keuze wordt genegeerd zodra Patroon een <code className="bg-slate-100 px-1 rounded">*</code> bevat.
            {" "}Klik daarna "Toepassen" om dit op bestaande crediteuren toe te passen.
          </p>
        </div>
      )}
    </div>
  );

  if (groups.list.length === 0) {
    return (
      <div className="mt-4 space-y-2">
        {mappingBar}
        {applyResult && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
            {applyResult.renamed} hernoemd, {applyResult.merged} samengevoegd.
          </p>
        )}
        <p className="mt-8 text-sm text-slate-400 text-center py-10">Nog geen posten met een debiteur/crediteur gekoppeld.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {mappingBar}
      {applyResult && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
          {applyResult.renamed} hernoemd, {applyResult.merged} samengevoegd.
        </p>
      )}
      {groups.list.map(({ counterparty, items: cpItems, payments: cpPayments }) => {
        const totalIn = cpItems.length > 0
          ? cpItems.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)
          : cpPayments.filter((p) => p.direction === "in").reduce((s, p) => s + p.amount, 0);
        const totalUit = cpItems.length > 0
          ? cpItems.filter((i) => i.direction === "uit").reduce((s, i) => s + i.amount, 0)
          : cpPayments.filter((p) => p.direction === "uit").reduce((s, p) => s + p.amount, 0);
        const open = openId === counterparty.id;
        return (
          <div key={counterparty.id} id={`crediteur-${counterparty.id}`} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenId(open ? null : counterparty.id)}
              className="w-full flex items-center justify-between px-3.5 py-3 text-left"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">{counterparty.name}</p>
                <p className="text-[11px] text-slate-400">
                  {cpItems.length > 0 && `${cpItems.length} post${cpItems.length !== 1 ? "en" : ""}`}
                  {cpItems.length > 0 && cpPayments.length > 0 && " · "}
                  {cpPayments.length > 0 && `${cpPayments.length} betaling${cpPayments.length !== 1 ? "en" : ""}`}
                  {cpItems.length === 0 && cpPayments.length > 0 && ", geen post"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-xs">
                  {totalIn > 0 && <p className="text-emerald-600">+{eur(totalIn)}</p>}
                  {totalUit > 0 && <p className="text-rose-600">−{eur(totalUit)}</p>}
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
              </div>
            </button>
            {open && (
              <div className="border-t border-slate-100">
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-slate-50/60 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-slate-400 shrink-0">Standaardprioriteit voor deze debiteur/crediteur:</span>
                    <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => onUpdatePriority(counterparty.id, "")}
                        className={`px-2 py-1 rounded-md ${!counterparty.priority ? "bg-slate-100 text-slate-600 font-medium" : "text-slate-400"}`}
                      >
                        Geen
                      </button>
                      {PRIORITY_LEVELS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => onUpdatePriority(counterparty.id, p.value)}
                          className="px-2 py-1 rounded-md font-medium"
                          style={counterparty.priority === p.value ? { background: `${p.color}1A`, color: p.color } : { color: "#94A3B8" }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setMergingFor(mergingFor === counterparty.id ? null : counterparty.id); setMergeTargetId(""); }}
                      className="text-[11px] text-slate-500 underline decoration-dotted"
                    >
                      {mergingFor === counterparty.id ? "Sluiten" : "Samenvoegen met…"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditDetailsFor(editDetailsFor === counterparty.id ? null : counterparty.id)}
                      className="text-[11px] text-slate-500 underline decoration-dotted"
                    >
                      {editDetailsFor === counterparty.id ? "Sluiten" : "Gegevens bewerken"}
                    </button>
                  </div>
                </div>
                {mergingFor === counterparty.id && (
                  <div className="px-3.5 py-3 space-y-2 bg-rose-50/40 border-b border-slate-100">
                    <p className="text-[11px] text-slate-500">
                      Verhuist alle posten <b>en</b> betalingen van "{counterparty.name}" naar de gekozen crediteur, en verwijdert "{counterparty.name}" nadien. Dit kan niet ongedaan gemaakt worden.
                    </p>
                    <select
                      value={mergeTargetId}
                      onChange={(e) => setMergeTargetId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400 bg-white"
                    >
                      <option value="" disabled>Kies doel-crediteur…</option>
                      {counterparties
                        .filter((c) => c.id !== counterparty.id)
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!mergeTargetId) return;
                          setMerging(true);
                          await onMergeCounterparties(counterparty.id, mergeTargetId);
                          setMerging(false);
                          setMergingFor(null);
                          if (openId === counterparty.id) setOpenId(null);
                        }}
                        disabled={!mergeTargetId || merging}
                        className="flex-1 bg-rose-600 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        {merging ? "Bezig…" : "Bevestig samenvoegen"}
                      </button>
                      <button type="button" onClick={() => setMergingFor(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                        Annuleer
                      </button>
                    </div>
                  </div>
                )}
                {editDetailsFor === counterparty.id && (
                  <div className="px-3.5 py-3 space-y-2 bg-slate-50/60 border-b border-slate-100">
                    <div>
                      <label className="text-[11px] text-slate-400">Naam</label>
                      <input
                        value={counterparty.name}
                        onChange={(e) => onUpdateFieldLocal(counterparty.id, "name", e.target.value)}
                        onBlur={() => onCommitField(counterparty.id, "name")}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400 bg-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-400">BTW-nummer</label>
                        <input
                          value={counterparty.vatNumber || ""}
                          onChange={(e) => onUpdateFieldLocal(counterparty.id, "vatNumber", e.target.value)}
                          onBlur={() => onCommitField(counterparty.id, "vatNumber")}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400">Rekeningnummer</label>
                        <input
                          value={counterparty.accountNumber || ""}
                          onChange={(e) => onUpdateFieldLocal(counterparty.id, "accountNumber", e.target.value)}
                          onBlur={() => onCommitField(counterparty.id, "accountNumber")}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-400 bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400">Adres</label>
                      <input
                        value={counterparty.address || ""}
                        onChange={(e) => onUpdateFieldLocal(counterparty.id, "address", e.target.value)}
                        onBlur={() => onCommitField(counterparty.id, "address")}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400 bg-white"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 pt-1">
                      <input
                        type="checkbox"
                        checked={!!counterparty.noDocDefault}
                        onChange={(e) => onToggleNoDocDefault(counterparty.id, e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      Nieuwe betalingen van deze crediteur zijn standaard "geen document nodig"
                    </label>
                  </div>
                )}
                {cpItems.length > 0 && (
                <div className="divide-y divide-slate-50">
                {cpItems
                  .slice()
                  .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
                  .map((item) => {
                    const entity = entityById[item.entityId];
                    const c = entityColor(entity);
                    const isIn = item.direction === "in";
                    const paidOcc = occurrencePaymentMap(item, cpPaymentsById);
                    const isPaidOnce = item.recurrence === "once" && paidOcc.has(item.dueDate);

                    // Voor herhalende posten: welke vervaldatum raakt een klik?
                    // De datum die het dichtst bij vandaag ligt, betaald of niet.
                    let nearestOccurrenceDate = item.dueDate;
                    let nearestOccurrencePaid = paidOcc.size > 0;
                    if (item.recurrence !== "once") {
                      const today = todayISO();
                      const windowStart = toISO(addDays(fromISO(today), -365));
                      const windowEnd = toISO(addDays(fromISO(today), 365));
                      const occ = generateOccurrences(item, windowStart, windowEnd);
                      if (occ.length > 0) {
                        const sorted = occ.slice().sort(
                          (a, b) => Math.abs(fromISO(a.date) - fromISO(today)) - Math.abs(fromISO(b.date) - fromISO(today))
                        );
                        nearestOccurrenceDate = sorted[0].date;
                        nearestOccurrencePaid = paidOcc.has(nearestOccurrenceDate);
                      }
                    }

                    return (
                      <React.Fragment key={item.id}>
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
                            <span className="text-xs text-slate-400 truncate">{entity?.name || "?"}</span>
                            <span className="text-xs text-slate-400">Verval: {item.dueDate}</span>
                            {item.payDate && item.payDate !== item.dueDate && (
                              <span className="text-xs text-slate-400">· Betaal: {item.payDate}</span>
                            )}
                            {item.recurrence !== "once" && (
                              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                <RotateCcw className="w-2.5 h-2.5" />
                                {RECURRENCE_OPTIONS.find((o) => o.value === item.recurrence)?.label}
                              </span>
                            )}
                            {item.recurrence === "once" ? (
                              <button
                                onClick={() => onTogglePaid(item.id, item.dueDate)}
                                className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${
                                  isPaidOnce ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                                }`}
                              >
                                {isPaidOnce ? "Betaald" : "Openstaand"}
                              </button>
                            ) : (
                              <button
                                onClick={() => onTogglePaid(item.id, nearestOccurrenceDate)}
                                className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${
                                  nearestOccurrencePaid ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                                }`}
                                title={`Vinkt ${nearestOccurrenceDate} af (dichtstbijzijnde vervaldatum)`}
                              >
                                {nearestOccurrencePaid ? `Betaald (${nearestOccurrenceDate})` : `Openstaand (${nearestOccurrenceDate})`}
                              </button>
                            )}
                          </div>
                          <p className="text-sm truncate text-slate-800">
                            {item.description}
                          </p>
                          {(item.accountNumber || item.note || item.invoiceDate) && (
                            <p className="text-[11px] text-slate-400 truncate">
                              {item.invoiceDate && <span>Fact.: {item.invoiceDate}</span>}
                              {item.invoiceDate && (item.accountNumber || item.note) && " · "}
                              {item.accountNumber && <span className="font-mono">{item.accountNumber}</span>}
                              {item.accountNumber && item.note && " · "}
                              {item.note}
                            </p>
                          )}
                          {(item.paymentIds || []).length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.paymentIds.map((pid) => {
                                const linkedPayment = paymentById[pid];
                                return (
                                  <div key={pid} className="flex items-center gap-1.5 text-[11px]">
                                    <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                    <button
                                      onClick={() => onOpenDetail?.("payment", pid)}
                                      className="text-emerald-700 truncate underline decoration-dotted text-left"
                                    >
                                      {linkedPayment
                                        ? `${linkedPayment.description} · ${linkedPayment.date} · ${eur(linkedPayment.amount)}`
                                        : "(betaling niet gevonden)"}
                                    </button>
                                    {linkedPayment && (
                                      <button
                                        onClick={() => onUnlinkPayment(linkedPayment, item.id)}
                                        className="text-rose-400 underline decoration-dotted shrink-0"
                                      >
                                        ontkoppel
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <p className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                          {isIn ? "+" : "−"}{eur(item.amount)}
                        </p>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => onOpenDetail?.("item", item.id)} className="p-1 text-slate-300 hover:text-slate-600" title="Alle details bekijken">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {(item.paymentIds || []).length === 0 && (
                            <button
                              onClick={() => { setLinkingItemId(linkingItemId === item.id ? null : item.id); setLinkPaymentId(""); setRelinkingId(null); }}
                              className="p-1 text-slate-300 hover:text-slate-600"
                              title="Koppel aan een betaling"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => { setRelinkingId(relinkingId === item.id ? null : item.id); setRelinkTargetId(""); setLinkingItemId(null); }}
                            className="p-1 text-slate-300 hover:text-slate-600"
                            title={item.source === "Handmatig" ? "Samenvoegen met een andere post" : "Klopt de koppeling niet? Herkoppelen"}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onEdit(item)} className="p-1 text-slate-300 hover:text-slate-600">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onDuplicate(item)} className="p-1 text-slate-300 hover:text-slate-600" title="Dupliceren">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onDelete(item.id)} className="p-1 text-slate-300 hover:text-rose-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {linkingItemId === item.id && (() => {
                        const candidates = (payments || [])
                          .filter((p) => p.entityId === item.entityId && (p.documentIds || []).length === 0 && !p.noDocumentNeeded)
                          .sort((a, b) => a.amount - b.amount);
                        return (
                          <div className="px-3.5 pb-3.5 space-y-2">
                            {candidates.length === 0 ? (
                              <p className="text-[11px] text-slate-400">Geen ongekoppelde betalingen gevonden voor deze boekhouding.</p>
                            ) : (
                              <>
                                <select
                                  value={linkPaymentId}
                                  onChange={(e) => setLinkPaymentId(e.target.value)}
                                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                                >
                                  <option value="" disabled>Kies de juiste betaling…</option>
                                  {candidates.map((p) => (
                                    <option key={p.id} value={p.id}>{p.description} — {eur(p.amount)} ({p.date})</option>
                                  ))}
                                </select>
                                <div className="flex gap-2">
                                  <button
                                    onClick={async () => {
                                      const payment = candidates.find((p) => p.id === linkPaymentId);
                                      if (!payment) return;
                                      setLinking(true);
                                      await onLinkPayment(payment, item);
                                      setLinking(false);
                                      setLinkingItemId(null);
                                    }}
                                    disabled={!linkPaymentId || linking}
                                    className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                                  >
                                    {linking ? "Bezig…" : "Bevestig koppeling"}
                                  </button>
                                  <button onClick={() => setLinkingItemId(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                                    Annuleer
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}
                      {relinkingId === item.id && (() => {
                        const isManual = item.source === "Handmatig";
                        let snapshot = null;
                        if (!isManual) {
                          try { snapshot = JSON.parse(item.bankSnapshot); } catch (e) {}
                          if (!snapshot) {
                            // Oudere Bank-import/Billtobox-post zonder opgeslagen snapshot —
                            // gebruik de post z'n eigen huidige gegevens als vervanging.
                            snapshot = {
                              ref: item.bankRef || `manual-${item.id}`,
                              amount: item.amount,
                              direction: item.direction,
                              bookingDate: item.dueDate,
                              counterpartyName: item.description,
                              remittance: item.note || "",
                              wasCreated: true,
                            };
                          }
                        }
                        const candidates = items.filter(
                          (i) => i.id !== item.id && i.entityId === item.entityId && i.direction === item.direction
                        );
                        return (
                          <div className="px-3.5 pb-3.5 space-y-2">
                            <p className="text-[11px] text-slate-400">
                              {isManual
                                ? "Deze post wordt verwijderd; de betaalstatus (indien betaald) verhuist naar de gekozen post."
                                : `Bank zei: ${snapshot.counterpartyName || snapshot.remittance || "—"} · ${snapshot.bookingDate} · ${eur(snapshot.amount || 0)}`}
                            </p>
                            <select
                              value={relinkTargetId}
                              onChange={(e) => setRelinkTargetId(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                            >
                              <option value="" disabled>Kies de juiste post…</option>
                              {candidates.map((c) => (
                                <option key={c.id} value={c.id}>{c.description} — {eur(c.amount)} ({c.dueDate})</option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (!relinkTargetId) return;
                                  if (isManual) await onMerge(item, relinkTargetId);
                                  else await onRelink(item, relinkTargetId);
                                  setRelinkingId(null);
                                }}
                                disabled={!relinkTargetId}
                                className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                              >
                                {isManual ? "Bevestig samenvoegen" : "Bevestig herkoppeling"}
                              </button>
                              <button onClick={() => setRelinkingId(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                                Annuleer
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                      {editingId === item.id && (
                        <div className="px-3.5 pb-3.5">
                          <ItemForm
                            form={form}
                            setForm={setForm}
                            entities={entities}
                            counterparties={counterparties}
                            onSubmit={onSubmit}
                            onCancel={onCancel}
                            editing
                          />
                        </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                </div>
                )}
                {cpPayments.length > 0 && (
                  <div className="divide-y divide-slate-50">
                    {cpItems.length > 0 && (
                      <p className="px-3.5 pt-2.5 pb-1 text-[11px] font-medium text-slate-500 bg-slate-50/60 border-t border-slate-100">
                        Betalingen ({cpPayments.length})
                      </p>
                    )}
                    {cpPayments
                      .slice()
                      .sort((a, b) => (a.date < b.date ? 1 : -1))
                      .map((p) => {
                        const entity = entityById[p.entityId];
                        const isIn = p.direction === "in";
                        // Weergave-only: in dit paneel (crediteuren zonder enkele post) tonen
                        // we een niet-gekoppelde betaling standaard als "geen document nodig"
                        // i.p.v. "ongekoppeld" — dit raakt niet het echte GeenDocumentNodig-veld,
                        // dus in Betalingen/Koppelen telt zo'n betaling nog gewoon als ongekoppeld.
                        const status = (p.documentIds || []).length > 0 ? "linked" : "nodoc";
                        return (
                          <div
                            key={p.id}
                            onClick={() => onOpenDetail?.("payment", p.id)}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-slate-400 truncate">{entity?.name || "?"}</span>
                                <span className="text-xs text-slate-400">{p.date}</span>
                                <span
                                  className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${
                                    status === "linked" ? "bg-emerald-50 text-emerald-600" : status === "nodoc" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-600"
                                  }`}
                                >
                                  {status === "linked" ? "Gekoppeld" : status === "nodoc" ? "Geen document nodig" : "Ongekoppeld"}
                                </span>
                              </div>
                              <p className="text-sm truncate text-slate-800">{p.description}</p>
                              <p className="text-[11px] text-slate-400 truncate">{p.source}</p>
                            </div>
                            <p className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                              {isIn ? "+" : "−"}{eur(p.amount)}
                            </p>
                          </div>
                        );
                      })}
                    {cpItems.length === 0 && (
                      <p className="px-3.5 py-2 text-[11px] text-slate-400">
                        Nog geen post voor deze debiteur/crediteur — enkel betaling(en) hierboven. Klik op een betaling voor details of om ze aan een document te koppelen.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {groups.zonder.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setOpenId(openId === "__zonder__" ? null : "__zonder__")}
            className="w-full flex items-center justify-between px-3.5 py-3 text-left"
          >
            <div>
              <p className="text-sm font-medium text-slate-500">Zonder gekoppelde debiteur/crediteur</p>
              <p className="text-[11px] text-slate-400">{groups.zonder.length} post{groups.zonder.length !== 1 ? "en" : ""}</p>
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${openId === "__zonder__" ? "rotate-180" : ""}`} />
          </button>
          {openId === "__zonder__" && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {groups.zonder.map((item) => {
                const entity = entityById[item.entityId];
                const isIn = item.direction === "in";
                return (
                  <React.Fragment key={item.id}>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-slate-400 truncate">{entity?.name || "?"}</span>
                        <span className="text-xs text-slate-400">Verval: {item.dueDate}</span>
                        {item.payDate && item.payDate !== item.dueDate && (
                          <span className="text-xs text-slate-400">· Betaal: {item.payDate}</span>
                        )}
                        {item.invoiceDate && (
                          <span className="text-xs text-slate-400">· Fact.: {item.invoiceDate}</span>
                        )}
                        {item.source === "Bank-import" && (
                          <span className="text-[10px] font-medium text-teal-600 bg-teal-50 rounded px-1 py-0.5 shrink-0">Bank</span>
                        )}
                        {item.source === "Billtobox" && (
                          <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 rounded px-1 py-0.5 shrink-0">Billtobox</span>
                        )}
                      </div>
                      <p className="text-sm truncate text-slate-800">{item.description}</p>
                      {(item.paymentIds || []).length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {item.paymentIds.map((pid) => {
                            const linkedPayment = paymentById[pid];
                            return (
                              <div key={pid} className="flex items-center gap-1.5 text-[11px]">
                                <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                <button
                                  onClick={() => onOpenDetail?.("payment", pid)}
                                  className="text-emerald-700 truncate underline decoration-dotted text-left"
                                >
                                  {linkedPayment
                                    ? `${linkedPayment.description} · ${linkedPayment.date} · ${eur(linkedPayment.amount)}`
                                    : "(betaling niet gevonden)"}
                                </button>
                                {linkedPayment && (
                                  <button
                                    onClick={() => onUnlinkPayment(linkedPayment, item.id)}
                                    className="text-rose-400 underline decoration-dotted shrink-0"
                                  >
                                    ontkoppel
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <span className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                      {isIn ? "+" : "−"}{eur(item.amount)}
                    </span>
                    <button onClick={() => onOpenDetail?.("item", item.id)} className="p-1 text-slate-300 hover:text-slate-600 shrink-0" title="Alle details bekijken">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {(item.paymentIds || []).length === 0 && (
                      <button
                        onClick={() => { setLinkingItemId(linkingItemId === item.id ? null : item.id); setLinkPaymentId(""); }}
                        className="p-1 text-slate-300 hover:text-slate-600 shrink-0"
                        title="Koppel aan een betaling"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => onEdit(item)} className="p-1 text-slate-300 hover:text-slate-600 shrink-0">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {linkingItemId === item.id && (() => {
                    const candidates = (payments || [])
                      .filter((p) => p.entityId === item.entityId && (p.documentIds || []).length === 0 && !p.noDocumentNeeded)
                      .sort((a, b) => a.amount - b.amount);
                    return (
                      <div className="px-3.5 pb-3.5 space-y-2">
                        {candidates.length === 0 ? (
                          <p className="text-[11px] text-slate-400">Geen ongekoppelde betalingen gevonden voor deze boekhouding.</p>
                        ) : (
                          <>
                            <select
                              value={linkPaymentId}
                              onChange={(e) => setLinkPaymentId(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                            >
                              <option value="" disabled>Kies de juiste betaling…</option>
                              {candidates.map((p) => (
                                <option key={p.id} value={p.id}>{p.description} — {eur(p.amount)} ({p.date})</option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  const payment = candidates.find((p) => p.id === linkPaymentId);
                                  if (!payment) return;
                                  setLinking(true);
                                  await onLinkPayment(payment, item);
                                  setLinking(false);
                                  setLinkingItemId(null);
                                }}
                                disabled={!linkPaymentId || linking}
                                className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                              >
                                {linking ? "Bezig…" : "Bevestig koppeling"}
                              </button>
                              <button onClick={() => setLinkingItemId(null)} className="px-3 rounded-lg border border-slate-200 text-xs">
                                Annuleer
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {editingId === item.id && (
                    <div className="px-3.5 pb-3.5">
                      <ItemForm
                        form={form}
                        setForm={setForm}
                        entities={entities}
                        counterparties={counterparties}
                        onSubmit={onSubmit}
                        onCancel={onCancel}
                        editing
                      />
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pop-up met alle velden van één post (document) of één betaling — bereikbaar
// via het oog-icoontje / "details"-link in Planning, Crediteuren en Koppelen.
// Toont ook de wederzijdse koppeling(en) met doorklikbare cross-referenties,
// zodat je zonder tabwissel van een betaling naar het document kan springen
// (of omgekeerd), inclusief ontkoppel-actie.
function DetailModal({ target, items, payments, entityById, counterpartyById, counterparties, categories, projects, onClose, onOpenDetail, onEditItem, onDeleteItem, onUnlinkPayment, onLinkPayment, onDeletePayment, onResolveCounterparty, onUpdatePaymentCounterparty, onCounterpartyClick, onUpdateItemField, onUpdatePaymentField, onToggleNoDocNeeded, onCreateDocFromPayment }) {
  const { type, id } = target;
  const record = type === "item" ? items.find((i) => i.id === id) : payments.find((p) => p.id === id);

  if (!record) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-40" onClick={onClose}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[28rem]" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-slate-500">Record niet gevonden — mogelijk ondertussen verwijderd of ontkoppeld.</p>
          <button onClick={onClose} className="w-full mt-3 py-2 rounded-lg border border-slate-200 text-sm">Sluiten</button>
        </div>
      </div>
    );
  }

  const entity = entityById[record.entityId];
  const category = record.categoryId ? (categories || []).find((c) => c.id === record.categoryId) : null;
  const project = record.projectId ? (projects || []).find((p) => p.id === record.projectId) : null;
  const [counterpartyInput, setCounterpartyInput] = useState("");
  const [savingCounterparty, setSavingCounterparty] = useState(false);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [docDraft, setDocDraft] = useState({ description: "", counterpartyName: "" });
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [showLinkDoc, setShowLinkDoc] = useState(false);
  const [chosenDocId, setChosenDocId] = useState("");
  const [linkingDoc, setLinkingDoc] = useState(false);
  const currentCounterparty = record.counterpartyId ? counterpartyById[record.counterpartyId] : null;
  const linkDocCandidates = type === "payment"
    ? (items || [])
        .filter((i) => i.entityId === record.entityId && (i.paymentIds || []).length === 0)
        .sort((a, b) => a.amount - b.amount)
    : [];

  async function saveCounterparty() {
    const name = counterpartyInput.trim();
    if (!name || !onResolveCounterparty || !onUpdatePaymentCounterparty) return;
    setSavingCounterparty(true);
    const id = await onResolveCounterparty(name);
    await onUpdatePaymentCounterparty(record.id, id);
    setSavingCounterparty(false);
    setCounterpartyInput("");
  }

  let snapshot = null;
  if (type === "item" && record.bankSnapshot) {
    try { snapshot = JSON.parse(record.bankSnapshot); } catch (e) {}
  }

  function Row({ label, value }) {
    if (value === null || value === undefined || value === "") return null;
    return (
      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
        <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
        <span className="text-xs text-slate-700 text-right break-words">{value}</span>
      </div>
    );
  }

  // Klik-om-te-wijzigen: lokale state per toetsaanslag voor directe
  // feedback, wegschrijven pas on-blur (tekst/getal) of on-change
  // (select/datum) — zelfde patroon als de boekhouding-velden elders in de
  // app. `field` is de JS-veldnaam op record (bv. "description", "amount").
  function updateField(field, value) {
    if (type === "item") onUpdateItemField(record.id, field, value);
    else onUpdatePaymentField(record.id, field, value);
  }
  function EditableField({ label, field, type: inputType = "text", options }) {
    const [local, setLocal] = useState(record[field] ?? "");
    useEffect(() => { setLocal(record[field] ?? ""); }, [record[field]]);
    const commit = () => {
      const parsed = inputType === "number" ? Number(local) : local;
      if (parsed !== (record[field] ?? "")) updateField(field, parsed);
    };
    if (inputType === "select") {
      return (
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
          <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
          <select
            value={local}
            onChange={(e) => { setLocal(e.target.value); updateField(field, e.target.value); }}
            className="text-xs text-right border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-slate-400 bg-white"
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
        <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
        <input
          type={inputType}
          step={inputType === "number" ? "0.01" : undefined}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="text-xs text-right border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-slate-400 w-36"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-[30rem] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-slate-900 flex items-center gap-2">
            {type === "item" ? <FileText className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
            {type === "item" ? "Post — details" : "Betaling — details"}
          </h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        <div>
          <EditableField label="Omschrijving" field="description" />
          <Row label="Boekhouding" value={entity?.name} />
          {type === "item" ? (
            <Row
              label="Debiteur/crediteur"
              value={
                currentCounterparty ? (
                  <button
                    onClick={() => { onCounterpartyClick?.(currentCounterparty.id); onClose(); }}
                    className="underline decoration-dotted hover:text-slate-900"
                  >
                    {currentCounterparty.name}
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-50">
              <span className="text-[11px] text-slate-400 shrink-0 pt-1.5">Debiteur/crediteur</span>
              <div className="flex-1 min-w-0">
                {currentCounterparty ? (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { onCounterpartyClick?.(currentCounterparty.id); onClose(); }}
                      className="text-xs text-slate-700 underline decoration-dotted hover:text-slate-900"
                    >
                      {currentCounterparty.name}
                    </button>
                    <button
                      onClick={() => { setCounterpartyInput(currentCounterparty.name); onUpdatePaymentCounterparty(record.id, null); }}
                      className="text-[10px] text-rose-400 underline decoration-dotted shrink-0"
                    >
                      wijzig
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <CounterpartyAutocomplete
                      value={counterpartyInput}
                      onChange={setCounterpartyInput}
                      onKeyDown={(e) => e.key === "Enter" && saveCounterparty()}
                      counterparties={counterparties || []}
                      placeholder="Naam invullen…"
                      className="flex-1 min-w-0"
                      inputClassName="w-full border border-slate-200 rounded-md px-2 py-1 text-xs outline-none focus:border-slate-400 text-right"
                    />
                    <button
                      onClick={saveCounterparty}
                      disabled={!counterpartyInput.trim() || savingCounterparty}
                      className="text-[10px] bg-slate-900 text-white rounded px-2 py-1 shrink-0 disabled:opacity-40"
                    >
                      {savingCounterparty ? "…" : "Koppel"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <EditableField label="Bedrag" field="amount" type="number" />
          <EditableField label="Richting" field="direction" type="select" options={[{ value: "in", label: "Inkomst" }, { value: "uit", label: "Uitgave" }]} />
          {type === "item" ? (
            <>
              <EditableField label="Vervaldatum" field="dueDate" type="date" />
              <EditableField label="Betaaldatum" field="payDate" type="date" />
              <EditableField label="Factuurdatum" field="invoiceDate" type="date" />
              <EditableField
                label="Herhaling"
                field="recurrence"
                type="select"
                options={RECURRENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <EditableField label="Einddatum" field="endDate" type="date" />
              <EditableField label="Rekeningnummer" field="accountNumber" />
              <EditableField label="Opmerking" field="note" />
              <Row label="Via PayPal" value={record.viaPaypal ? "Ja" : null} />
              <Row label="Gelezen" value={record.read ? "Ja" : "Nee"} />
              <Row
                label="Betaalde data"
                value={(() => {
                  const map = occurrencePaymentMap(record, Object.fromEntries((payments || []).map((p) => [p.id, p])));
                  const dates = Array.from(map.keys()).sort();
                  return dates.length > 0 ? dates.join(", ") : null;
                })()}
              />
            </>
          ) : (
            <EditableField label="Datum" field="date" type="date" />
          )}
          <Row label="Bron" value={record.source} />
          <Row label={type === "item" ? "BankRef" : "Bankreferentie"} value={record.bankRef} />
          {type === "payment" && <Row label="Volgnummer" value={record.volgnummer} />}
          <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
            <span className="text-[11px] text-slate-400 shrink-0">Categorie</span>
            <select
              value={record.categoryId || ""}
              onChange={(e) => updateField("categoryId", e.target.value || null)}
              className="text-xs text-right border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-slate-400 bg-white max-w-[60%]"
            >
              <option value="">— geen —</option>
              {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <Row label="Project" value={project?.name} />
          {type === "payment" && (
            <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
              <span className="text-[11px] text-slate-400 shrink-0">Interne overschrijving</span>
              <select
                value={record.transferType || ""}
                onChange={(e) => updateField("transferType", e.target.value)}
                className="text-xs text-right border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-slate-400 bg-white"
              >
                <option value="">— geen —</option>
                <option value="Rekening-courant">Rekening-courant</option>
                <option value="Dividend">Dividend</option>
                <option value="Kosten doorrekening">Kosten doorrekening</option>
                <option value="Andere">Andere</option>
              </select>
            </div>
          )}
          {type === "payment" && <Row label="Geen document nodig" value={record.noDocumentNeeded ? "Ja" : null} />}
        </div>

        {snapshot && (
          <div className="mt-3 bg-slate-50 rounded-lg p-2.5 text-xs space-y-1">
            <p className="text-slate-500 font-medium mb-1">Ruwe bankgegevens</p>
            {snapshot.counterpartyName && <p><span className="text-slate-400">Naam bij bank: </span>{snapshot.counterpartyName}</p>}
            {snapshot.remittance && <p className="break-words"><span className="text-slate-400">Mededeling: </span>{snapshot.remittance}</p>}
            {snapshot.bookingDate && <p><span className="text-slate-400">Boekingsdatum: </span>{snapshot.bookingDate}</p>}
            {snapshot.ref && <p><span className="text-slate-400">Referentie: </span>{snapshot.ref}</p>}
          </div>
        )}

        {type === "item" && (record.paymentIds || []).length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-slate-400 mb-1">Gekoppelde betaling(en)</p>
            {record.paymentIds.map((pid) => {
              const p = payments.find((pp) => pp.id === pid);
              return (
                <div key={pid} className="flex items-center justify-between bg-slate-50 rounded-md px-2 py-1.5 mb-1">
                  <button
                    onClick={() => onOpenDetail("payment", pid)}
                    className="text-xs text-slate-700 underline decoration-dotted text-left truncate"
                  >
                    {p ? `${p.description} · ${p.date} · ${eur(p.amount)}` : "(niet gevonden)"}
                  </button>
                  {p && (
                    <button onClick={() => onUnlinkPayment(p, record.id)} className="text-[10px] text-rose-500 underline decoration-dotted shrink-0 ml-2">
                      ontkoppel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {type === "payment" && (record.documentIds || []).length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-slate-400 mb-1">Gekoppeld(e) document(en)</p>
            {record.documentIds.map((did) => {
              const it = items.find((ii) => ii.id === did);
              return (
                <div key={did} className="flex items-center justify-between bg-slate-50 rounded-md px-2 py-1.5 mb-1">
                  <button
                    onClick={() => onOpenDetail("item", did)}
                    className="text-xs text-slate-700 underline decoration-dotted text-left truncate"
                  >
                    {it ? it.description : "(niet gevonden)"}
                  </button>
                  {it && (
                    <button onClick={() => onUnlinkPayment(record, did)} className="text-[10px] text-rose-500 underline decoration-dotted shrink-0 ml-2">
                      ontkoppel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {type === "payment" && (record.documentIds || []).length === 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            {record.noDocumentNeeded ? (
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-2.5 py-2">
                <span className="text-xs text-slate-500">Gemarkeerd als "geen document nodig"</span>
                <button
                  onClick={() => onToggleNoDocNeeded(record)}
                  className="text-[10px] text-slate-500 underline decoration-dotted shrink-0 ml-2"
                >
                  ongedaan maken
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowCreateDoc((s) => !s); setShowLinkDoc(false); setDocDraft({ description: record.description, counterpartyName: currentCounterparty?.name || "" }); }}
                    className="flex-1 text-xs border border-slate-200 rounded-lg py-1.5 text-slate-700"
                  >
                    Maak document
                  </button>
                  <button
                    onClick={() => { setShowLinkDoc((s) => !s); setShowCreateDoc(false); setChosenDocId(""); }}
                    className="flex-1 text-xs border border-slate-200 rounded-lg py-1.5 text-slate-700"
                  >
                    Koppel aan document
                  </button>
                  <button
                    onClick={() => onToggleNoDocNeeded(record)}
                    className="flex-1 text-xs border border-slate-200 rounded-lg py-1.5 text-slate-500"
                  >
                    Geen document nodig
                  </button>
                </div>
                {showLinkDoc && (
                  <div className="mt-2 space-y-2">
                    {linkDocCandidates.length === 0 ? (
                      <p className="text-[11px] text-slate-400">Geen ongekoppelde documenten gevonden voor deze boekhouding.</p>
                    ) : (
                      <>
                        <select
                          value={chosenDocId}
                          onChange={(e) => setChosenDocId(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        >
                          <option value="" disabled>Kies het juiste document…</option>
                          {linkDocCandidates.map((i) => (
                            <option key={i.id} value={i.id}>{i.description} — {eur(i.amount)} ({i.dueDate || i.date})</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              const doc = linkDocCandidates.find((i) => i.id === chosenDocId);
                              if (!doc) return;
                              setLinkingDoc(true);
                              await onLinkPayment(record, doc);
                              setLinkingDoc(false);
                              setShowLinkDoc(false);
                              setChosenDocId("");
                            }}
                            disabled={!chosenDocId || linkingDoc}
                            className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                          >
                            {linkingDoc ? "Bezig…" : "Bevestig koppeling"}
                          </button>
                          <button onClick={() => setShowLinkDoc(false)} className="px-3 rounded-lg border border-slate-200 text-xs">
                            Annuleer
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {showCreateDoc && (
                  <div className="mt-2 space-y-2">
                    <input
                      value={docDraft.description}
                      onChange={(e) => setDocDraft({ ...docDraft, description: e.target.value })}
                      placeholder="Omschrijving document"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                    />
                    <CounterpartyAutocomplete
                      value={docDraft.counterpartyName}
                      onChange={(v) => setDocDraft({ ...docDraft, counterpartyName: v })}
                      counterparties={counterparties || []}
                      placeholder="Crediteur/debiteur (optioneel — bestaande naam of nieuw)"
                      inputClassName="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setCreatingDoc(true);
                          const counterpartyId = docDraft.counterpartyName.trim()
                            ? await onResolveCounterparty(docDraft.counterpartyName.trim())
                            : null;
                          await onCreateDocFromPayment(record, { description: docDraft.description, counterpartyId });
                          setCreatingDoc(false);
                          setShowCreateDoc(false);
                        }}
                        disabled={creatingDoc}
                        className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        {creatingDoc ? "Bezig…" : "Bevestig document"}
                      </button>
                      <button onClick={() => setShowCreateDoc(false)} className="px-3 rounded-lg border border-slate-200 text-xs">
                        Annuleer
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <p className="text-[10px] text-slate-300 mt-3 font-mono">Airtable ID: {record.id}</p>

        <div className="flex gap-2 mt-4">
          {type === "item" ? (
            <>
              <button onClick={() => onEditItem(record)} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium">
                Bewerk
              </button>
              <button onClick={() => onDeleteItem(record.id)} className="px-3 rounded-lg border border-rose-200 text-rose-600 text-sm">
                Verwijder
              </button>
            </>
          ) : (
            <button onClick={() => onDeletePayment(record)} className="flex-1 border border-rose-200 text-rose-600 rounded-lg py-2 text-sm font-medium">
              Verwijder betaling
            </button>
          )}
          <button onClick={onClose} className="px-3 rounded-lg border border-slate-200 text-sm">
            Sluiten
          </button>
        </div>
      </div>
    </div>
  );
}

// Los overzicht van ALLE Betaling-records, ongeacht koppelstatus — inclusief
// betalingen met "geen document nodig", die in het Koppelen-scherm nergens
// verschijnen omdat ze buiten zowel de ongekoppelde- als gekoppelde-secties
// vallen.
function BetalingenView({ payments, entityById, counterpartyById, counterparties, filteredEntityIds, categories, projects, onOpenDetail, onDeletePayment, onCounterpartyClick, onOpenRecurringDraft, onResolveCounterparty, onBulkAssignCounterparty }) {
  const [statusFilter, setStatusFilter] = useState("all"); // all | linked | unlinked | nodoc
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCounterparty, setBulkCounterparty] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkError, setBulkError] = useState("");
  // Zelfde instelbare-sortering-patroon als "Ongekoppelde documenten"/
  // "Ongekoppelde betalingen" in Koppelen — was hier voorheen een vaste
  // datum+volgnummer-combinatie, nu net als daar zelf te kiezen.
  const [paySortField, setPaySortField] = useState("date"); // date | amount | description | volgnummer
  const [paySortDir, setPaySortDir] = useState("desc"); // asc | desc
  const [searchQuery, setSearchQuery] = useState("");

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function statusOf(p) {
    if ((p.documentIds || []).length > 0) return "linked";
    if (p.noDocumentNeeded) return "nodoc";
    return "unlinked";
  }

  const scoped = payments.filter((p) => filteredEntityIds.includes(p.entityId));
  const query = searchQuery.trim().toLowerCase();
  const filtered = scoped
    .filter((p) => statusFilter === "all" || (statusFilter === "nocp" ? !p.counterpartyId : statusOf(p) === statusFilter))
    .filter((p) => {
      if (!query) return true;
      const cp = p.counterpartyId ? counterpartyById[p.counterpartyId] : null;
      return (
        p.description.toLowerCase().includes(query) ||
        (cp?.name || "").toLowerCase().includes(query) ||
        (p.bankRef || "").toLowerCase().includes(query) ||
        (p.volgnummer || "").toLowerCase().includes(query) ||
        (p.raw?.remittance || "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      let cmp;
      if (paySortField === "amount") cmp = a.amount - b.amount;
      else if (paySortField === "description") cmp = a.description.localeCompare(b.description);
      else if (paySortField === "volgnummer") {
        // Lege volgnummers altijd achteraan, ongeacht richting.
        if (!a.volgnummer && !b.volgnummer) cmp = 0;
        else if (!a.volgnummer) return 1;
        else if (!b.volgnummer) return -1;
        else cmp = a.volgnummer < b.volgnummer ? -1 : a.volgnummer > b.volgnummer ? 1 : 0;
      } else cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return paySortDir === "asc" ? cmp : -cmp;
    });

  const counts = {
    all: scoped.length,
    linked: scoped.filter((p) => statusOf(p) === "linked").length,
    unlinked: scoped.filter((p) => statusOf(p) === "unlinked").length,
    nodoc: scoped.filter((p) => statusOf(p) === "nodoc").length,
    nocp: scoped.filter((p) => !p.counterpartyId).length,
  };
  const totalIn = filtered.filter((p) => p.direction === "in").reduce((s, p) => s + p.amount, 0);
  const totalUit = filtered.filter((p) => p.direction === "uit").reduce((s, p) => s + p.amount, 0);

  const FILTERS = [
    { key: "all", label: "Alle" },
    { key: "linked", label: "Gekoppeld" },
    { key: "unlinked", label: "Ongekoppeld" },
    { key: "nodoc", label: "Geen document nodig" },
    { key: "nocp", label: "Zonder crediteur" },
  ];

  return (
    <div className="mt-4 space-y-3">
      <div className="sticky top-0 z-20 bg-[#F4F6F5] pt-1 pb-2 -mx-1 px-1 space-y-3">
        {/* Uitlegregel weggehaald — nam op iPhone permanent ruimte in binnen het sticky blok, terwijl zoekveld + filters zelf al voldoende context geven. */}

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Zoek op omschrijving, crediteur, mededeling, referentie of volgnummer…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white"
        />

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs border transition ${
                statusFilter === f.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={paySortField}
            onChange={(e) => setPaySortField(e.target.value)}
            className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600 outline-none focus:border-slate-400"
          >
            <option value="date">Sorteer op datum</option>
            <option value="amount">Sorteer op bedrag</option>
            <option value="description">Sorteer op omschrijving</option>
            <option value="volgnummer">Sorteer op volgnummer</option>
          </select>
          <button
            onClick={() => setPaySortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center gap-1 text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600"
            title={paySortDir === "asc" ? "Oplopend — klik voor aflopend" : "Aflopend — klik voor oplopend"}
          >
            <ArrowUpDown className="w-3 h-3" />
            {paySortDir === "asc" ? "Oplopend" : "Aflopend"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Aantal" value={filtered.length} tone="pos" isCount />
        <SummaryCard label="Totaal in" value={totalIn} tone="pos" />
        <SummaryCard label="Totaal uit" value={totalUit} tone="neg" />
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())
              }
              className="w-3.5 h-3.5 rounded border-slate-300"
            />
            Alles selecteren ({filtered.length})
          </label>
          {selectedIds.size > 0 && <span className="text-[11px] text-slate-400">{selectedIds.size} geselecteerd</span>}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <CounterpartyAutocomplete
              value={bulkCounterparty}
              onChange={(v) => { setBulkCounterparty(v); setBulkError(""); }}
              counterparties={counterparties || []}
              placeholder="Debiteur/crediteur toewijzen aan selectie…"
              className="flex-1"
              inputClassName="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
            />
            <button
              onClick={async () => {
                if (!bulkCounterparty.trim()) { setBulkError("Vul eerst een naam in."); return; }
                setBulkError("");
                setBulkAssigning(true);
                try {
                  const counterpartyId = await onResolveCounterparty(bulkCounterparty.trim());
                  await onBulkAssignCounterparty([...selectedIds], counterpartyId);
                  setBulkCounterparty("");
                  setSelectedIds(new Set());
                } catch (err) {
                  setBulkError(`Toewijzen mislukt: ${err.message}`);
                } finally {
                  setBulkAssigning(false);
                }
              }}
              disabled={bulkAssigning}
              className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 shrink-0 disabled:opacity-40"
            >
              {bulkAssigning ? "Bezig…" : `Toewijzen aan ${selectedIds.size}`}
            </button>
            <button onClick={() => { setSelectedIds(new Set()); setBulkError(""); }} className="text-xs text-slate-400 shrink-0">
              Annuleer
            </button>
          </div>
          {bulkError && <p className="text-[11px] text-rose-600">{bulkError}</p>}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Geen betalingen in deze selectie.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-50">
          {filtered.map((p) => {
            const entity = entityById[p.entityId];
            const status = statusOf(p);
            const category = p.categoryId ? (categories || []).find((c) => c.id === p.categoryId) : null;
            const project = p.projectId ? (projects || []).find((pr) => pr.id === p.projectId) : null;
            const counterparty = p.counterpartyId ? counterpartyById[p.counterpartyId] : null;
            return (
              <div
                key={p.id}
                onClick={() => onOpenDetail("payment", p.id)}
                className="px-3.5 py-2.5 cursor-pointer hover:bg-slate-50"
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-slate-300 shrink-0"
                  />
                  <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-slate-800 truncate min-w-0">
                      {p.description}
                      {counterparty && (
                        <>
                          {" — "}
                          <button
                            onClick={(e) => { e.stopPropagation(); onCounterpartyClick?.(counterparty.id); }}
                            className="text-slate-400 font-normal underline decoration-dotted hover:text-slate-600"
                          >
                            {counterparty.name}
                          </button>
                        </>
                      )}
                    </p>
                    <span
                      className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${
                        status === "linked"
                          ? "bg-emerald-50 text-emerald-600"
                          : status === "nodoc"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-amber-50 text-amber-600"
                      }`}
                    >
                      {status === "linked" ? "Gekoppeld" : status === "nodoc" ? "Geen document nodig" : "Ongekoppeld"}
                    </span>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-2 mt-1 pl-[26px]">
                  <p className="text-[11px] text-slate-400 truncate min-w-0">
                    {entity?.name} · {p.date} · {p.source}
                    {p.volgnummer && <> · volgnr <span className="font-mono">{p.volgnummer}</span></>}
                    {category && <> · {category.name}</>}
                    {project && <> · {project.name}</>}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenRecurringDraft(p); }}
                      className="text-[10px] text-slate-400 underline decoration-dotted"
                    >
                      herhalende post
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeletePayment(p); }}
                      className="text-[10px] text-rose-400 underline decoration-dotted"
                    >
                      verwijder
                    </button>
                    <span className={`text-sm font-medium ${p.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                      {p.direction === "in" ? "+" : "−"}{eur(p.amount)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
