import { NextResponse } from "next/server";
import {
  appendProgress,
  readAnalysis,
  readBank,
  readLanguage,
  readPromptOverrideAt,
  readSession,
  writeSession,
} from "@/lib/store";
import { runScoreSession } from "@/lib/pipeline/scoreSession";
import { runMatchQuestions } from "@/lib/pipeline/matchQuestions";
import { PipelineError } from "@/lib/pipeline/json";

/** 结束练习：逐字稿 + 评分要点 → 四维评分 + 建议（提案形式）；试卷题顺手匹配题库（参考性质，失败不影响评分） */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  if (session.scorecard) return NextResponse.json({ session });
  if (session.mode === "single") {
    // 教学场次不评分：归档即结束（覆盖清单已随 turn 落盘，蒸馏由 /distill 按需生成）
    session.finishedAt = session.finishedAt ?? new Date().toISOString();
    writeSession(session);
    return NextResponse.json({ session });
  }
  if (session.turns.length === 0) {
    return NextResponse.json({ error: "本场还没有任何回答，无法评分" }, { status: 400 });
  }

  try {
    const bank = readBank(id);
    const scorecard = await runScoreSession(session, bank, readLanguage(id), {
      signal: req.signal,
      riskNotes: readAnalysis(id)?.riskNotes ?? [],
      override: readPromptOverrideAt(id, "score"),
    });
    session.scorecard = scorecard;
    session.finishedAt = new Date().toISOString();
    // 试卷题 ↔ 题库匹配（AI 猜、用户可改选；只做参考，评分不依赖它）。single 在上面已提前返回
    try {
      const matches = await runMatchQuestions(session, bank, readLanguage(id), { signal: req.signal });
      for (const snap of session.questions) {
        if (snap.matchedBankQuestionId) continue; // 抽题场次开场已带对应关系，不被 AI 猜覆盖
        const m = matches.get(snap.id);
        if (!m) continue;
        snap.matchedBankQuestionId = m.bankQuestionId;
        snap.matchedReason = m.reason;
      }
    } catch {
      // 匹配失败不阻断评分结果；复盘里可手选对应题库题
    }
    writeSession(session);
    appendProgress(id, scorecard, session.id);
    return NextResponse.json({ session });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "评分失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  }
}
