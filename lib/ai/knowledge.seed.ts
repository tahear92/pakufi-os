// These are real Pakufi documents, fetched via the Notion MCP connector at
// runtime rather than duplicated here — Lead Qualifier and Outreach Agent
// should pull from these before scoring or drafting, not rely on whatever
// ICP language happens to be baked into their system prompt, since these
// pages get edited directly (pain points, keywords, and content focus %
// are explicitly marked as living/editable in the source docs).

export const salesKnowledgeSources = [
  {
    title: "ICPs (Star ICP A, Star ICP B, dormant ICP 3, Potential ICPs)",
    type: "notion_page",
    location: "https://app.notion.com/p/2e8f90cf3ae980a08506f518d6d6edfc",
    department: "sales",
  },
  {
    title: "Apollo.io Signal-first - Experiment (search filters, signal gate, house style, weekly rhythm)",
    type: "notion_page",
    location: "https://app.notion.com/p/3cbf90cf3ae981ddad49d4455aed3b03",
    department: "sales",
  },
  {
    title: "Sales (hub — pricing, developer leasing, warm rooms, proposal prep)",
    type: "notion_page",
    location: "https://app.notion.com/p/9d7b7d03b2504bc5b16677962a22a8f8",
    department: "sales",
  },
];
