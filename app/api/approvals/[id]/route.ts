import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendApprovedDraft } from "@/lib/integrations/gmail";

// Called when a human clicks Approve or Reject in the Approval Center.
// Deliberately does NOT re-enter runMission()'s conversation loop --
// approving is a direct action (send this specific draft), not "let Claude
// keep going." That keeps this endpoint simple and means a stuck or
// long-finished agent run never blocks a human from resolving what's
// waiting on them.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const action: "approve" | "reject" = body.action;

  const approval = await db.approval.findUnique({ where: { id: params.id } });
  if (!approval) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (approval.status !== "PENDING") {
    return NextResponse.json({ error: `already ${approval.status.toLowerCase()}` }, { status: 409 });
  }

  if (action === "reject") {
    await db.approval.update({ where: { id: approval.id }, data: { status: "REJECTED", resolvedAt: new Date() } });
    await completeRunIfNothingElsePending(approval.runId);
    return NextResponse.json({ status: "rejected" });
  }

  if (action === "approve") {
    if (approval.type !== "gmail.sendApprovedDraft") {
      // Only Gmail sends are approval-gated today (see orchestrator.ts) --
      // this branch exists so a future approval-gated Apollo/Notion action
      // doesn't silently no-op here.
      return NextResponse.json({ error: `no handler for approval type: ${approval.type}` }, { status: 501 });
    }

    const payload = approval.payload as { draftId: string };

    // A person editing the message text in the Approval Center arrives
    // here as body.editedBody, but there's no updateDraft() in the Gmail
    // adapter yet to write it back before sending -- flagging rather than
    // silently ignoring edits until that exists.
    if (body.editedBody) {
      console.warn(`Approval ${approval.id} was edited before approving, but edits aren't wired to the send yet.`);
    }

    let result;
    try {
      result = await sendApprovedDraft(payload.draftId);
    } catch (err) {
      console.error("Send failed", err);
      return NextResponse.json({ error: "send failed" }, { status: 502 });
    }

    await db.approval.update({ where: { id: approval.id }, data: { status: "APPROVED", resolvedAt: new Date() } });

    const actionCount = await db.agentAction.count({ where: { runId: approval.runId } });
    await db.agentAction.create({
      data: {
        runId: approval.runId,
        stepIndex: actionCount,
        toolUsed: "gmail.sendApprovedDraft",
        input: { draftId: payload.draftId },
        output: result as any,
      },
    });

    await completeRunIfNothingElsePending(approval.runId);
    return NextResponse.json({ status: "approved", result });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// A single run can produce several pending approvals at once (Outreach
// Agent often drafts multiple messages in one pass) -- only mark the run
// COMPLETED once every approval tied to it is actually resolved, not the
// first time any one of them is. Marking it complete too early was a real
// bug caught while writing this, not a hypothetical one.
async function completeRunIfNothingElsePending(runId: string) {
  const stillPending = await db.approval.count({ where: { runId, status: "PENDING" } });
  if (stillPending === 0) {
    await db.agentRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
  }
}
