import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendApprovedDraft } from "@/lib/integrations/gmail";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action: "approve" | "reject" = body.action;

  const approval = await db.approval.findUnique({ where: { id } });
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
      return NextResponse.json({ error: `no handler for approval type: ${approval.type}` }, { status: 501 });
    }

    const payload = approval.payload as { draftId: string };

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

async function completeRunIfNothingElsePending(runId: string) {
  const stillPending = await db.approval.count({ where: { runId, status: "PENDING" } });
  if (stillPending === 0) {
    await db.agentRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
  }
}
