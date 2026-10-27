import { NextResponse } from "next/server";
import { readSession, writeSession } from "@/lib/store";

/** 复盘里用户改选「这道试卷题对应题库哪一题」（AI 匹配只是建议，这里以用户为准） */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const body = (await req.json()) as { questionId?: string; bankQuestionId?: string | null };
  if (!body.questionId) {
    return NextResponse.json({ error: "缺少 questionId" }, { status: 400 });
  }
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  const snap = session.questions.find((q) => q.id === body.questionId);
  if (!snap) return NextResponse.json({ error: "题目不在本场清单里" }, { status: 400 });

  if (body.bankQuestionId) {
    snap.matchedBankQuestionId = body.bankQuestionId;
    snap.matchedReason = "手动指定";
  } else {
    delete snap.matchedBankQuestionId;
    delete snap.matchedReason;
  }
  writeSession(session);
  return NextResponse.json({ session });
}
