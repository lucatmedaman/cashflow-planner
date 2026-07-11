import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, Building2, ChevronDown, X, Edit2, Copy,
  TrendingUp, TrendingDown, RotateCcw, AlertCircle,
  Download, Upload, Loader2, RefreshCw, Landmark
} from "lucide-react";
import { TABLES, atListAll, atCreate, atUpdate, atDelete } from "./airtable";

// ---------- constants ----------

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

// ---------- Airtable <-> local model mapping ----------
// Airtable record IDs (recXXXXXXXXXXXXXXX) are used directly as our local
// entity/counterparty/item ids once synced — no separate id-mapping table needed.

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
    colorIdx: colorIdxFromId(r.id),
  };
}
function counterpartyFromRecord(r) {
  return { id: r.id, name: r.fields.Naam || "" };
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
    invoiceDate: r.fields.Factuurdatum || null,
    recurrence: r.fields.Herhaling || "once",
    endDate: r.fields.Einddatum || null,
    viaPaypal: !!r.fields.ViaPayPal,
    source: r.fields.Bron || "Handmatig",
    bankRef: r.fields.BankRef || "",
    bankSnapshot: r.fields.BankSnapshot || "",
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
    Factuurdatum: item.invoiceDate || null,
    Herhaling: item.recurrence,
    Einddatum: item.endDate || null,
    ViaPayPal: !!item.viaPaypal,
    Bron: item.source || "Handmatig",
    BankRef: item.bankRef || "",
    BankSnapshot: item.bankSnapshot || "",
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

  return { iban, accountName, entries };
}

// ---------- main component ----------

