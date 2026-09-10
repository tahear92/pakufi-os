// Notion's hosted MCP server (mcp.notion.com) is also OAuth-only and
// cannot run headless -- same constraint as Apollo, confirmed against
// Notion's own developer docs as of Sept 2026. This adapter calls Notion's
// REST API directly with an internal integration token instead (the same
// NOTION_API_KEY already used by sync.py) -- a static bearer token, built
// for unattended use in CI/cron/background agents.
//
// Also: Notion API version 2025-09-03 split "databases" into a container
// plus one-or-more "data sources" underneath it. Query/create/update
// operations now target a data_source_id, not the database_id directly --
// a real, fairly recent breaking change that's easy to miss if you're
// working from an older tutorial. This resolves and caches the data
// source id once rather than assuming the database_id works directly.
//
// Never writes "Note on contacted" -- that column stays reserved for
// manual team tracking, per the existing rule.

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const LEADS_DATABASE_ID = "318f90cf-3ae9-8006-af81-000bbe1c171d"; // Company-visit-Pakufi-website

function notionHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.NOTION_API_KEY ?? ""}`,
    "Notion-Version": NOTION_VERSION,
  };
}

let cachedDataSourceId: string | null = null;

async function getLeadsDataSourceId(): Promise<string> {
  if (cachedDataSourceId) return cachedDataSourceId;
  const res = await fetch(`${NOTION_BASE}/databases/${LEADS_DATABASE_ID}`, { headers: notionHeaders() });
  if (!res.ok) throw new Error(`Notion database lookup failed: ${res.status} ${await res.text()}`);
  const db = await res.json();
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data source found on the leads database -- check LEADS_DATABASE_ID");
  cachedDataSourceId = dataSourceId;
  return dataSourceId;
}

export type NotionLeadRow = {
  pageId?: string; // omit to create a new row, include to update an existing one
  company: string;
  websiteUrl: string;
  fitScore: number;
  contactPerson: string;
};

export async function upsertLead(row: NotionLeadRow) {
  const properties = {
    Name: { title: [{ text: { content: row.company } }] },
    "Website URL": { url: row.websiteUrl },
    note: { rich_text: [{ text: { content: `Fit score: ${row.fitScore}` } }] },
    "Key Contact": { rich_text: [{ text: { content: row.contactPerson } }] },
  };

  if (row.pageId) {
    const res = await fetch(`${NOTION_BASE}/pages/${row.pageId}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) throw new Error(`Notion update failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  const dataSourceId = await getLeadsDataSourceId();
  const res = await fetch(`${NOTION_BASE}/pages`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties }),
  });
  if (!res.ok) throw new Error(`Notion create failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function readLead(pageId: string) {
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) throw new Error(`Notion read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function markStatus(pageId: string, status: "Not Contacted" | "Contacted") {
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties: { Select: { select: { name: status } } } }),
  });
  if (!res.ok) throw new Error(`Notion status update failed: ${res.status} ${await res.text()}`);
  return res.json();
}
