import { NextRequest, NextResponse } from "next/server";
import { runMission } from "@/lib/ai/orchestrator";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PAKUFI_OS_CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const scout = await runMission(
      "Lead Scout",
      "Run the three signal-gated searches (AI Supervisor, Contractor+Team agency-type, Contractor+Team hiring-signal-type). Only surface leads with at least one hard signal."
    );
    const researcher = await runMission(
      "Lead Researcher",
      `Lead Scout found the following. Enrich the most promising company with a real decision-maker contact:\n\n${scout.finalText}`
    );
    const qualifier = await runMission(
      "Lead Qualifier",
      `Lead Researcher found this contact. Score it and write it to the real Notion database:\n\n${researcher.finalText}`
    );
    await runMission(
      "Outreach Agent",
      `Lead Qualifier scored this lead as follows. Draft outreach for it:\n\n${qualifier.finalText}`
    );

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("Sales morning run failed", err);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
