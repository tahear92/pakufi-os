// Apollo's official MCP server (mcp.apollo.io) is OAuth-only, browser-based,
// and cannot run headless -- confirmed against Apollo's own docs and
// independent writeups as of Sept 2026. Right for this conversation (runs
// through Tahir's already-authenticated claude.ai session); wrong for a
// 9am unattended cron job with nobody there to click "Authorize."
//
// This adapter calls Apollo's REST API directly instead, with the same
// APOLLO_API_KEY already used by the existing weekly sync.py -- a static
// header-based key, built for unattended use.
//
// Endpoint names and payload shapes below follow Apollo's documented REST
// conventions but haven't been independently re-verified field-by-field --
// check docs.apollo.io/reference against a real response before relying on
// this in production.

const APOLLO_BASE = "https://api.apollo.io/api/v1";

function apolloHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
  };
}

export type ApolloCompany = {
  name: string;
  country: string;
  website: string;
  employeeCount: number;
  industry: string;
};

export async function searchCompanies(filters: {
  locations?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  keywords?: string[];
}): Promise<ApolloCompany[]> {
  const res = await fetch(`${APOLLO_BASE}/mixed_companies/search`, {
    method: "POST",
    headers: apolloHeaders(),
    body: JSON.stringify({
      organization_locations: filters.locations,
      organization_num_employees_ranges:
        filters.minEmployees && filters.maxEmployees ? [`${filters.minEmployees},${filters.maxEmployees}`] : undefined,
      q_organization_keyword_tags: filters.keywords,
    }),
  });
  if (!res.ok) throw new Error(`Apollo company search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.organizations ?? []).map((o: any) => ({
    name: o.name,
    country: o.country,
    website: o.website_url,
    employeeCount: o.estimated_num_employees,
    industry: o.industry,
  }));
}

export async function searchPeople(filters: { titles?: string[]; organizationDomains?: string[] }) {
  const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
    method: "POST",
    headers: apolloHeaders(),
    body: JSON.stringify({
      person_titles: filters.titles,
      q_organization_domains: filters.organizationDomains?.join("\n"),
    }),
  });
  if (!res.ok) throw new Error(`Apollo people search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function enrichContact(domain: string) {
  const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: apolloHeaders(),
  });
  if (!res.ok) throw new Error(`Apollo enrich failed: ${res.status} ${await res.text()}`);
  return res.json();
}
