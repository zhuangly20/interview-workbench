import type { BankQuestion, PracticeSession, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asStringArray, brainJson } from "./json";

export interface TeachSettlement {
  covered: string[];
  missing: string[];
  gold: string[];
}

/** 语音教学收尾结算：豆包没有逐轮结构化输出，挂断后由我们的大脑从完整逐字稿
 * 一次性算出覆盖账本 + 金句（结果写回 turn.coverage / turn.gold）。 */
export async function runSettleTeach(
  current: BankQuestion,
  session: PracticeSession,
  transcript: string,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<TeachSettlement> {
  const prompt = renderPrompt("settle-teach", {
    question: current.question,
    rubric: current.rubric || "（无，按题面判断）",
    transcript,
    lang: langLabel(lang),
  });
  archivePrompt(session.targetId, "settle-teach", prompt);

  return brainJson<TeachSettlement>(
    "settle-teach",
    prompt,
    (raw) => {
      const o = asObject(raw);
      return {
        covered: asStringArray(o.covered),
        missing: asStringArray(o.missing),
        gold: asStringArray(o.gold),
      };
    },
    `{"covered":["已覆盖要点"],"missing":["还没覆盖要点"],"gold":["值得沉淀的原句"]}`,
    opts?.signal,
  );
}
