import Anthropic from "@anthropic-ai/sdk";
import { salesPersonas } from "./personas.seed";
import { searchCompanies, searchPeople, enrichContact } from "../integrations/apollo";
import { upsertLead, readLead } from "../integrations/notion";
import { createDraft, sendApprovedDraft } from "../integrations/gmail";
import { db } from "../db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Persona = (typeof salesPersonas)[number];

// Every tool the Sales personas can use, keyed by the same permission keys
// used in personas.seed.ts's toolPermissions. All of them are now plain
// custom tools -- Apollo and Notion moved off MCP (see apollo.ts / notion.ts
// for why), so there's no more split between "auto-executed by Anthropic"
// and "executed by this code." Every call passes through the loop below,
// which means every call could be approval-gated later, not just Gmail's.
const TOOL_REGISTRY: Record<string, { schema: Record<string, unknown>; execute: (input: any) => Promise<unknown> }> = {
  "apollo.searchCompanies": {
    schema: {
      name: "apollo_search_companies",
      description: "Search Apollo for companies by location, employee count range, and keywords.",
      input_schema: {
        type: "object",
        properties: {
          locations: { type: "array", items: { type: "string" } },
          minEmployees: { type: "number" },
          maxEmployees: { type: "number" },
          keywords: { type: "array", items: { type: "string" } },
        },
      },
    },
    execute: (input) => searchCompanies(input),
  },
  "apollo.searchPeople": {
    schema: {
      name: "apollo_search_people",
      description: "Search Apollo for people by title and organization domain.",
      input_schema: {
        type: "object",
        properties: {
          titles: { type: "array", items: { type: "string" } },
          organizationDomains: { type: "array", items: { type: "string" } },
        },
      },
    },
    execute: (input) => searchPeople(input),
  },
  "apollo.enrichContact": {
    schema: {
      name: "apollo_enrich_contact",
      description: "Enrich a company by domain to find decision-maker contacts.",
      input_schema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] },
    },
    execute: (input) => enrichContact(input.domain),
  },
  "notion.createPage": {
    schema: {
      name: "notion_create_lead",
      description: "Create a new lead row in the Sales Notion database. Never sets 'Note on contacted' -- that stays reserved for manual team tracking.",
      input_schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          websiteUrl: { type: "string" },
          fitScore: { type: "number" },
          contactPerson: { type: "string" },
        },
        required: ["company", "websiteUrl", "fitScore", "contactPerson"],
      },
    },
    execute: (input) => upsertLead(input),
  },
  "notion.updatePage": {
    schema: {
      name: "notion_update_lead",
      description: "Update an existing lead row by page id. Never sets 'Note on contacted'.",
      input_schema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          company: { type: "string" },
          websiteUrl: { type: "string" },
          fitScore: { type: "number" },
          contactPerson: { type: "string" },
        },
        required: ["pageId", "company", "websiteUrl", "fitScore", "contactPerson"],
      },
    },
    execute: (input) => upsertLead(input),
  },
  "notion.readPage": {
    schema: {
      name: "notion_read_lead",
      description: "Read a lead row by page id.",
      input_schema: { type: "object", properties: { pageId: { type: "string" } }, required: ["pageId"] },
    },
    execute: (input) => readLead(input.pageId),
  },
  "gmail.createDraft": {
    schema: {
      name: "gmail_create_draft",
      description: "Create a Gmail draft addressed to a specific recipient. Does not send.",
      input_schema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
    },
    execute: (input) => createDraft(input),
  },
  "gmail.sendApprovedDraft": {
    schema: {
      name: "gmail_send_approved_draft",
      description: "Send a Gmail draft that a human has already approved. Only call this if explicitly told the draft is approved.",
      input_schema: { type: "object", properties: { draftId: { type: "string" } }, required: ["draftId"] },
    },
    execute: (input) => sendApprovedDraft(input.draftId),
  },
};

// AgentRun.agentId is a foreign key into AgentDefinition -- upsert against
// the static seed config to get a real row, since editing personas through
// a settings UI is explicitly deferred (see personas.seed.ts).
async function ensureAgentDefinition(persona: Persona) {
  return db.agentDefinition.upsert({
    where: { name: persona.name },
    update: {
      systemPrompt: persona.systemPrompt,
      toolPermissions: persona.toolPermissions,
      role: persona.role,
      department: persona.department,
    },
    create: {
      name: persona.name,
      department: persona.department,
      role: persona.role,
      systemPrompt: persona.systemPrompt,
      toolPermissions: persona.toolPermissions,
    },
  });
}

// The whole "multi-agent system" is this one function: given a persona and
// a mission, run a Claude tool-use loop scoped to that persona's prompt and
// tools, checking toolPermissions before executing anything that isn't
// "auto". Forty named agents in the product concept map to a handful of
// these persona configs, not forty separate engineered runtimes.
export async function runMission(personaName: string, missionText: string) {
  const persona = salesPersonas.find((p) => p.name === personaName);
  if (!persona) throw new Error(`Unknown persona: ${personaName}`);

  const agentDefinition = await ensureAgentDefinition(persona);
  const run = await db.agentRun.create({
    data: { agentId: agentDefinition.id, missionText, status: "IN_PROGRESS" },
  });

  const permissionKeys = Object.keys(persona.toolPermissions) as string[];
  const toolSchemas = permissionKeys.map((k) => TOOL_REGISTRY[k]?.schema).filter(Boolean);
  const toolNameToPermissionKey = Object.fromEntries(
    permissionKeys.filter((k) => TOOL_REGISTRY[k]).map((k) => [TOOL_REGISTRY[k].schema.name as string, k])
  );

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: missionText }];
  let stepIndex = 0;

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: persona.systemPrompt,
      messages,
      tools: toolSchemas as Anthropic.Tool[],
    });

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      await db.agentRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
      return run;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let waitingForApproval = false;

    for (const block of toolUseBlocks) {
      const permissionKey = toolNameToPermissionKey[block.name];
      const autonomy = (persona.toolPermissions as Record<string, string>)[permissionKey];
      const registryEntry = TOOL_REGISTRY[permissionKey];

      await db.agentAction.create({
        data: { runId: run.id, stepIndex: stepIndex++, toolUsed: permissionKey, input: block.input as any, output: null },
      });

      if (autonomy === "approve") {
        await db.approval.create({
          data: { runId: run.id, type: permissionKey, payload: block.input as any, status: "PENDING" },
        });
        waitingForApproval = true;
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Queued for human approval. Not executed yet." });
        continue;
      }

      try {
        const result = await registryEntry.execute(block.input);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err: any) {
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    if (waitingForApproval) {
      // Stop here. Resuming isn't "continue this Claude conversation" --
      // when a human approves in the Approval Center, that click calls
      // gmail.sendApprovedDraft directly with the stored payload. See
      // app/api/approvals/[id]/route.ts.
      await db.agentRun.update({ where: { id: run.id }, data: { status: "WAITING_FOR_APPROVAL" } });
      return run;
    }

    messages.push({ role: "user", content: toolResults });
  }
}
