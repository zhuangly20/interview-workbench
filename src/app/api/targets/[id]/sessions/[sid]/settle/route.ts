import { NextResponse } from "next/server";
import { readBank, readLanguage, readSession, writeSession } from "@/lib/store";
import { runSettleTeach } from "@/lib/pipeline/settleTeach";
import type { BankQuestion } from "@/lib/types";

/** 补算覆盖清单：语音逐字稿已落盘但结算缺失/失败时（如保存期间关掉了页面），
 * 从已存的聊天流重新结算。幂等：已有覆盖清单时原样返回。
 * 不绑请求信号——弹层关掉、请求断开，结算也在服务端算完落盘。 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  if (session.mode !== "single") {
    return NextResponse.json({ error: "只有单题陪练需要结算覆盖清单" }, { status: 400 });
  }

  const turn = [...session.turns].reverse().find((t) => (t.chat ?? []).length > 0);
  if (!turn) return NextResponse.json({ error: "本场还没有可结算的聊天内容" }, { status: 400 });
  if (turn.coverage && (turn.coverage.covered.length > 0 || turn.coverage.missing.length > 0)) {
    // 已有覆盖清单：无需重算，但顺手补上归档（调用方补算的前提是这场已经结束）
    session.finishedAt = session.finishedAt ?? new Date().toISOString();
    writeSession(session);
    return NextResponse.json({ coverage: turn.coverage, session });
  }

  const snapshot = session.questions.find((q) => q.id === turn.questionId);
  if (!snapshot) return NextResponse.json({ error: "题目不在本场清单里" }, { status: 400 });
  // 题库原题优先；题目已删除/归档时用本场快照兜底（rubric/参考答案都随场落盘了）
  const bankQuestion: BankQuestion =
    readBank(id).questions.find((q) => q.id === turn.questionId) ??
    {
      id: snapshot.id,
      question: snapshot.question,
      followUps: [],
      rubric: snapshot.rubric ?? "",
      answer: snapshot.referenceAnswer ?? "",
      notes: snapshot.notes ?? "",
      status: "draft",
      source: "ai-draft",
      lastEdited: "",
    };

  try {
    const transcriptText = (turn.chat ?? [])
      .map((m) => `${m.role === "user" ? "候选人" : "教练"}：${m.text}`)
      .join("\n");
    const settlement = await runSettleTeach(bankQuestion, session, transcriptText, readLanguage(id));
    turn.coverage = { covered: settlement.covered, missing: settlement.missing };
    turn.gold ??= [];
    const goldList = turn.gold;
    goldList.push(...settlement.gold.filter((g) => g.trim() && !goldList.includes(g)));
    session.finishedAt = session.finishedAt ?? new Date().toISOString();
    writeSession(session);
    return NextResponse.json({ coverage: turn.coverage, session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "结算失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
