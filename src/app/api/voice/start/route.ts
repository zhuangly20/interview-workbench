import { NextResponse } from "next/server";
import { getSettings, listSessions, newId, readBank, readLanguage, readSession } from "@/lib/store";
import { renderPrompt } from "@/lib/promptLoader";
import { langSpokenName } from "@/lib/lang";
import { createRtcToken } from "@/lib/voice/token";
import {
  buildStartVoiceChatBody,
  invokeRtcApi,
  missingVoiceCredentials,
} from "@/lib/voice/rtcApi";

interface StartBody {
  targetId?: string;
  sid?: string;
  /** 教学模式必传（单题）；模拟面试整场模式不需要 */
  questionId?: string;
  /** T6 教学模式：豆包改说陪练教练协议（自然聊天、候选人控节奏） */
  teach?: boolean;
}

/** 跨场次账本：该题最近一次有结算结果的教学场次 → 注入开场提示词，漂移不跨场累积。
 * 含当前场次（先文字轮后进语音时，本场的文字账本同样生效）。 */
function priorLedger(targetId: string, questionId: string): string {
  const candidates = listSessions(targetId)
    .filter((s) => s.mode === "single" && s.questionIds.includes(questionId))
    .map((s) => readSession(targetId, s.id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  for (const s of candidates) {
    const cov = s.turns.find((t) => t.questionId === questionId)?.coverage;
    if (cov && (cov.covered.length || cov.missing.length)) {
      return `Previously practiced: ${cov.covered.join("; ") || "(none)"}\nNot yet practiced: ${cov.missing.join("; ") || "(none)"}`;
    }
  }
  return "First practice on this question — no prior ledger.";
}

export async function POST(req: Request) {
  const body = (await req.json()) as StartBody;
  if (!body.targetId || !body.sid) {
    return NextResponse.json({ error: "缺少 targetId / sid" }, { status: 400 });
  }
  // targetId 走请求 body，不经过 URL 解码层；旧客户端可能传编码态（%xx 字面量）——解回原值
  let targetId = body.targetId;
  if (targetId.includes("%")) {
    try {
      targetId = decodeURIComponent(targetId);
    } catch {
      /* 保留原值 */
    }
  }

  const settings = getSettings();
  const v = settings.voice.volcengine;
  const missing = missingVoiceCredentials(v);
  if (missing.length) {
    return NextResponse.json(
      { error: `火山语音未配置，请在设置页补齐：${missing.join("、")}` },
      { status: 400 },
    );
  }

  const session = readSession(targetId, body.sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  if (session.finishedAt) return NextResponse.json({ error: "本场已结束" }, { status: 409 });

  const teach = body.teach === true;
  if (teach && !body.questionId) {
    return NextResponse.json({ error: "教学模式缺少 questionId" }, { status: 400 });
  }
  const snapshot = body.questionId
    ? session.questions.find((q) => q.id === body.questionId)
    : undefined;
  if (body.questionId && !snapshot) {
    return NextResponse.json({ error: "题目不在本场清单里" }, { status: 400 });
  }

  const lang = readLanguage(targetId);
  const langSpoken = langSpokenName(lang);
  const bank = readBank(targetId);
  const styleText = session.interviewerStyle?.trim() ?? "";

  let systemMessage: string;
  let welcomeMessage: string;
  let historyLength = 6;

  if (teach) {
    // T6 教学模式：陪练教练协议 + 跨场次覆盖账本（豆包开场即知道该优先练什么）
    // 评分/答题依据优先用本场快照（题目可能已不在题库），老场次回退题库
    const bankQuestion = bank.questions.find((q) => q.id === body.questionId);
    systemMessage = renderPrompt("voice-teach", {
      question: snapshot?.question ?? "",
      rubric:
        snapshot?.rubric?.trim() || bankQuestion?.rubric?.trim() || "(none — just chat about the question naturally)",
      referenceAnswer: snapshot?.referenceAnswer?.trim() || bankQuestion?.answer?.trim() || "(none)",
      ledger: priorLedger(targetId, body.questionId ?? ""),
      lang: langSpoken,
    });
    // 教学开场白带一点口语引入
    welcomeMessage =
      lang === "zh"
        ? `来，咱们练这道题——${snapshot?.question ?? ""}`
        : `Let's practice this one — ${snapshot?.question ?? ""}`;
  } else {
    // 模拟面试 = 一通连续电话：整份题单 + 时间预算 + 结束语注入协议，
    // 豆包自己推进追问与切题，说完结束语客户端自动挂断（用户只管说话）。
    if (!session.questions.length) {
      return NextResponse.json({ error: "本场没有题目，无法开始模拟" }, { status: 400 });
    }
    const questionBlock = session.questions
      .map((snap, i) => {
        const bq = bank.questions.find((b) => b.id === snap.id);
        const rubric = snap.rubric?.trim() || bq?.rubric?.trim();
        const noteText = snap.notes?.trim() || bq?.notes?.trim();
        const notes = [rubric, noteText].filter(Boolean).join("；") || "(none)";
        return `Question ${i + 1}: ${snap.question}\n  Coverage notes (internal, never read aloud): ${notes}`;
      })
      .join("\n");
    const m = session.plannedMinutes ?? 0;
    const timeRule =
      m > 0
        ? `Total ${m} minutes for ${session.questions.length} questions (~${Math.max(1, Math.round(m / session.questions.length))} minutes each). You keep the time yourself: watch how much has been discussed and keep the pace.`
        : "No fixed time limit — keep a natural interview pace in one smooth flow.";
    const closing =
      lang === "zh"
        ? "今天的面试就到这里，谢谢你的时间。"
        : "That's the end of today's interview — thank you for your time.";
    systemMessage =
      renderPrompt("voice-interview-whole", {
        lang: langSpoken,
        questions: questionBlock,
        timeRule,
        closing,
      }) +
      // T7 面试官风格：开场选的（可改）风格提示同样约束语音模式里的豆包
      (styleText ? `\n\n【面试官风格】${styleText}` : "");
    welcomeMessage =
      lang === "zh"
        ? `你好，欢迎参加今天的面试，我们直接开始。第一个问题：${session.questions[0].question}`
        : `Hi, thanks for joining today's interview. Let's get started. First question: ${session.questions[0].question}`;
    // 整场要记住前面所有问答，房间记忆轮数加长
    historyLength = 24;
  }

  // 压力面节奏：静默判定收紧到 500ms，候选人话音刚落 AI 就接话，营造压迫感
  const silenceMs = /压力|强势|尖锐|质询/.test(styleText) ? 500 : undefined;

  // 每场一个对话任务（教学按题、模拟按场）：干净切分、逐字稿整段落
  const roomId = `wb_${newId("r").slice(2)}`;
  const userId = `u_${newId("u").slice(2)}`;
  const agentUserId = "interviewer";
  const taskId = `task_${newId("t").slice(2)}`;

  const token = createRtcToken(v.appId, v.appKey, roomId, userId);

  try {
    await invokeRtcApi(
      { accessKeyId: v.accessKeyId, secretKey: v.secretKey },
      "StartVoiceChat",
      buildStartVoiceChatBody({
        appId: v.appId,
        roomId,
        taskId,
        agentUserId,
        targetUserId: userId,
        systemMessage,
        // 开场白直接 TTS 播报，保证题目准确；协议里已要求 LLM 不复述
        welcomeMessage,
        llmModel: v.llmModel,
        voiceType: v.voiceType,
        silenceMs,
        historyLength,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "StartVoiceChat 调用失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    appId: v.appId,
    roomId,
    userId,
    agentUserId,
    taskId,
    token,
  });
}
