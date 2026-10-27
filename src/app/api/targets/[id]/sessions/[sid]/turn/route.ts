import { NextResponse } from "next/server";
import { readAnalysis, readBank, readLanguage, readSession, writeSession } from "@/lib/store";
import { runPracticeTurn, computeTimePlan } from "@/lib/pipeline/practiceTurn";
import { runTeachTurn } from "@/lib/pipeline/teachTurn";
import { runSettleTeach } from "@/lib/pipeline/settleTeach";
import { PipelineError } from "@/lib/pipeline/json";
import type { BankQuestion, ChatMsg, SessionTurn } from "@/lib/types";

interface TurnBody {
  questionId?: string;
  answer?: string;
  /** 本题已进行秒数（客户端每题计时器） */
  durationSec?: number;
  /** 本场已进行秒数（全场计时器，时间预算按它决策） */
  elapsedSec?: number;
  /** 追问的应答 */
  followUp?: { q: string; a: string };
  /** 跳过本题：记录空回答，直接下一题（不调用大脑） */
  skip?: boolean;
  /** T6 教学模式：自然聊天陪练（文字走 answer 字段；语音逐字稿也带此标记） */
  mode?: "teach";
  /** 模拟面试整场模式：一通电话的完整逐字稿，服务端按原题文本切分成每题 turn */
  whole?: boolean;
  /** 语音模式：浏览器端积累的逐字稿（到达顺序），服务端切段落盘 */
  transcript?: {
    agentUserId: string;
    segments: { userId: string; text: string; definite: boolean }[];
    durationSec?: number;
  };
}

/** 把合并后的双方发言切成 answer + followUpQA（agent 问句含 ?/？ 且之前已有用户回答 → 之后第一段用户话是该追问的应答） */
function sidesToQA(merged: { agent: boolean; text: string }[]): {
  answer: string;
  followUpQA: { q: string; a: string }[];
} {
  let answer = "";
  const followUpQA: { q: string; a: string }[] = [];
  let pendingQ = "";
  let userStarted = false;
  for (const m of merged) {
    if (m.agent) {
      if (userStarted && (m.text.includes("?") || m.text.includes("？"))) pendingQ = m.text;
      continue;
    }
    if (!userStarted) {
      answer = m.text;
      userStarted = true;
    } else if (pendingQ) {
      followUpQA.push({ q: pendingQ, a: m.text });
      pendingQ = "";
    } else {
      answer += ` ${m.text}`;
    }
  }
  return { answer, followUpQA };
}

/** 归一化：去标点/空白/大小写，用于在逐字稿里定位原题文本 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

/** 整场连续电话的逐字稿 → 每题 turn。
 * 切分依据：面试官发言里包含某题的原文（协议要求逐字读题）；没匹配上的开头闲聊归入第一题。
 * 兜底：一题都没匹配上（AI 没按原文读）→ 整场归到第一题，数据不丢。 */
export function splitWholeTranscript(
  agentUserId: string,
  segments: { userId: string; text: string; definite: boolean }[],
  questions: { id: string; question: string }[],
): { questionId: string; answer: string; followUpQA: { q: string; a: string }[]; segCount: number }[] {
  const merged = mergeSides(agentUserId, segments);
  if (!merged.length || !questions.length) return [];
  const normQs = questions.map((q) => ({ id: q.id, norm: normalizeForMatch(q.question) }));

  // 定位每题的起始段：面试官发言里第一次出现未问过的原题文本
  const bounds: number[] = [];
  const qOrder: string[] = [];
  let qi = 0;
  for (let i = 0; i < merged.length; i++) {
    if (!merged[i].agent) continue;
    const norm = normalizeForMatch(merged[i].text);
    for (let k = qi; k < normQs.length; k++) {
      if (normQs[k].norm.length >= 6 && norm.includes(normQs[k].norm)) {
        bounds.push(i);
        qOrder.push(normQs[k].id);
        qi = k + 1;
        break;
      }
    }
  }

  const chunks = bounds.length
    ? bounds.map((start, c) => ({
        start: c === 0 ? 0 : start,
        end: c + 1 < bounds.length ? bounds[c + 1] : merged.length,
        questionId: qOrder[c],
      }))
    : [{ start: 0, end: merged.length, questionId: questions[0].id }];
  return chunks.map(({ start, end, questionId }) => {
    const slice = merged.slice(start, end);
    const { answer, followUpQA } = sidesToQA(slice);
    return { questionId, answer, followUpQA, segCount: slice.length };
  });
}

