import type { Bank, PracticeSession, TargetLanguage } from "../types";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, brainJson } from "./json";

/**
 * 复盘时的题库匹配（参考性质）：把试卷题对应到题库题，让用户能看参考答案做对照。
 * 评分不依赖它 —— 评分依据试卷题自带的考察点/评分要点。AI 猜完用户可在复盘里改选。
 */
export async function runMatchQuestions(
  session: PracticeSession,
  bank: Bank,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<Map<string, { bankQuestionId?: string; reason?: string }>> {
  const paperList = session.questions
    .map((q, i) => `PQID: ${q.id}\nQ${i + 1}（${q.section ?? "未分类"}）：${q.question}\n考察点：${q.notes ?? q.rubric ?? "（无）"}`)
    .join("\n\n");
  const bankList = bank.questions
    .filter((q) => q.status !== "archived")
    .map((q) => `- ${q.id} · ${q.question}`)
    .join("\n");
  const prompt = renderPrompt("match-questions", { bankList: bankList || "（题库为空）", paperList });
  archivePrompt(session.targetId, "match-questions", prompt);

  const data = await brainJson<{ matches: { paperQuestionId: string; bankQuestionId: string | null; reason?: string }[] }>(
    "match-questions",
    prompt,
    (raw) => {
      const arr = asObject(raw).matches;
      if (!Array.isArray(arr)) throw new Error("缺少 matches 数组");
      return {
        matches: arr
          .map((m) => {
            const mo = asObject(m);
            return {
              paperQuestionId: asString(mo.paperQuestionId),
              bankQuestionId: asString(mo.bankQuestionId) || null,
              reason: asString(mo.reason),
            };
          })
          .filter((m) => m.paperQuestionId),
      };
    },
    `{"matches":[{"paperQuestionId":"PQID","bankQuestionId":"题库ID或null","reason":"匹配理由"}]}`,
    opts?.signal,
  );

  const bankIds = new Set(bank.questions.map((q) => q.id));
  const known = new Set(session.questions.map((q) => q.id));
  const out = new Map<string, { bankQuestionId?: string; reason?: string }>();
  for (const m of data.matches) {
    if (!known.has(m.paperQuestionId)) continue;
    out.set(m.paperQuestionId, {
      bankQuestionId: m.bankQuestionId && bankIds.has(m.bankQuestionId) ? m.bankQuestionId : undefined,
      reason: m.reason || undefined,
    });
  }
  return out;
}
