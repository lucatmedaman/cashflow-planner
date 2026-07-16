import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, Building2, ChevronDown, X, Edit2, Copy,
  TrendingUp, TrendingDown, RotateCcw, AlertCircle,
  Download, Upload, Loader2, RefreshCw, Landmark
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { TABLES, atListAll, atCreate, atUpdate, atDelete } from "./airtable";

// ---------- constants ----------

// Verhoog dit bij elke inhoudelijke update, zodat je in de app zelf kan zien
// of je de nieuwste versie effectief live hebt staan.
const APP_VERSION = "1.28.0";

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
  { bg: "#EEF2FF", ring: "#6366F1", text: "#4338CA", dot: "#6366F1" }, // indigo
  { bg: "#ECFDF5", ring: "#10B981", text: "#047857", dot: "#10B981" }, // emerald
  { bg: "#FFF7ED", ring: "#F59E0B", text: "#B45309", dot: "#F59E0B" }, // amber
  { bg: "#FDF2F8", ring: "#EC4899", text: "#BE185D", dot: "#EC4899" }, // pink
  { bg: "#F0F9FF", ring: "#0EA5E9", text: "#0369A1", dot: "#0EA5E9" }, // sky
  { bg: "#F5F3FF", ring: "#8B5CF6", text: "#6D28D9", dot: "#8B5CF6" }, // violet
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
    colorIdx: colorIdxFromId(r.id),
  };
}
function counterpartyFromRecord(r) {
  return {
    id: r.id,
    name: r.fields.Naam || "",
    autoCreateDoc: !!r.fields.AutomatischDocumentAanmaken,
    vatNumber: r.fields.BTWNummer || "",
    accountNumber: r.fields.Rekeningnummer || "",
    address: r.fields.Adres || "",
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
    raw,
    categoryId: r.fields.Categorie?.[0] || null,
    projectId: r.fields.Project?.[0] || null,
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
    RuweBrongegevens: payment.raw ? JSON.stringify(payment.raw) : "",
    Categorie: payment.categoryId ? [payment.categoryId] : [],
    Project: payment.projectId ? [payment.projectId] : [],
    GekoppeldeDocumenten: payment.documentIds || [],
    GeenDocumentNodig: !!payment.noDocumentNeeded,
  };
}

function itemFromRecord(r) {
  let paidDates = [];
  try {
    paidDates = r.fields.BetaaldeData ? JSON.parse(r.fields.BetaaldeData) : [];
  } catch (e) {}
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
    paidDates,
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
    BetaaldeData: JSON.stringify(item.paidDates || []),
  };
}