/** 教学语音：逐字稿全量按聊天流保留（双方发言都存，不筛问句） */
export function composeTeachTranscript(
  agentUserId: string,
  segments: { userId: string; text: string; definite: boolean }[],
): ChatMsg[] {
  return mergeSides(agentUserId, segments).map((m) => ({
    role: m.agent ? ("coach" as const) : ("user" as const),
    text: m.text,
    at: new Date().toISOString(),
  }));
}

function mergeSides(
  agentUserId: string,
  segments: { userId: string; text: string; definite: boolean }[],
): { agent: boolean; text: string }[] {
  const merged: { agent: boolean; text: string }[] = [];
  for (const s of segments) {
    if (!s.definite || !s.text.trim()) continue;
    const agent = s.userId === agentUserId;
    const last = merged[merged.length - 1];
    if (last && last.agent === agent) last.text += ` ${s.text.trim()}`;
    else merged.push({ agent, text: s.text.trim() });
  }
  return merged;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const body = (await req.json()) as TurnBody;
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  // 教学语音的逐字稿重发 = 结算失败后的重试（同一段逐字稿、不产生新内容），已结束也放行；其余不许改动已结束场次
  if (session.finishedAt && !(body.mode === "teach" && body.transcript)) {
    return NextResponse.json({ error: "本场已结束" }, { status: 409 });
  }

  // 整场连续电话的逐字稿不带 questionId（一通电话覆盖全部题），先于单题校验处理
  if (body.transcript && body.mode !== "teach") {
    const agentUid = body.transcript.agentUserId;
    const split = splitWholeTranscript(agentUid, body.transcript.segments, session.questions);
    const totalSegs = split.reduce((n, t) => n + t.segCount, 0) || 1;
    for (const piece of split) {
      const snap = session.questions.find((q) => q.id === piece.questionId);
      if (!snap) continue;
      let t = session.turns.find((x) => x.questionId === piece.questionId);
      if (!t) {
        t = { questionId: piece.questionId, question: snap.question, answer: "", followUpQA: [] } satisfies SessionTurn;
        session.turns.push(t);
      }
      if (piece.answer) t.answer = t.answer ? `${t.answer} ${piece.answer}` : piece.answer;
      if (piece.followUpQA.length) t.followUpQA.push(...piece.followUpQA);
      // 时长按各题段数占比分摊
      if (body.transcript.durationSec) {
        t.durationSec = Math.max(1, Math.round((body.transcript.durationSec * piece.segCount) / totalSegs));
      }
    }
    writeSession(session);
    return NextResponse.json({ action: "next", comment: "", session });
  }

  const questionId = body.questionId ?? "";
  const snapshot = session.questions.find((q) => q.id === questionId);
  if (!snapshot) return NextResponse.json({ error: "题目不在本场清单里" }, { status: 400 });

  const bank = readBank(id);
  const bankQuestion = bank.questions.find((q) => q.id === questionId);

  // 记录或更新本轮 turn
  let turn = session.turns.find((t) => t.questionId === questionId);
  if (!turn) {
    turn = { questionId, question: snapshot.question, answer: "", followUpQA: [] } satisfies SessionTurn;
    session.turns.push(turn);
  }
  if (body.followUp) {
    turn.followUpQA.push({ q: body.followUp.q, a: body.followUp.a });
    turn.durationSec = body.durationSec ?? turn.durationSec;
    writeSession(session);
    return NextResponse.json({ action: "next", comment: "", session });
  }

  if (body.transcript) {
    const agentUid = body.transcript.agentUserId;
    if (body.mode === "teach") {
      // 教学语音：全量聊天流落盘 → 挂断后自动结算覆盖账本与金句。
      // 保存只在「结束练习」时发生 → 保存即结束（finishedAt 在此落盘，不依赖客户端后续回调，
      // 否则结算期间关掉页面，场次会永远停在「进行中」）；同一段逐字稿重发不重复追加。
      const chat = composeTeachTranscript(agentUid, body.transcript.segments);
      const saved = turn.chat ?? [];
      // 重发判定只看 role+text：每条消息落盘时盖 at 时间戳，逐字节比对永远对不上
      const sig = (arr: { role: string; text: string }[]) => arr.map((m) => `${m.role}|${m.text}`).join("\n");
      const isResend = chat.length > 0 && saved.length >= chat.length && sig(saved.slice(-chat.length)) === sig(chat);
      turn.chat = isResend ? saved : [...saved, ...chat];
      turn.durationSec = body.transcript.durationSec ?? body.durationSec ?? turn.durationSec;
      session.finishedAt = session.finishedAt ?? new Date().toISOString();
      writeSession(session);
      if (!chat.length) return NextResponse.json({ action: "next", comment: "", session });
      if (!bankQuestion) return NextResponse.json({ error: "题目已不在题库中，无法结算" }, { status: 400 });
      try {
        const transcriptText = turn.chat.map((m) => `${m.role === "user" ? "候选人" : "教练"}：${m.text}`).join("\n");
        // 不绑 req.signal：结算期间关页面/断网，覆盖账本也在服务端算完落盘
        const settlement = await runSettleTeach(bankQuestion, session, transcriptText, readLanguage(id));
        turn.coverage = { covered: settlement.covered, missing: settlement.missing };
        turn.gold ??= [];
        const goldList = turn.gold;
        goldList.push(...settlement.gold.filter((g) => g.trim() && !goldList.includes(g)));
        writeSession(session);
        return NextResponse.json({ action: "next", comment: "", coverage: turn.coverage, session });
      } catch (e) {
        const raw = e instanceof PipelineError ? e.raw : undefined;
        // 结算失败不阻断：逐字稿与结束状态已落盘，复盘页可补算覆盖清单
        return NextResponse.json({ error: e instanceof Error ? e.message : "结算失败", raw, session }, { status: 502 });
      }
    }
  }

  if (body.mode === "teach") {
    // 教学文字通道：消息进聊天流，教练逐轮决策（含覆盖账本/金句合并）
    if (!bankQuestion) return NextResponse.json({ error: "题目已不在题库中，无法继续教学" }, { status: 400 });
    try {
      const decision = await runTeachTurn(bankQuestion, session, body.answer ?? "", readLanguage(id), {
        signal: req.signal,
      });
      writeSession(session);
      return NextResponse.json({ ...decision, session });
    } catch (e) {
      if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
      const raw = e instanceof PipelineError ? e.raw : undefined;
      const message = e instanceof Error ? e.message : "教练响应失败";
      return NextResponse.json({ error: message, raw }, { status: 502 });
    }
  }

  turn.answer = body.answer ?? turn.answer;
  turn.durationSec = body.durationSec ?? turn.durationSec;
  writeSession(session);

  if (body.skip) {
    return NextResponse.json({ action: "next", comment: "", session });
  }

  // 追问依据优先级：题库原题 → 本场快照（试卷题不在题库，但自带 rubric/参考答案/考察点）→ 都没有才只记录不追问
  const effectiveQuestion: BankQuestion | undefined =
    bankQuestion ??
    (snapshot.rubric || snapshot.referenceAnswer || snapshot.notes
      ? {
          id: snapshot.id,
          question: snapshot.question,
          followUps: [],
          rubric: snapshot.rubric ?? "",
          answer: snapshot.referenceAnswer ?? "",
          notes: snapshot.notes ?? "",
          status: "draft",
          source: "ai-draft",
          lastEdited: "",
        }
      : undefined);
  if (!effectiveQuestion) {
    return NextResponse.json({ action: "next", comment: "", session });
  }

  // 时间预算：按开场时长档决定节奏；timeup 直接收尾（不调大脑），overq/tight 由路由硬性强制 next
  const plan = computeTimePlan(session, body.elapsedSec ?? 0, body.durationSec ?? 0);
  if (plan.tier === "timeup") {
    return NextResponse.json({
      action: "timeup",
      comment:
        readLanguage(id) === "zh"
          ? "时间到了，今天就到这里，谢谢你的时间。"
          : "We're out of time — let's wrap up here. Thanks for your time today.",
      session,
    });
  }

  try {
    const decision = await runPracticeTurn(effectiveQuestion, session, body.answer ?? "", readLanguage(id), {
      signal: req.signal,
      riskNotes: readAnalysis(id)?.riskNotes ?? [],
      style: session.interviewerStyle,
      timeRule: plan.rule,
    });
    // 硬规则兜底：超时档无论模型怎么决策都切题，不靠模型自觉
    if (plan.tier === "overq" || plan.tier === "tight") {
      decision.action = "next";
      decision.followUp = "";
      if (!decision.comment.trim()) {
        decision.comment = "时间关系，我们先进入下一题。";
      }
    }
    writeSession(session);
    return NextResponse.json({ ...decision, session });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "面试官决策失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  }
}
