// Gmail has no MCP connector in this workspace, unlike Apollo/Notion/
// Calendar/Drive — this is the one piece of real integration engineering
// the sales loop needs. Requires a Google Cloud OAuth2 app with
// gmail.compose and gmail.send scopes; tokens live server-side only.

export type DraftEmail = { to: string; subject: string; body: string };

export async function createDraft(email: DraftEmail): Promise<{ draftId: string }> {
  throw new Error("Not wired up yet — implement the Gmail API OAuth2 flow.");
}

// Must only ever be called after the matching Approval row's status is
// APPROVED — enforce that at the call site, not just by convention.
export async function sendApprovedDraft(draftId: string): Promise<{ messageId: string }> {
  throw new Error("Not wired up yet — implement the Gmail API OAuth2 flow.");
}
