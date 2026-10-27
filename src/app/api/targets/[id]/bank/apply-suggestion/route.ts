import { NextResponse } from "next/server";
import { readBank, readSession, writeBank, writeSession } from "@/lib/store";

/** 复盘页「采纳建议」：把 scorecard 建议写入对应题目的 notes，并标记已采纳。
 * 建议的 questionId 可能是试卷题 id（不在题库）——优先按本场快照解析出对应的题库题。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { sessionId?: string; index?: number };
  if (!body.sessionId || body.index === undefined) {
    return NextResponse.json({ error: "缺少 sessionId 或 index" }, { status: 400 });
  }
  const session = readSession(id, body.sessionId);
  const suggestion = session?.scorecard?.suggestions[body.index];
  if (!session || !suggestion) {
    return NextResponse.json({ error: "找不到该建议" }, { status: 404 });
  }
  if (suggestion.applied) {
    return NextResponse.json({ error: "该建议已采纳过" }, { status: 409 });
  }

  const bank = readBank(id);
  const rawId = suggestion.questionId;
  // 对应题库题：优先按本场快照的匹配（抽题场次开场自带；用户手动改选以手动为准），
  // 快照没有再直接认 rawId（老试卷场次 / 兜底）
  const snap = rawId ? session.questions.find((q) => q.id === rawId) : undefined;
  let bankQuestionId: string | undefined =
    snap?.matchedBankQuestionId && bank.questions.some((q) => q.id === snap.matchedBankQuestionId)
      ? snap.matchedBankQuestionId
      : undefined;
  if (!bankQuestionId && rawId && bank.questions.some((q) => q.id === rawId)) bankQuestionId = rawId;

  const today = new Date().toISOString().slice(0, 10);
  if (bankQuestionId) {
    const q = bank.questions.find((x) => x.id === bankQuestionId);
    if (q) {
      q.notes = `${q.notes ? `${q.notes}\n` : ""}[复盘建议 ${today}] ${suggestion.text}`;
      q.source = q.source === "user-written" ? "mixed" : q.source;
      q.lastEdited = new Date().toISOString();
      writeBank(id, bank);
    }
  }
  suggestion.applied = true;
  writeSession(session);
  return NextResponse.json({ ok: true, session });
}