// ---------- bank statement (CAMT.053) import ----------
// The IBAN-to-boekhouding link now lives on the entity itself (Airtable field
// "IBAN"), editable in the boekhouding-beheerscherm — no more hardcoded map.
function findEntityByIban(entities, iban) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  return entities.find((e) => e.iban && e.iban === clean) || null;
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
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);

  const [loading, setLoading] = useState(true);
  const [airtableError, setAirtableError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncToast, setSyncToast] = useState(false);

  const [view, setView] = useState("planning"); // planning | rapport
  const [jumpToCounterpartyId, setJumpToCounterpartyId] = useState(null);
  const [activeEntity, setActiveEntity] = useState("all");

  function goToCounterparty(counterpartyId) {
    if (!counterpartyId) return;
    setJumpToCounterpartyId(counterpartyId);
    setView("crediteuren");
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
  };
  const [form, setForm] = useState(emptyForm);
  const fileInputRef = useRef(null);
  const [importMsg, setImportMsg] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
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

  function markSynced() {
    setLastSyncedAt(new Date().toISOString());
    setSyncToast(true);
    setTimeout(() => setSyncToast(false), 2000);
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
    const [entRecs, cpRecs, itemRecs, mapRecs, paymentRecs, catRecs, projRecs] = await Promise.all([
      atListAll(TABLES.entities),
      atListAll(TABLES.counterparties),
      atListAll(TABLES.items),
      atListAll(TABLES.nameMappings),
      atListAll(TABLES.payments),
      atListAll(TABLES.categories),
      atListAll(TABLES.projects),
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
        markSynced();
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
      const parsed = parseCamt053(text);
      if (!parsed.entries.length) {
        setBankError("Geen verrichtingen gevonden in dit bestand — is het een geldig CAMT.053-bestand?");
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
        const reloaded = await loadFromAirtable();
        setEntities(reloaded.entities);
        setCounterparties(reloaded.counterparties);
        setItems(reloaded.items);
        setNameMappings(reloaded.nameMappings || []);
        setPayments(reloaded.payments || []);
        setCategories(reloaded.categories || []);
        setProjects(reloaded.projects || []);
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
    let matched = 0, created = 0, proposed = 0, skipped = 0, errors = 0;

    // Work off local snapshots so matches within this same import don't
    // collide with each other before React state catches up.
    let workingItems = items;
    let workingPayments = payments;
    let workingCounterparties = counterparties;

    for (const entry of bankParsed.entries) {
      try {
        const alreadyImported = entry.ref && workingPayments.some((p) => p.bankRef === entry.ref);
        if (alreadyImported) { skipped++; continue; }

        const candidates = workingItems.filter(
          (i) => i.entityId === bankEntityId && i.direction === entry.direction &&
            Math.abs(i.amount - entry.amount) < 0.01
        );

        let matchedItem = null, matchedDate = null;
        const entryDate = fromISO(entry.bookingDate);
        for (const cand of candidates) {
          const windowStart = toISO(addDays(entryDate, -10));
          const windowEnd = toISO(addDays(entryDate, 10));
          const occ = generateOccurrences(cand, windowStart, windowEnd)
            .filter((o) => !(cand.paidDates || []).includes(o.date));
          if (occ.length > 0) {
            occ.sort((a, b) => Math.abs(fromISO(a.date) - entryDate) - Math.abs(fromISO(b.date) - entryDate));
            matchedItem = cand;
            matchedDate = occ[0].date;
            break;
          }
        }

        const snapshot = { ...entry, wasCreated: !matchedItem };
        const paymentFields = paymentToFields({
          description: entry.counterpartyName || (entry.remittance || "Bankverrichting").slice(0, 80),
          date: entry.bookingDate,
          amount: entry.amount,
          direction: entry.direction,
          entityId: bankEntityId,
          source: "Bank-import",
          bankRef: entry.ref,
          raw: snapshot,
          categoryId: null,
          projectId: null,
          documentIds: matchedItem ? [matchedItem.id] : [],
          noDocumentNeeded: false,
        });
        const [paymentRec] = await atCreate(TABLES.payments, [{ fields: paymentFields }]);
        let newPayment = paymentFromRecord(paymentRec);
        workingPayments = [...workingPayments, newPayment];

        if (matchedItem) {
          const newPaidDates = [...(matchedItem.paidDates || []), matchedDate];
          const newDocPaymentIds = [...(matchedItem.paymentIds || []), newPayment.id];
          await atUpdate(TABLES.items, [{
            id: matchedItem.id,
            fields: { BetaaldeData: JSON.stringify(newPaidDates), Betalingen: newDocPaymentIds, Bron: "Bank-import", Gelezen: false },
          }]);
          workingItems = workingItems.map((i) =>
            i.id === matchedItem.id
              ? { ...i, paidDates: newPaidDates, paymentIds: newDocPaymentIds, source: "Bank-import", read: false }
              : i
          );
          matched++;
        } else {
          let counterpartyId = null;
          let trustedCounterparty = false;
          if (entry.counterpartyName) {
            const existing = workingCounterparties.find(
              (c) => c.name.toLowerCase() === entry.counterpartyName.toLowerCase()
            );
            if (existing) {
              counterpartyId = existing.id;
              trustedCounterparty = existing.autoCreateDoc;
            } else {
              // Gloednieuwe crediteur/debiteur — kan per definitie nog niet
              // vertrouwd zijn (AutomatischDocumentAanmaken staat nooit aan
              // bij aanmaak).
              counterpartyId = await resolveCounterpartyId(entry.counterpartyName);
            }
          }

          if (trustedCounterparty) {
            // Vertrouwde crediteur/debiteur: meteen automatisch een document
            // aanmaken en koppelen, geen bevestiging nodig.
            const docFields = itemToFields({
              description: entry.counterpartyName || (entry.remittance || "Bankverrichting").slice(0, 80),
              entityId: bankEntityId,
              counterpartyId,
              accountNumber: entry.counterpartyIban || "",
              note: [...new Set([entry.counterpartyName, entry.remittance].filter(Boolean))].join(" — "),
              amount: entry.amount,
              direction: entry.direction,
              dueDate: entry.bookingDate,
              payDate: entry.bookingDate,
              recurrence: "once",
              endDate: null,
              viaPaypal: false,
              source: "Bank-import",
              bankRef: entry.ref,
              bankSnapshot: JSON.stringify(snapshot),
              read: false,
              paidDates: [entry.bookingDate],
            });
            const [docRec] = await atCreate(TABLES.items, [{ fields: docFields }]);
            const createdDoc = itemFromRecord(docRec);
            workingItems = [...workingItems, createdDoc];

            const linkedDocIds = [createdDoc.id];
            await atUpdate(TABLES.payments, [{ id: newPayment.id, fields: { GekoppeldeDocumenten: linkedDocIds } }]);
            workingPayments = workingPayments.map((p) => (p.id === newPayment.id ? { ...p, documentIds: linkedDocIds } : p));
            created++;
          } else {
            // Geen match, geen vertrouwde crediteur: betaling blijft
            // ongekoppeld — te bevestigen/koppelen in het Koppelen-scherm.
            proposed++;
          }
        }
      } catch (err) {
        errors++;
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
    setCounterparties(workingCounterparties);
    markSynced();
    setBankResult({ matched, created, proposed, skipped, errors, total: bankParsed.entries.length });
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
      const remainingPaidDates = (wrongItem.paidDates || []).filter((d) => d !== snapshot.bookingDate);
      const wasPurelyBankCreated = wrongItem.recurrence === "once" && remainingPaidDates.length === 0;

      if (wasPurelyBankCreated) {
        await atDelete(TABLES.items, [wrongItem.id]);
        setItems((prev) => prev.filter((i) => i.id !== wrongItem.id));
      } else {
        const fields = { BetaaldeData: JSON.stringify(remainingPaidDates), Bron: "Handmatig", BankRef: "", BankSnapshot: "" };
        await atUpdate(TABLES.items, [{ id: wrongItem.id, fields }]);
        setItems((prev) =>
          prev.map((i) =>
            i.id === wrongItem.id ? { ...i, paidDates: remainingPaidDates, source: "Handmatig", bankRef: "", bankSnapshot: "" } : i
          )
        );
      }

      // --- apply to the correct target item ---
      const targetItem = items.find((i) => i.id === targetItemId);
      if (!targetItem) {
        setAirtableError("Doelpost niet gevonden.");
        return;
      }
      const entryDate = fromISO(snapshot.bookingDate);
      const windowStart = toISO(addDays(entryDate, -10));
      const windowEnd = toISO(addDays(entryDate, 10));
      const occ = generateOccurrences(targetItem, windowStart, windowEnd)
        .filter((o) => !(targetItem.paidDates || []).includes(o.date));
      const matchDate = occ.length > 0
        ? occ.sort((a, b) => Math.abs(fromISO(a.date) - entryDate) - Math.abs(fromISO(b.date) - entryDate))[0].date
        : snapshot.bookingDate;

      const newPaidDates = [...(targetItem.paidDates || []), matchDate];
      const relinkedSnapshot = JSON.stringify({ ...snapshot, wasCreated: false });
      const fields = {
        BetaaldeData: JSON.stringify(newPaidDates),
        Bron: "Bank-import",
        BankRef: snapshot.ref || "",
        BankSnapshot: relinkedSnapshot,
        Gelezen: false,
      };
      await atUpdate(TABLES.items, [{ id: targetItem.id, fields }]);
      setItems((prev) =>
        prev.map((i) =>
          i.id === targetItem.id
            ? { ...i, paidDates: newPaidDates, source: "Bank-import", bankRef: snapshot.ref || "", bankSnapshot: relinkedSnapshot, read: false }
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

      const wasPaid = (duplicateItem.paidDates || []).length > 0;
      const referenceDate = wasPaid
        ? duplicateItem.paidDates.slice().sort().slice(-1)[0]
        : duplicateItem.dueDate;

      if (wasPaid) {
        const refDateObj = fromISO(referenceDate);
        const windowStart = toISO(addDays(refDateObj, -10));
        const windowEnd = toISO(addDays(refDateObj, 10));
        const occ = generateOccurrences(targetItem, windowStart, windowEnd)
          .filter((o) => !(targetItem.paidDates || []).includes(o.date));
        const matchDate = occ.length > 0
          ? occ.sort((a, b) => Math.abs(fromISO(a.date) - refDateObj) - Math.abs(fromISO(b.date) - refDateObj))[0].date
          : referenceDate;
        const newPaidDates = [...(targetItem.paidDates || []), matchDate];
        await atUpdate(TABLES.items, [{ id: targetItem.id, fields: { BetaaldeData: JSON.stringify(newPaidDates) } }]);
        setItems((prev) => prev.map((i) => (i.id === targetItem.id ? { ...i, paidDates: newPaidDates } : i)));
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

  // Koppelt een Betaling aan een Document: legt de wederzijdse link, en werkt
  // (voor achterwaartse compatibiliteit met alle bestaande betaald-logica)
  // ook meteen de BetaaldeData van het document bij, zodat Planning/
  // Crediteuren/Rapport ongewijzigd blijven werken.
  async function linkPaymentToDocument(payment, doc) {
    try {
      const entryDate = fromISO(payment.date);
      const windowStart = toISO(addDays(entryDate, -10));
      const windowEnd = toISO(addDays(entryDate, 10));
      const occ = generateOccurrences(doc, windowStart, windowEnd)
        .filter((o) => !(doc.paidDates || []).includes(o.date));
      const matchDate = occ.length > 0
        ? occ.sort((a, b) => Math.abs(fromISO(a.date) - entryDate) - Math.abs(fromISO(b.date) - entryDate))[0].date
        : payment.date;
      const newPaidDates = [...(doc.paidDates || []), matchDate];
      const newDocPaymentIds = [...(doc.paymentIds || []), payment.id];
      const newPaymentDocIds = [...(payment.documentIds || []), doc.id];

      await Promise.all([
        atUpdate(TABLES.items, [{ id: doc.id, fields: { BetaaldeData: JSON.stringify(newPaidDates), Betalingen: newDocPaymentIds } }]),
        atUpdate(TABLES.payments, [{ id: payment.id, fields: { GekoppeldeDocumenten: newPaymentDocIds } }]),
      ]);

      setItems((prev) => prev.map((i) => (i.id === doc.id ? { ...i, paidDates: newPaidDates, paymentIds: newDocPaymentIds } : i)));
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
        const newDocPaymentIds = (doc.paymentIds || []).filter((id) => id !== payment.id);
        // Verwijder ook de betaald-markering die bij het koppelen werd gezet —
        // anders blijft het document als "betaald" gelden zonder koppeling.
        const paymentDate = fromISO(payment.date);
        const paidDates = doc.paidDates || [];
        let newPaidDates = paidDates;
        if (paidDates.length > 0) {
          const closest = paidDates.slice().sort(
            (a, b) => Math.abs(fromISO(a) - paymentDate) - Math.abs(fromISO(b) - paymentDate)
          )[0];
          newPaidDates = paidDates.filter((d) => d !== closest);
        }
        await atUpdate(TABLES.items, [{ id: doc.id, fields: { Betalingen: newDocPaymentIds, BetaaldeData: JSON.stringify(newPaidDates) } }]);
        setItems((prev) => prev.map((i) => (i.id === doc.id ? { ...i, paymentIds: newDocPaymentIds, paidDates: newPaidDates } : i)));
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
      const fields = paymentToFields({
        description: draft.description || "Handmatige betaling",
        date: draft.date,
        amount: Math.abs(Number(draft.amount)) || 0,
        direction: draft.direction,
        entityId: draft.entityId,
        source: draft.source, // "Cash-handmatig" | "Andere-bank-handmatig"
        bankRef: "",
        raw: null,
        categoryId: null,
        projectId: null,
        documentIds: [],
        noDocumentNeeded: false,
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
  // ontkoppeld (paidDates op de gekoppelde documenten opgeschoond) voor de
  // betaling zelf verdwijnt — zelfde opruimlogica als unlinkPaymentFromDocument.
  async function deletePayment(payment) {
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
        paidDates: [],
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
      const occ = generateOccurrences(item, rangeStart, rangeEnd);
      occ.forEach((o) => {
        const paid = (item.paidDates || []).includes(o.date);
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
  }, [items, filteredEntityIds, rangeStart, rangeEnd]);

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
      const occ = generateOccurrences(item, rangeStart, rangeEnd);
      occ.forEach((o) => {
        const paid = (item.paidDates || []).includes(o.date);
        rows.push({ itemId: item.id, date: o.date, paid, item });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  }, [items, rangeStart, rangeEnd]);
  const allUpcomingRows = allOccurrenceRows.filter((r) => !r.paid && r.date <= rangeEnd);

  // ---- report data: per entity totals + daily net series — ALWAYS all boekhoudingen ----
  const reportEntities = sortedEntities;

  // All-time payment history — every recorded paidDate on every item, regardless
  // of the forward-looking window used elsewhere. This is retrospective, not projected.
  const paymentHistory = useMemo(() => {
    const rows = [];
    items.forEach((item) => {
      (item.paidDates || []).forEach((date) => {
        rows.push({ date, item });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  }, [items]);

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

  const grandTotal = reportTotals.reduce(
    (acc, r) => ({ inSum: acc.inSum + r.inSum, uitSum: acc.uitSum + r.uitSum, net: acc.net + r.net }),
    { inSum: 0, uitSum: 0, net: 0 }
  );

  // ---- counterparties (debiteuren/crediteuren) — kept as a separate normalized list
  // so it can later be split into its own file/table without restructuring anything else.
  const counterpartyById = useMemo(() => {
    const m = {};
    counterparties.forEach((c) => (m[c.id] = c));
    return m;
  }, [counterparties]);

  async function resolveCounterpartyId(rawName) {
    const trimmed = (rawName || "").trim();
    if (!trimmed) return null;
    const existing = counterparties.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const [rec] = await atCreate(TABLES.counterparties, [{ fields: { Naam: trimmed } }]);
    const created = counterpartyFromRecord(rec);
    setCounterparties((prev) => [...prev, created]);
    return created.id;
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
        paidDates: editingId ? items.find((i) => i.id === editingId)?.paidDates || [] : [],
      };
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
      const fields = itemToFields({ ...item, paidDates: [] });
      const [rec] = await atCreate(TABLES.items, [{ fields }]);
      const created = itemFromRecord(rec);
      setItems((prev) => [...prev, created]);
      markSynced();
      startEdit(created);
    } catch (err) {
      setAirtableError(err.message);
    }
  }

  async function togglePaid(itemId, date) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const paidDates = new Set(item.paidDates || []);
    if (paidDates.has(date)) paidDates.delete(date);
    else paidDates.add(date);
    const nextPaidDates = Array.from(paidDates);
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, paidDates: nextPaidDates } : i)));
    try {
      await atUpdate(TABLES.items, [{ id: itemId, fields: { BetaaldeData: JSON.stringify(nextPaidDates) } }]);
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
  }, [sortedEntities, entities, allUpcomingRows]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Verbinden met Airtable…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <div className="max-w-3xl mx-auto px-4 pb-28">
        {/* Header */}
        <header className="pt-6 pb-4 sticky top-0 bg-slate-50/95 backdrop-blur z-20">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
                Cashflow
                <span className="text-[11px] font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                  v{APP_VERSION}
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Te betalen &amp; te ontvangen, per boekhouding</p>
            </div>
            <div className="flex bg-white border border-slate-200 rounded-full p-0.5 text-sm overflow-x-auto max-w-full">
              <button
                onClick={() => setView("planning")}
                className={`px-3 py-1.5 rounded-full transition ${view === "planning" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Planning
              </button>
              <button
                onClick={() => setView("rapport")}
                className={`px-3 py-1.5 rounded-full transition ${view === "rapport" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Rapport
              </button>
              <button
                onClick={() => setView("grafiek")}
                className={`px-3 py-1.5 rounded-full transition ${view === "grafiek" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Grafiek
              </button>
              <button
                onClick={() => setView("crediteuren")}
                className={`px-3 py-1.5 rounded-full transition ${view === "crediteuren" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Crediteuren
              </button>
              <button
                onClick={() => setView("afpunten")}
                className={`px-3 py-1.5 rounded-full transition ${view === "afpunten" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Afpunten{unreadCount > 0 ? ` (${unreadCount})` : ""}
              </button>
              <button
                onClick={() => setView("koppelen")}
                className={`px-3 py-1.5 rounded-full transition ${view === "koppelen" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Koppelen
              </button>
              <button
                onClick={() => setView("boekhoudingen")}
                className={`px-3 py-1.5 rounded-full transition ${view === "boekhoudingen" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Boekhoudingen
              </button>
            </div>
          </div>

          <div className="mt-3">
            <button
              onClick={openNewItemForm}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Nieuwe post (factuur / inkomst)
            </button>
          </div>

          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
            {offlineMode ? (
              <span className="text-amber-600">Offline — laatste lokale kopie getoond, niet gesynchroniseerd met Airtable</span>
            ) : lastSyncedAt ? (
              <span className={syncToast ? "text-emerald-600 font-medium" : ""}>
                {syncToast ? "● Gesynchroniseerd met Airtable" : `Laatst gesynchroniseerd: ${new Date(lastSyncedAt).toLocaleTimeString("nl-BE")}`}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={exportData}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600"
            >
              <Download className="w-3.5 h-3.5" /> Exporteer JSON
            </button>
            <button
              onClick={triggerImport}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600"
              title="Importeert als nieuwe records in Airtable"
            >
              <Upload className="w-3.5 h-3.5" /> Importeer JSON
            </button>
            <button
              onClick={openBankModal}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600"
              title="CAMT.053 bankuittreksel inlezen en matchen"
            >
              <Landmark className="w-3.5 h-3.5" /> Bank importeren
            </button>
            <button
              onClick={triggerPocketsmithSync}
              disabled={pocketsmithSyncing}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
              title="Haalt nieuwe transacties op via PocketSmith en matcht/maakt posten aan"
            >
              {pocketsmithSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              PocketSmith syncen
            </button>
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

          {/* Entity tabs */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
            <button
              onClick={() => setActiveEntity("all")}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition ${
                activeEntity === "all"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              Alle
            </button>
            {sortedEntities.map((e) => {
              const c = entityColor(e);
              const active = activeEntity === e.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setActiveEntity(e.id)}
                  className="shrink-0 px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition"
                  style={
                    active
                      ? { background: c.dot, borderColor: c.dot, color: "white" }
                      : { background: "white", borderColor: "#E2E8F0", color: "#475569" }
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? "white" : c.dot }} />
                  {e.name}
                </button>
              );
            })}
            <button
              onClick={() => setView("boekhoudingen")}
              className="shrink-0 px-3 py-1.5 rounded-full text-sm border border-dashed border-slate-300 text-slate-400 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Boekhouding
            </button>
          </div>

          {view === "crediteuren" && (
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
                          onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem} overdue showDate
                          onCounterpartyClick={goToCounterparty} />
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
                    <p className={`text-xs font-medium ${date < todayISO() ? "text-rose-600" : "text-slate-500"}`}>
                      {formatDateLabel(date)}
                    </p>
                    <p className="text-xs font-medium shrink-0">
                      {dateIn > 0 && dateUit > 0 && (
                        <span className="text-slate-400 font-normal mr-1.5">
                          +{eur(dateIn)} / −{eur(dateUit)}
                        </span>
                      )}
                      <span className={dateNet >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {dateNet >= 0 ? "+" : ""}{eur(dateNet)}
                      </span>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((r) => (
                      <React.Fragment key={`${r.itemId}-${r.date}`}>
                        <ItemRow row={r} entity={entityById[r.item.entityId]}
                          counterparty={r.item.counterpartyId ? counterpartyById[r.item.counterpartyId] : null}
                          onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem}
                          onCounterpartyClick={goToCounterparty} />
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
                        onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem}
                        onCounterpartyClick={goToCounterparty} />
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
        ) : view === "rapport" ? (
          <ReportView
            reportTotals={reportTotals}
            grandTotal={grandTotal}
            showGrand={reportEntities.length > 1}
            entities={reportEntities}
            runningBalances={runningBalances}
            counterpartyById={counterpartyById}
            paymentHistory={paymentHistory}
            entityById={entityById}
          />
        ) : view === "grafiek" ? (
          <ChartView
            runningBalances={runningBalances}
            activeEntity={activeEntity}
            entities={sortedEntities}
          />
        ) : view === "crediteuren" ? (
          <CounterpartyView
            items={items}
            counterparties={counterparties}
            entities={sortedEntities}
            entityById={entityById}
            filteredEntityIds={filteredEntityIds}
            onTogglePaid={togglePaid}
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
          />
        ) : view === "afpunten" ? (
          <ReconciliationView
            items={items}
            entityById={entityById}
            counterpartyById={counterpartyById}
            filteredEntityIds={filteredEntityIds}
            onRelink={relinkBankEntry}
            onMarkRead={markRead}
          />
        ) : view === "koppelen" ? (
          <KoppelenView
            items={items}
            payments={payments}
            entities={sortedEntities}
            entityById={entityById}
            counterpartyById={counterpartyById}
            filteredEntityIds={filteredEntityIds}
            activeEntity={activeEntity}
            onLink={linkPaymentToDocument}
            onUnlink={unlinkPaymentFromDocument}
            onToggleNoDocNeeded={toggleNoDocumentNeeded}
            onAddManualPayment={addManualPayment}
            onCreateDocFromPayment={createDocumentFromPayment}
            onResolveCounterparty={resolveCounterpartyId}
            onDeletePayment={deletePayment}
            onBackfill={backfillHistoricBankPayments}
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
            onRemoveEntity={removeEntity}
            lastUpdateByEntity={lastUpdateByEntity}
          />
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
              CAMT.053 XML-bestand van je bank. Verrichtingen die matchen met een openstaande post worden als betaald gemarkeerd; alles wat niet matcht wordt automatisch als nieuwe, al-betaalde post aangemaakt.
            </p>

            {!bankParsed && !bankResult && (
              <>
                <button
                  onClick={() => bankFileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-200 rounded-lg py-6 text-sm text-slate-500 hover:border-slate-300"
                >
                  Klik om een .XML-bestand te kiezen
                </button>
                <input ref={bankFileInputRef} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={handleBankFile} />
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
                  <p className="text-slate-700 font-medium">{bankParsed.accountName || "Onbekende rekening"}</p>
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
                  <p>{bankResult.created} document automatisch aangemaakt (vertrouwde crediteur)</p>
                  {bankResult.proposed > 0 && <p>{bankResult.proposed} betaling(en) wachten in "Koppelen" — geen match, geen vertrouwde crediteur</p>}
                  {bankResult.skipped > 0 && <p>{bankResult.skipped} overgeslagen (al eerder geïmporteerd)</p>}
                  {bankResult.errors > 0 && <p className="text-rose-600">{bankResult.errors} mislukt</p>}
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

    </div>
  );
}

// ---------- subcomponents ----------

function SummaryCard({ label, value, tone, isCount }) {
  const color = tone === "pos" ? "#047857" : "#BE123C";
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-sm font-semibold mt-0.5" style={{ color: isCount ? "#334155" : color }}>
        {isCount ? value : eur(value)}
      </p>
    </div>
  );
}

function ItemRow({ row, entity, counterparty, onTogglePaid, onEdit, onDelete, onDuplicate, overdue, showDate, onCounterpartyClick }) {
  const c = entityColor(entity);
  const isIn = row.item.direction === "in";
  return (
    <div className={`flex items-center gap-2.5 bg-white border rounded-lg px-3 py-2.5 ${overdue ? "border-rose-200" : "border-slate-200"}`}>
      <button
        onClick={() => onTogglePaid(row.itemId, row.date)}
        className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition ${
          row.paid ? "bg-emerald-500 border-emerald-500" : "border-slate-300"
        }`}
        title={row.paid ? "Markeer als niet betaald" : "Markeer als betaald"}
      >
        {row.paid && <Check className="w-3 h-3 text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
          <span className="text-xs text-slate-400 truncate">{entity?.name || "?"}</span>
          {showDate && <span className="text-xs text-rose-500 font-medium shrink-0">{formatDateLabel(row.displayDate)}</span>}
          {row.item.recurrence !== "once" && <RotateCcw className="w-3 h-3 text-slate-300 shrink-0" />}
          {row.item.viaPaypal && (
            <span className="text-[10px] font-medium text-[#003087] bg-[#e6ecff] rounded px-1 py-0.5 shrink-0">PayPal</span>
          )}
          {row.item.source === "Bank-import" && (
            <span className="text-[10px] font-medium text-teal-600 bg-teal-50 rounded px-1 py-0.5 shrink-0">Bank</span>
          )}
          {row.item.source === "Billtobox" && (
            <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 rounded px-1 py-0.5 shrink-0">Billtobox</span>
          )}
        </div>
        <p className={`text-sm truncate ${row.paid ? "line-through text-slate-400" : "text-slate-800"}`}>
          {row.item.description}
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
        <p className="text-[11px] text-slate-400 truncate">
          Verval: {row.date}
          {row.item.payDate && row.item.payDate !== row.item.dueDate && <> · Betaal: {row.item.payDate}</>}
          {row.item.invoiceDate && <> · Fact.: {row.item.invoiceDate}</>}
        </p>
        {(row.item.accountNumber || row.item.note) && (
          <p className="text-[11px] text-slate-400 truncate">
            {row.item.accountNumber && <span className="font-mono">{row.item.accountNumber}</span>}
            {row.item.accountNumber && row.item.note && " · "}
            {row.item.note}
          </p>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm font-medium ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
          {isIn ? "+" : "−"}{eur(row.item.amount)}
        </p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => onEdit(row.item)} className="p-1 text-slate-300 hover:text-slate-600">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDuplicate(row.item)} className="p-1 text-slate-300 hover:text-slate-600" title="Dupliceren">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(row.itemId)} className="p-1 text-slate-300 hover:text-rose-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
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

      <input
        value={form.counterparty}
        onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
        placeholder="Debiteur / crediteur (optioneel, bv. Elektriciteitsleverancier X)"
        list="counterparty-suggestions"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
      />
      <datalist id="counterparty-suggestions">
        {counterparties.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>

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

function ReportView({ reportTotals, grandTotal, showGrand, entities, runningBalances, counterpartyById, paymentHistory, entityById }) {
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
                          {row.item.description}{cp ? ` — ${cp.name}` : ""}
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
                              {row.item.description}{cp ? ` — ${cp.name}` : ""}
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
                      {cp && <span className="text-slate-400"> — {cp.name}</span>}
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
  items, payments, entities, entityById, counterpartyById, filteredEntityIds, activeEntity,
  onLink, onUnlink, onToggleNoDocNeeded, onAddManualPayment, onCreateDocFromPayment, onResolveCounterparty, onDeletePayment, onBackfill,
}) {
  const [selectedPaymentId, setSelectedPaymentId] = useState(null);
  const [showLinked, setShowLinked] = useState(false);
  const [showUnlinkedPayments, setShowUnlinkedPayments] = useState(true);
  const [showUnlinkedDocs, setShowUnlinkedDocs] = useState(true);
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [newPayment, setNewPayment] = useState({
    description: "", date: todayISO(), amount: "", direction: "uit",
    entityId: activeEntity !== "all" ? activeEntity : "", source: "Cash-handmatig",
  });
  const [adding, setAdding] = useState(false);
  const [creatingDocForId, setCreatingDocForId] = useState(null);
  const [docDraft, setDocDraft] = useState({ description: "", counterpartyName: "" });
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  const unlinkedPayments = payments
    .filter((p) => filteredEntityIds.includes(p.entityId) && (p.documentIds || []).length === 0 && !p.noDocumentNeeded)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const unlinkedDocs = items
    .filter((it) =>
      filteredEntityIds.includes(it.entityId) &&
      (it.paymentIds || []).length === 0 &&
      (it.paidDates || []).length === 0
    )
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const linkedPayments = payments
    .filter((p) => filteredEntityIds.includes(p.entityId) && (p.documentIds || []).length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const selectedPayment = unlinkedPayments.find((p) => p.id === selectedPaymentId) || null;

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

      {/* Sectie 1: Betalingen */}
      <div>
        <button
          onClick={() => setShowUnlinkedPayments((s) => !s)}
          className="w-full flex items-center justify-between mb-1.5"
        >
          <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <ChevronDown className={`w-3.5 h-3.5 text-slate-300 transition-transform ${showUnlinkedPayments ? "rotate-180" : ""}`} />
            Ongekoppelde betalingen ({unlinkedPayments.length})
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); setShowNewPayment((s) => !s); }}
            className="text-xs text-slate-400 underline decoration-dotted"
          >
            + Nieuwe betaling
          </span>
        </button>

        {showNewPayment && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 mb-2 space-y-2">
            <input
              value={newPayment.description}
              onChange={(e) => setNewPayment({ ...newPayment, description: e.target.value })}
              placeholder="Omschrijving"
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-slate-400"
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
                await onAddManualPayment(newPayment);
                setAdding(false);
                setShowNewPayment(false);
                setNewPayment({ description: "", date: todayISO(), amount: "", direction: "uit", entityId: activeEntity !== "all" ? activeEntity : "", source: "Cash-handmatig" });
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
              const selected = selectedPaymentId === p.id;
              const isCreatingDocRow = creatingDocForId === p.id;
              return (
                <React.Fragment key={p.id}>
                <div
                  onClick={() => setSelectedPaymentId(selected ? null : p.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer ${selected ? "bg-slate-900/5" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 truncate">{p.description}</p>
                    <p className="text-[11px] text-slate-400">{entity?.name} · {p.date} · {p.source}</p>
                  </div>
                  <span className={`text-sm font-medium shrink-0 ${p.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                    {p.direction === "in" ? "+" : "−"}{eur(p.amount)}
                  </span>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
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
        {showUnlinkedDocs && (unlinkedDocs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4 bg-white border border-slate-200 rounded-xl">Niets openstaand.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-50">
            {unlinkedDocs.map((doc) => {
              const entity = entityById[doc.entityId];
              const cp = doc.counterpartyId ? counterpartyById[doc.counterpartyId] : null;
              return (
                <div
                  key={doc.id}
                  onClick={async () => {
                    if (!selectedPayment) return;
                    await onLink(selectedPayment, doc);
                    setSelectedPaymentId(null);
                  }}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 ${selectedPayment ? "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 truncate">{doc.description}{cp ? ` — ${cp.name}` : ""}</p>
                    <p className="text-[11px] text-slate-400">{entity?.name} · Verval: {doc.dueDate}</p>
                  </div>
                  <span className={`text-sm font-medium shrink-0 ${doc.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                    {doc.direction === "in" ? "+" : "−"}{eur(doc.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
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
                return (
                  <div key={p.id} className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800 truncate">{p.description}</p>
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
                            <span className="text-[11px] text-slate-600 truncate">
                              → {doc ? doc.description : "(document niet gevonden)"}
                            </span>
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
  onUpdateEntityFieldLocal, onCommitEntityIban, onCommitEntityPocketsmith,
  onRemoveEntity, lastUpdateByEntity,
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
                {(lastUpdateByEntity[e.id]?.bank || lastUpdateByEntity[e.id]?.billtobox) && (
                  <p className="text-[11px] text-slate-400 pl-5 mt-1.5">
                    {lastUpdateByEntity[e.id]?.bank && <>Laatste bank: {lastUpdateByEntity[e.id].bank}</>}
                    {lastUpdateByEntity[e.id]?.bank && lastUpdateByEntity[e.id]?.billtobox && " · "}
                    {lastUpdateByEntity[e.id]?.billtobox && <>Laatste Billtobox: {lastUpdateByEntity[e.id].billtobox}</>}
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

function ReconciliationView({ items, entityById, counterpartyById, filteredEntityIds, onRelink, onMarkRead }) {
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
                      <p className="text-sm text-slate-800 truncate">{item.description}{cp ? ` — ${cp.name}` : ""}</p>
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

function CounterpartyView({ items, counterparties, entities, entityById, filteredEntityIds, onTogglePaid, onEdit, onDelete, onDuplicate, editingId, form, setForm, onSubmit, onCancel, onApplyMappings, nameMappings, onAddMapping, onUpdateMappingLocal, onCommitMapping, onDeleteMapping, jumpToCounterpartyId, onJumpHandled, onRelink, onMerge }) {
  const [openId, setOpenId] = useState(jumpToCounterpartyId || null);
  const [relinkingId, setRelinkingId] = useState(null);
  const [relinkTargetId, setRelinkTargetId] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [showMappings, setShowMappings] = useState(false);
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

  const groups = useMemo(() => {
    const byId = {};
    counterparties.forEach((c) => { byId[c.id] = { counterparty: c, items: [] }; });
    const zonder = [];
    scoped.forEach((it) => {
      if (it.counterpartyId && byId[it.counterpartyId]) byId[it.counterpartyId].items.push(it);
      else zonder.push(it);
    });
    const list = Object.values(byId)
      .filter((g) => g.items.length > 0)
      .sort((a, b) => a.counterparty.name.localeCompare(b.counterparty.name));
    return { list, zonder };
  }, [scoped, counterparties]);

  const mappingBar = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Alle posten per debiteur/crediteur, ongeacht betaalstatus</p>
        <div className="flex items-center gap-1.5 shrink-0">
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
      {groups.list.map(({ counterparty, items: cpItems }) => {
        const totalIn = cpItems.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0);
        const totalUit = cpItems.filter((i) => i.direction === "uit").reduce((s, i) => s + i.amount, 0);
        const open = openId === counterparty.id;
        return (
          <div key={counterparty.id} id={`crediteur-${counterparty.id}`} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenId(open ? null : counterparty.id)}
              className="w-full flex items-center justify-between px-3.5 py-3 text-left"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">{counterparty.name}</p>
                <p className="text-[11px] text-slate-400">{cpItems.length} post{cpItems.length !== 1 ? "en" : ""}</p>
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
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {cpItems
                  .slice()
                  .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
                  .map((item) => {
                    const entity = entityById[item.entityId];
                    const c = entityColor(entity);
                    const isIn = item.direction === "in";
                    const paidDates = item.paidDates || [];
                    const isPaidOnce = item.recurrence === "once" && paidDates.includes(item.dueDate);
                    const lastPaid = paidDates.length > 0 ? paidDates.slice().sort().slice(-1)[0] : null;

                    // Voor herhalende posten: welke vervaldatum raakt een klik?
                    // De datum die het dichtst bij vandaag ligt, betaald of niet.
                    let nearestOccurrenceDate = item.dueDate;
                    let nearestOccurrencePaid = lastPaid !== null;
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
                        nearestOccurrencePaid = paidDates.includes(nearestOccurrenceDate);
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
                        </div>
                        <p className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                          {isIn ? "+" : "−"}{eur(item.amount)}
                        </p>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => { setRelinkingId(relinkingId === item.id ? null : item.id); setRelinkTargetId(""); }}
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
                    </div>
                    <span className={`text-sm font-medium shrink-0 ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                      {isIn ? "+" : "−"}{eur(item.amount)}
                    </span>
                    <button onClick={() => onEdit(item)} className="p-1 text-slate-300 hover:text-slate-600 shrink-0">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
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

