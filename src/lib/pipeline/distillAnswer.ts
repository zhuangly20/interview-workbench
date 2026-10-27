import type { BankQuestion, ChatMsg, PracticeSession, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson } from "./json";

export interface DistillProposal {
  /** 带 ✨ 金句标记的参考答案全文草稿（纯展示，用户自己复制进题库） */
  referenceDraft: string;
  gold: string[];
  uncovered: string[];
}

/** 教学场次蒸馏：把练出来的好句子融成一份完整参考答案草稿。
 * 结果缓存进场次数据（session.distill），纯展示不写题库。 */
export async function runDistillAnswer(
  current: BankQuestion,
  session: PracticeSession,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<DistillProposal> {
  const turn = session.turns.find((t) => t.questionId === current.id);
  // 教学场次逐字稿 = 聊天流；兼容老场次（answer + followUpQA）
  const transcript: string = turn?.chat?.length
    ? turn.chat.map((m) => `${m.role === "user" ? "候选人" : "教练"}：${m.text}`).join("\n")
    : [
        turn?.answer ? `候选人：${turn.answer}` : "",
        ...(turn?.followUpQA ?? []).map((f) => `教练：${f.q}\n候选人：${f.a}`),
      ]
        .filter(Boolean)
        .join("\n") || "（无逐字稿）";

  const prompt = renderPrompt("distill-answer", {
    question: current.question,
    rubric: current.rubric || "（无）",
    referenceAnswer: current.answer || "（空）",
    gold: turn?.gold?.length ? turn.gold.join("\n") : "（无标记）",
    transcript,
    lang: langLabel(lang),
  });
  archivePrompt(session.targetId, "distill-answer", prompt);

  return brainJson<DistillProposal>(
    "distill-answer",
    prompt,
    (raw) => {
      const o = asObject(raw);
      return {
        referenceDraft: asString(o.referenceDraft),
        gold: asStringArray(o.gold),
        uncovered: asStringArray(o.uncovered),
      };
    },
    `{"referenceDraft":"完整{{lang}}参考答案草稿，金句用✨成对标记","uncovered":["还没聊到的要点"]}`,
    opts?.signal,
  );
}
