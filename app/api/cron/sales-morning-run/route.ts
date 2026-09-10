import { NextRequest, NextResponse } from "next/server";
import { runMission } from "@/lib/ai/orchestrator";

// Allow up to 5 minutes — four sequential Claude + MCP tool-use loops
// (Apollo search, Notion writes, Gmail drafts) can genuinely take a while.
// If this still isn't enough once it's wired up for real, the fallback is
// having GitHub Actions call each persona as its own request instead of
// chaining them in one — not a queue, just smaller requests.
export const maxDuration = 300;

// Triggered by .github/workflows/sales-morning-run.yml, Mon-Fri at 9am
// Berlin time. Runs Scout -> Researcher -> Qualifier -> Outreach once and
// lets approvals pile up in the Approval Center. Nothing gets sent —
// Outreach Agent's gmail.sendApprovedDraft permission is "approve", so the
// chain stops at a drafted message every time, waiting for a human.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PAKUFI_OS_CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await runMission(
      "Lead Scout",
      "Run the three signal-gated searches (AI Supervisor, Contractor+Team agency-type, Contractor+Team hiring-signal-type). Only surface leads with at least one hard signal."
    );
    await runMission("Lead Researcher", "Enrich whatever Lead Scout found this run.");
    await runMission("Lead Qualifier", "Score and tag whatever Lead Researcher enriched this run.");
    await runMission("Outreach Agent", "Draft outreach for whatever Lead Qualifier qualified this run.");

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    // This runs unattended at 9am with nobody watching in real time — a
    // failure here needs to be loud. Wire this catch block to whatever
    // alerting you use (email, Slack) before relying on it daily; a
    // console.error alone won't wake anyone up.
    console.error("Sales morning run failed", err);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
