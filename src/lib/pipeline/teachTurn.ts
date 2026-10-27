import type { BankQuestion, ChatMsg, Coverage, PracticeSession, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson } from "./json";

export interface TeachDecision {
  /** 教练回复（已追加进 turn.chat） */
  reply: string;
  /** 服务端合并后的覆盖账本（模型输出 ∪ 旧账本，missing 剔除已覆盖项） */
  coverage: Coverage;
  /** 本轮新增的金句 */
  gold: string[];
  /** 候选人明确说停 → true（教练已收尾，前端展示结束态） */
  ended: boolean;
}

const MAX_ROUNDS = 50;

function renderChat(chat: ChatMsg[]): string {
  return chat.map((m) => `${m.role === "user" ? "候选人" : "教练"}：${m.text}`).join("\n") || "（候选人还没开口）";
}

/** T6 教学模式（文字通道）：像陪练 App 一样自然聊天，每轮顺手维护覆盖账本与金句。
 * 节奏归候选人：不说停就一直练（硬护栏 MAX_ROUNDS 只防失控）。 */
export async function runTeachTurn(
  current: BankQuestion,
  session: PracticeSession,
  message: string,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<TeachDecision> {
  let turn = session.turns.find((t) => t.questionId === current.id);
  if (!turn) {
    turn = { questionId: current.id, question: current.question, answer: "", followUpQA: [], chat: [], coverage: { covered: [], missing: [] }, gold: [] };
    session.turns.push(turn);
  }
  turn.chat ??= [];
  turn.coverage ??= { covered: [], missing: [] };
  turn.gold ??= [];

  const userRounds = turn.chat.filter((m) => m.role === "user").length;
  const endedByGuard = userRounds >= MAX_ROUNDS;
  turn.chat.push({ role: "user", text: message, at: new Date().toISOString() });

  if (endedByGuard) {
    const reply = "（陪练轮数已达上限，本题收尾）";
    turn.chat.push({ role: "coach", text: reply, at: new Date().toISOString() });
    return { reply, coverage: turn.coverage, gold: [], ended: true };
  }

  const prompt = renderPrompt("teach-turn", {
    question: current.question,
    rubric: current.rubric || "（无，就题面自然陪聊）",
    referenceAnswer: current.answer || "（无）",
    covered: turn.coverage.covered.length ? turn.coverage.covered.join("；") : "（暂无）",
    missing: turn.coverage.missing.length ? turn.coverage.missing.join("；") : "（暂无）",
    gold: turn.gold.length ? turn.gold.join("；") : "（暂无）",
    history: renderChat(turn.chat.slice(0, -1)),
    message,
    round: `${userRounds + 1}`,
    lang: langLabel(lang),
  });
  archivePrompt(session.targetId, "teach-turn", prompt);

  const decision = await brainJson<{ reply: string; covered: string[]; missing: string[]; gold: string[]; ended: boolean }>(
    "teach-turn",
    prompt,
    (raw) => {
      const o = asObject(raw);
      return {
        reply: asString(o.reply),
        covered: asStringArray(o.covered),
        missing: asStringArray(o.missing),
        gold: asStringArray(o.gold),
        ended: o.ended === true,
      };
    },
    `{"reply":"{{lang}}教练回复","covered":["已覆盖要点"],"missing":["还没覆盖要点"],"gold":["值得沉淀的原句"],"ended":false}`,
    opts?.signal,
  );

  // 服务端合并账本：covered 并集；missing 以模型输出为准（空则沿用旧账），剔除已覆盖项
  const covered = [...turn.coverage.covered];
  for (const c of decision.covered) if (!covered.includes(c)) covered.push(c);
  const missingSrc = decision.missing.length ? decision.missing : turn.coverage.missing;
  const missing = missingSrc.filter((m) => !covered.includes(m));
  turn.coverage = { covered, missing };

  const goldList = turn.gold;
  const newGold = decision.gold.filter((g) => g.trim() && !goldList.includes(g));
  goldList.push(...newGold);
  turn.chat.push({ role: "coach", text: decision.reply, at: new Date().toISOString() });

  return { reply: decision.reply, coverage: turn.coverage, gold: newGold, ended: decision.ended };
}