export default function CashflowPlanner() {
  const [entities, setEntities] = useState([]);
  const [items, setItems] = useState([]);
  const [counterparties, setCounterparties] = useState([]);

  const [loading, setLoading] = useState(true);
  const [airtableError, setAirtableError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncToast, setSyncToast] = useState(false);

  const [view, setView] = useState("planning"); // planning | rapport
  const [activeEntity, setActiveEntity] = useState("all");
  const [windowDays, setWindowDays] = useState(60);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showEntityModal, setShowEntityModal] = useState(false);
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
    const [entRecs, cpRecs, itemRecs] = await Promise.all([
      atListAll(TABLES.entities),
      atListAll(TABLES.counterparties),
      atListAll(TABLES.items),
    ]);
    return {
      entities: entRecs.map(entityFromRecord),
      counterparties: cpRecs.map(counterpartyFromRecord),
      items: itemRecs.map(itemFromRecord),
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

  async function confirmBankImport() {
    if (!bankParsed || !bankEntityId) return;
    setBankImporting(true);
    setBankError("");
    let matched = 0, created = 0, skipped = 0, errors = 0;

    // Work off a local snapshot so matches within this same import don't
    // collide with each other before React state catches up.
    let workingItems = items;

    for (const entry of bankParsed.entries) {
      try {
        const alreadyImported = entry.ref && workingItems.some((i) => i.bankRef === entry.ref);
        if (alreadyImported) { skipped++; continue; }

        const snapshot = JSON.stringify(entry);

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

        if (matchedItem) {
          const newPaidDates = [...(matchedItem.paidDates || []), matchedDate];
          const fields = {
            BetaaldeData: JSON.stringify(newPaidDates),
            Bron: "Bank-import",
            BankRef: entry.ref,
            BankSnapshot: snapshot,
          };
          await atUpdate(TABLES.items, [{ id: matchedItem.id, fields }]);
          workingItems = workingItems.map((i) =>
            i.id === matchedItem.id
              ? { ...i, paidDates: newPaidDates, source: "Bank-import", bankRef: entry.ref, bankSnapshot: snapshot }
              : i
          );
          matched++;
        } else {
          const counterpartyId = entry.counterpartyName ? await resolveCounterpartyId(entry.counterpartyName) : null;
          const fields = itemToFields({
            description: entry.counterpartyName || (entry.remittance || "Bankverrichting").slice(0, 80),
            entityId: bankEntityId,
            counterpartyId,
            accountNumber: entry.counterpartyIban || "",
            note: entry.remittance || "",
            amount: entry.amount,
            direction: entry.direction,
            dueDate: entry.bookingDate,
            recurrence: "once",
            endDate: null,
            viaPaypal: false,
            source: "Bank-import",
            bankRef: entry.ref,
            bankSnapshot: snapshot,
            paidDates: [entry.bookingDate],
          });
          const [rec] = await atCreate(TABLES.items, [{ fields }]);
          const createdItem = itemFromRecord(rec);
          workingItems = [...workingItems, createdItem];
          created++;
        }
      } catch (err) {
        errors++;
      }
    }

    setItems(workingItems);
    markSynced();
    setBankResult({ matched, created, skipped, errors, total: bankParsed.entries.length });
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
      const fields = {
        BetaaldeData: JSON.stringify(newPaidDates),
        Bron: "Bank-import",
        BankRef: snapshot.ref || "",
        BankSnapshot: JSON.stringify(snapshot),
      };
      await atUpdate(TABLES.items, [{ id: targetItem.id, fields }]);
      setItems((prev) =>
        prev.map((i) =>
          i.id === targetItem.id
            ? { ...i, paidDates: newPaidDates, source: "Bank-import", bankRef: snapshot.ref || "", bankSnapshot: JSON.stringify(snapshot) }
            : i
        )
      );
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

  const filteredEntityIds = activeEntity === "all" ? sortedEntities.map((e) => e.id) : [activeEntity];

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
        rows.push({ itemId: item.id, date: o.date, paid, item });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  }, [items, filteredEntityIds, rangeStart, rangeEnd]);

  const upcomingRows = occurrenceRows.filter((r) => !r.paid && r.date <= rangeEnd);
  const recentPaidRows = occurrenceRows
    .filter((r) => r.paid && r.date >= toISO(addDays(new Date(), -14)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const groupedByDate = useMemo(() => {
    const groups = {};
    upcomingRows.forEach((r) => {
      if (!groups[r.date]) groups[r.date] = [];
      groups[r.date].push(r);
    });
    return Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [upcomingRows]);

  // ---- summary numbers (within window, unpaid + today..end only, excludes overdue-before-today for "upcoming" totals) ----
  const windowFutureRows = upcomingRows.filter((r) => r.date >= todayISO());
  const overdueRows = upcomingRows.filter((r) => r.date < todayISO());

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
      setShowEntityModal(false);
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
    const perEntity = sortedEntities.map((e) => {
      const rows = allUpcomingRows
        .filter((r) => r.item.entityId === e.id)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      let balance = e.openingBalance || 0;
      const ledger = rows.map((r) => {
        const delta = r.item.direction === "in" ? Number(r.item.amount) : -Number(r.item.amount);
        balance += delta;
        return { ...r, delta, balance };
      });
      return { entity: e, opening: e.openingBalance || 0, ledger, ending: balance };
    });

    const combinedRows = allUpcomingRows
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const combinedOpening = entities.reduce((sum, e) => sum + (e.openingBalance || 0), 0);
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
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Cashflow</h1>
              <p className="text-xs text-slate-500 mt-0.5">Te betalen &amp; te ontvangen, per boekhouding</p>
            </div>
            <div className="flex bg-white border border-slate-200 rounded-full p-0.5 text-sm">
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
                onClick={() => setView("crediteuren")}
                className={`px-3 py-1.5 rounded-full transition ${view === "crediteuren" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Crediteuren
              </button>
              <button
                onClick={() => setView("afpunten")}
                className={`px-3 py-1.5 rounded-full transition ${view === "afpunten" ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                Afpunten
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
              onClick={() => setShowEntityModal(true)}
              className="shrink-0 px-3 py-1.5 rounded-full text-sm border border-dashed border-slate-300 text-slate-400 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Boekhouding
            </button>
          </div>
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
                          onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem} overdue showDate />
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
              {groupedByDate.map(([date, rows]) => (
                <div key={date}>
                  <p className={`text-xs font-medium mb-1.5 ${date < todayISO() ? "text-rose-600" : "text-slate-500"}`}>
                    {formatDateLabel(date)}
                  </p>
                  <div className="space-y-1.5">
                    {rows.map((r) => (
                      <React.Fragment key={`${r.itemId}-${r.date}`}>
                        <ItemRow row={r} entity={entityById[r.item.entityId]}
                          counterparty={r.item.counterpartyId ? counterpartyById[r.item.counterpartyId] : null}
                          onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem} />
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
              ))}
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
                        onTogglePaid={togglePaid} onEdit={startEdit} onDelete={deleteItem} onDuplicate={duplicateItem} />
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
          />
        ) : (
          <ReconciliationView
            items={items}
            entityById={entityById}
            counterpartyById={counterpartyById}
            filteredEntityIds={filteredEntityIds}
            onRelink={relinkBankEntry}
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
                  <p>{bankResult.matched} gematcht met bestaande posten</p>
                  <p>{bankResult.created} nieuwe posten aangemaakt</p>
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

      {/* Entity modal */}
      {showEntityModal && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-30" onClick={() => setShowEntityModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:w-96" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-slate-900 flex items-center gap-2"><Building2 className="w-4 h-4" /> Nieuwe boekhouding</h3>
              <button onClick={() => setShowEntityModal(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <input
              autoFocus
              value={newEntityName}
              onChange={(e) => setNewEntityName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEntity()}
              placeholder="Naam (bv. O&O, Dr. Luc Belmans BV)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-slate-400"
            />
            <div className="flex gap-2">
              <button onClick={addEntity} className="flex-1 bg-slate-900 text-white rounded-lg py-2 text-sm font-medium">Toevoegen</button>
              <button onClick={() => setShowEntityModal(false)} className="px-4 rounded-lg border border-slate-200 text-sm">Annuleer</button>
            </div>
            {sortedEntities.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-2">Bestaande boekhoudingen &amp; startsaldo</p>
                <div className="space-y-2">
                  {sortedEntities.map((e, idx) => (
                    <div key={e.id} className="border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                      <div className="flex items-center justify-between gap-2 text-sm py-1">
                        <div className="flex flex-col shrink-0 -my-1">
                          <button
                            onClick={() => moveEntity(e.id, -1)}
                            disabled={idx === 0}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-20 disabled:hover:text-slate-300 leading-none"
                            title="Naar boven"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveEntity(e.id, 1)}
                            disabled={idx === sortedEntities.length - 1}
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
                          onChange={(ev) => updateOpeningBalanceLocal(e.id, ev.target.value)}
                          onBlur={() => commitOpeningBalance(e.id)}
                          className="w-24 border border-slate-200 rounded-md px-2 py-1 text-xs text-right outline-none focus:border-slate-400"
                          title="Huidig saldo op deze rekening"
                        />
                        <button onClick={() => removeEntity(e.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-5 mt-0.5">
                        <input
                          value={e.iban || ""}
                          onChange={(ev) => updateEntityFieldLocal(e.id, "iban", ev.target.value)}
                          onBlur={() => commitEntityIban(e.id)}
                          placeholder="IBAN (voor bank-import)"
                          className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-mono outline-none focus:border-slate-400"
                        />
                        <input
                          value={e.pocketsmithAccount || ""}
                          onChange={(ev) => updateEntityFieldLocal(e.id, "pocketsmithAccount", ev.target.value)}
                          onBlur={() => commitEntityPocketsmith(e.id)}
                          placeholder="PocketSmith-rekeningnaam"
                          className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1 text-[11px] outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Startsaldo = je actuele banksaldo vandaag. Wordt gebruikt voor het lopend saldo in het Rapport. IBAN en PocketSmith-rekening koppelen automatische bank-import aan de juiste boekhouding.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- subcomponents ----------

function SummaryCard({ label, value, tone }) {
  const color = tone === "pos" ? "#047857" : "#BE123C";
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-sm font-semibold mt-0.5" style={{ color }}>{eur(value)}</p>
    </div>
  );
}

function ItemRow({ row, entity, counterparty, onTogglePaid, onEdit, onDelete, onDuplicate, overdue, showDate }) {
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
          {showDate && <span className="text-xs text-rose-500 font-medium shrink-0">{formatDateLabel(row.date)}</span>}
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
          {counterparty && <span className="text-slate-400 font-normal"> — {counterparty.name}</span>}
        </p>
        {(row.item.accountNumber || row.item.note || row.item.invoiceDate) && (
          <p className="text-[11px] text-slate-400 truncate">
            {row.item.invoiceDate && <span>Fact.: {row.item.invoiceDate}</span>}
            {row.item.invoiceDate && (row.item.accountNumber || row.item.note) && " · "}
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
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400"
            required
          />
        </div>
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
                  <p className="text-[11px] text-slate-400">Startsaldo (vandaag, alle rekeningen)</p>
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
                    return (
                      <div key={`${row.itemId}-${row.date}`} className="flex items-center justify-between text-xs py-1 border-b border-slate-800 last:border-0">
                        <span className="text-slate-500 shrink-0 w-16">{row.date.slice(5)}</span>
                        <span className="flex-1 min-w-0 truncate text-slate-300 px-2">
                          {row.item.description}{cp ? ` — ${cp.name}` : ""}
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
                      <p className="text-[11px] text-slate-400">Startsaldo (vandaag)</p>
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
                        return (
                          <div key={`${row.itemId}-${row.date}`} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                            <span className="text-slate-400 shrink-0 w-16">{row.date.slice(5)}</span>
                            <span className="flex-1 min-w-0 truncate text-slate-600 px-2">
                              {row.item.description}{cp ? ` — ${cp.name}` : ""}
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

function ReconciliationView({ items, entityById, counterpartyById, filteredEntityIds, onRelink }) {
  const [relinkingId, setRelinkingId] = useState(null);
  const [targetId, setTargetId] = useState("");

  const bankItems = items
    .filter((i) => i.source === "Bank-import" && filteredEntityIds.includes(i.entityId) && i.bankSnapshot)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  if (bankItems.length === 0) {
    return (
      <p className="mt-8 text-sm text-slate-400 text-center py-10">
        Nog geen bank-import om af te punten. Gebruik eerst "Bank importeren" bovenaan.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-slate-400">
        Bank-verrichtingen naast de post waaraan ze gekoppeld werden. Klopt de koppeling niet, herkoppel dan naar de juiste post.
      </p>
      {bankItems.map((item) => {
        let snapshot = null;
        try {
          snapshot = JSON.parse(item.bankSnapshot);
        } catch (e) {}
        const entity = entityById[item.entityId];
        const cp = item.counterpartyId ? counterpartyById[item.counterpartyId] : null;
        const relinking = relinkingId === item.id;

        const candidates = items.filter(
          (i) => i.id !== item.id && i.entityId === item.entityId && i.direction === item.direction
        );

        return (
          <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Bank zei</p>
                <p className="text-slate-700">{snapshot?.counterpartyName || snapshot?.remittance || "—"}</p>
                <p className="text-slate-400">{snapshot?.bookingDate} · {eur(snapshot?.amount || 0)}</p>
                {snapshot?.remittance && <p className="text-slate-400 truncate mt-0.5">{snapshot.remittance}</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Gekoppeld aan</p>
                <p className="text-slate-700 truncate">{item.description}{cp ? ` — ${cp.name}` : ""}</p>
                <p className="text-slate-400">{entity?.name} · {eur(item.amount)}</p>
              </div>
            </div>

            {!relinking ? (
              <button
                onClick={() => { setRelinkingId(item.id); setTargetId(""); }}
                className="mt-2 text-xs text-slate-400 underline decoration-dotted"
              >
                Klopt niet — herkoppelen
              </button>
            ) : (
              <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
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
                      if (!targetId) return;
                      await onRelink(item, targetId);
                      setRelinkingId(null);
                    }}
                    disabled={!targetId}
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
        );
      })}
    </div>
  );
}

function CounterpartyView({ items, counterparties, entities, entityById, filteredEntityIds, onTogglePaid, onEdit, onDelete, onDuplicate, editingId, form, setForm, onSubmit, onCancel }) {
  const [openId, setOpenId] = useState(null);

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

  if (groups.list.length === 0) {
    return <p className="mt-8 text-sm text-slate-400 text-center py-10">Nog geen posten met een debiteur/crediteur gekoppeld.</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-slate-400">Alle posten per debiteur/crediteur, ongeacht betaalstatus</p>
      {groups.list.map(({ counterparty, items: cpItems }) => {
        const totalIn = cpItems.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0);
        const totalUit = cpItems.filter((i) => i.direction === "uit").reduce((s, i) => s + i.amount, 0);
        const open = openId === counterparty.id;
        return (
          <div key={counterparty.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                    return (
                      <React.Fragment key={item.id}>
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
                            <span className="text-xs text-slate-400 truncate">{entity?.name || "?"}</span>
                            <span className="text-xs text-slate-400">· {item.dueDate}</span>
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
                              <span
                                className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${
                                  lastPaid ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                                }`}
                                title="Herhalende post — dit is een globale indicator, geen status per vervaldatum"
                              >
                                {lastPaid ? `Betaald (laatst: ${lastPaid})` : "Nog niet betaald"}
                              </span>
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
        <p className="text-[11px] text-slate-400 pt-2">
          {groups.zonder.length} post{groups.zonder.length !== 1 ? "en" : ""} zonder gekoppelde debiteur/crediteur, niet in dit overzicht.
        </p>
      )}
    </div>
  );
}

