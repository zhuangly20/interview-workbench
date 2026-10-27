import type { BankQuestion, PracticeSession, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, brainJson } from "./json";

export interface TurnDecision {
  action: "followup" | "next";
  followUp: string;
  comment: string;
}

export type TimeTier = "ok" | "nudge" | "overq" | "tight" | "timeup";

export interface TimePlan {
  tier: TimeTier;
  /** 注入 practice-turn prompt 的【时间与节奏】段（不限时为固定文案） */
  rule: string;
  totalSec: number;
  perQSec: number;
}

/** 按开场时长档把整场时间摊到每题，算出当前该用哪种节奏决策。
 * 服务端硬规则：超时档（overq/tight）之后由 turn 路由强制 next，不依赖模型自觉。 */
export function computeTimePlan(
  session: Pick<PracticeSession, "plannedMinutes" | "questions">,
  elapsedSec: number,
  questionElapsedSec: number,
): TimePlan {
  const total = (session.plannedMinutes ?? 0) * 60;
  if (total <= 0) {
    return { tier: "ok", rule: "本场不限时，按正常面试节奏决策。", totalSec: 0, perQSec: 0 };
  }
  const perQ = Math.round(total / Math.max(1, session.questions.length));
  const m = session.plannedMinutes ?? 0;
  const n = session.questions.length;
  const em = Math.max(0, Math.round(elapsedSec / 60));
  if (elapsedSec >= total) {
    return {
      tier: "timeup",
      rule: `全场 ${m} 分钟已用完（已进行 ${em} 分钟）：不再提问，面试官致谢收尾。`,
      totalSec: total,
      perQSec: perQ,
    };
  }
  if (elapsedSec >= total * 0.85) {
    return {
      tier: "tight",
      rule: `全场只剩不到 15% 时间（已进行 ${em} 分钟 / 共 ${m} 分钟）：必须 action=next 不追问，并在 comment 里提醒候选人「后面请尽量精炼」。`,
      totalSec: total,
      perQSec: perQ,
    };
  }
  const qm = Math.max(0, Math.round(questionElapsedSec / 60));
  if (questionElapsedSec > perQ * 1.2) {
    return {
      tier: "overq",
      rule: `本题预算约 ${Math.round(perQ / 60)} 分钟，本题已进行 ${qm} 分钟，明显超时：除非回答严重缺关键要点，直接 action=next，并在 comment 里说明「时间关系，进入下一题」。`,
      totalSec: total,
      perQSec: perQ,
    };
  }
  if (elapsedSec >= total * 0.6) {
    return {
      tier: "nudge",
      rule: `全场时间已过六成（已进行 ${em} 分钟 / 共 ${m} 分钟；每题约 ${Math.round(perQ / 60)} 分钟）：除非回答明显缺关键要点，倾向 action=next；可在 comment 里自然提醒候选人「后面请尽量精炼」。`,
      totalSec: total,
      perQSec: perQ,
    };
  }
  return {
    tier: "ok",
    rule: `全场共 ${m} 分钟 ${n} 题，本题预算约 ${Math.round(perQ / 60)} 分钟；目前已进行 ${em} 分钟。按正常节奏决策。`,
    totalSec: total,
    perQSec: perQ,
  };
}

/** 第三步：陪练 —— 当前题 + 逐字稿历史 + rubric → 追问还是下一题 */
export async function runPracticeTurn(
  current: BankQuestion,
  session: PracticeSession,
  answer: string,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal; riskNotes?: string[]; style?: string; timeRule?: string },
): Promise<TurnDecision> {
  const history = session.turns
    .map((t) => {
      const fu = t.followUpQA.map((f) => `  追问：${f.q}\n  回答：${f.a}`).join("\n");
      return `Q：${t.question}\nA：${t.answer}${fu ? `\n${fu}` : ""}`;
    })
    .join("\n\n");
  const fuCount = session.turns.find((t) => t.questionId === current.id)?.followUpQA.length ?? 0;

  const prompt = renderPrompt("practice-turn", {
    question: current.question,
    rubric: current.rubric || "（无）",
    referenceAnswer: current.answer || "（无）",
    history: history || "（这是第一题）",
    answer,
    followUpRule: fuCount >= 2 ? "本题已追问两次，必须 action=next。" : `本题已追问 ${fuCount} 次，最多追问两次。`,
    style: opts?.style?.trim() || "专业友善，节奏平稳。",
    timeRule: opts?.timeRule?.trim() || "本场不限时，按正常面试节奏决策。",
    riskNotes: opts?.riskNotes?.length
      ? `红线（追问与点评必须遵守）：${opts.riskNotes.join("；")}`
      : "（本场无特别红线）",
    lang: langLabel(lang),
    // 供 mock 大脑读取的确定性标记
    mockAction: fuCount >= 2 ? "next" : answer.trim().length >= 200 ? "next" : "followup",
  });
  archivePrompt(session.targetId, "practice-turn", prompt);

  return brainJson<TurnDecision>(
    "practice-turn",
    prompt,
    (raw) => {
      const o = asObject(raw);
      const action = asString(o.action) === "followup" ? "followup" : "next";
      return {
        action,
        followUp: asString(o.followUp),
        comment: asString(o.comment),
      };
    },
    `{"action":"followup 或 next","followUp":"追问文本（action=next 时为空）","comment":"一句简短点评"}`,
    opts?.signal,
  );
}
