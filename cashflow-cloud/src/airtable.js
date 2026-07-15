// Thin wrapper around the Airtable REST API — routed through our own
// serverless proxy (/api/airtable/...) so the Airtable token never reaches
// the browser. See api/airtable/[...path].js for the server-side half.

export const TABLES = {
  entities: "tblvCShG16EqO56N1", // Boekhoudingen
  counterparties: "tblvZdFmsLq1zC1mp", // Debiteuren_Crediteuren
  items: "tblDNUpMUR9glpx4j", // Posten (Documenten)
  nameMappings: "tblptA57fvdaF68nL", // Naammapping
  payments: "tblmh8pKgQVlZLO2j", // Betalingen
  categories: "tblo7GAlHqh767fuk", // Categorieën
  projects: "tblr58NYZuYrsIXXH", // Projecten
};

const API_ROOT = "/api/airtable";

function headers() {
  return { "Content-Type": "application/json" };
}

async function handle(res, action) {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.error?.type || "";
    } catch (e) {}
    throw new Error(`Airtable ${action} mislukt (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export async function atListAll(tableId) {
  let records = [];
  let offset;
  do {
    const url = new URL(`${API_ROOT}/${tableId}`, window.location.origin);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: headers() });
    const data = await handle(res, "ophalen");
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// Airtable's REST API accepts at most 10 records per create/update/delete call.
const CHUNK = 10;

export async function atCreate(tableId, records) {
  const out = [];
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const res = await fetch(`${API_ROOT}/${tableId}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ records: chunk }),
    });
    const data = await handle(res, "aanmaken");
    out.push(...data.records);
  }
  return out;
}

export async function atUpdate(tableId, records) {
  const out = [];
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const res = await fetch(`${API_ROOT}/${tableId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk }),
    });
    const data = await handle(res, "bijwerken");
    out.push(...data.records);
  }
  return out;
}

export async function atDelete(tableId, ids) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const params = chunk.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_ROOT}/${tableId}?${params}`, {
      method: "DELETE",
      headers: headers(),
    });
    await handle(res, "verwijderen");
  }
}
