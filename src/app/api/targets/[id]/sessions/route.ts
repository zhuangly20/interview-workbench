import { NextResponse } from "next/server";
import {
  createSession,
  listSessions,
  newId,
  paperKey,
  readAnalysis,
  readBank,
  readInputs,
  readLanguage,
  readPaper,
  writePaper,
} from "@/lib/store";
import { runMakePaper } from "@/lib/pipeline/makePaper";
import { drawQuestions } from "@/lib/pipeline/drawQuestions";
import { PipelineError } from "@/lib/pipeline/json";

/**
 * 开一场练习：
 * - body.questionId → 单题陪练（single 模式）：题目快照（含 rubric/参考答案）随场保存，老场次读题库兜底
 * - 否则模拟面试（full）：题库有题 → 本地抽题秒开（每题开场即带参考答案与题库对应，复盘无需再 AI 匹配；
 *   regeneratePaper=true 避开上一场的题换一批）；题库为空 → 回退现场出卷（按拆解 + 时长现出一套，
 *   按 (时长, 拆解版本) 缓存）。完成拆解后平台会自动后台备题，一般不会走到回退。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    questionId?: string;
    minutes?: number;
    style?: string;
    regeneratePaper?: boolean;
  };
  const bank = readBank(id);
  const style = body.style?.trim() ? body.style.trim().slice(0, 500) : undefined;

  if (body.questionId) {
    const q = bank.questions.find((x) => x.id === body.questionId && x.status !== "archived");
    if (!q) return NextResponse.json({ error: "题目不存在或已退役" }, { status: 400 });
    const session = {
      id: newId("s"),
      targetId: id,
      startedAt: new Date().toISOString(),
      mode: "single" as const,
      interviewerStyle: style,
      questions: [
        {
          id: q.id,
          question: q.question,
          section: q.section,
          rubric: q.rubric,
          referenceAnswer: q.answer,
          notes: q.notes,
          matchedBankQuestionId: q.id,
        },
      ],
      turns: [],
    };
    createSession(session);
    return NextResponse.json({ session, sessions: listSessions(id) });
  }

  const minutes = typeof body.minutes === "number" && body.minutes > 0 ? body.minutes : 0;
  const activeQuestions = bank.questions.filter((q) => q.status !== "archived");

  if (activeQuestions.length) {
    // 题库有题：本地抽题，秒开。「换一批」避开最近几场用过的题；避开后不够就全量重抽
    const recentIds = listSessions(id)
      .filter((s) => s.mode !== "single")
      .slice(0, 3)
      .flatMap((s) => s.questionIds);
    const avoidIds = body.regeneratePaper ? [...new Set(recentIds)] : [];
    const session = {
      id: newId("s"),
      targetId: id,
      startedAt: new Date().toISOString(),
      plannedMinutes: minutes,
      interviewerStyle: style,
      questions: drawQuestions(bank, minutes, avoidIds),
      turns: [],
    };
    createSession(session);
    return NextResponse.json({ session, sessions: listSessions(id) });
  }

  const analysis = readAnalysis(id);
  if (!analysis) {
    return NextResponse.json({ error: "题库还没有题，也没有岗位拆解——请先到拆解页生成拆解" }, { status: 400 });
  }
  const key = paperKey(minutes, analysis.generatedAt);
  let paper = body.regeneratePaper ? undefined : readPaper(id, key);
  if (!paper) {
    // 避开题库已有题面，逼出卷用全新表述
    const avoid = bank.questions
      .filter((q) => q.status !== "archived")
      .map((q) => q.question)
      .slice(0, 40);
    try {
      paper = await runMakePaper(readInputs(id), analysis, minutes, avoid, id, readLanguage(id), {
        signal: req.signal,
      });
    } catch (e) {
      if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
      const raw = e instanceof PipelineError ? e.raw : undefined;
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "出卷失败", raw },
        { status: 502 },
      );
    }
    writePaper(id, key, paper);
  }

  const session = {
    id: newId("s"),
    targetId: id,
    startedAt: new Date().toISOString(),
    plannedMinutes: minutes,
    interviewerStyle: style,
    paperKey: key,
    questions: paper.questions.map((pq) => ({
      id: pq.id,
      question: pq.question,
      section: pq.section,
      rubric: pq.rubric,
      notes: pq.notes,
    })),
    turns: [],
  };
  createSession(session);
  return NextResponse.json({ session, sessions: listSessions(id) });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ sessions: listSessions(id) });
}
