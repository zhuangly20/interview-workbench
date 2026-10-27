import { langAnswerLen, langLabel } from "../lang";
import type { Analysis, BankQuestion, TargetInputs, TargetLanguage } from "../types";
import { toSection } from "../sections";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson } from "./json";
import { buildMaterials } from "./analyze";

const SCHEMA_HINT = (lang: TargetLanguage) =>
  `{"question":"重写后的面试题（${langLabel(lang)}）","followUps":["追问"],"rubric":"评分要点（含权重）","answer":"基于该简历的参考答案（${langLabel(lang)}）","notes":"重写理由（中文）","section":"intro|motivation|resume|role|knowledge|other"}`;

/** 渲染单题重跑的完整提示词（模板 + 本题 QID 块 + 三件套材料）——预览与真正重跑共用 */
export function buildRegenPrompt(
  inputs: TargetInputs,
  analysis: Analysis | undefined,
  question: Pick<BankQuestion, "id" | "section" | "question" | "followUps" | "rubric" | "answer" | "notes">,
  riskNotes: string[],
  lang: TargetLanguage,
  override?: string,
): string {
  return `${override?.trim() || renderPrompt("regen-question", {
    lang: langLabel(lang),
    langAnswerLen: langAnswerLen(lang),
    analysis: analysis
      ? analysis.mapping
          .map((m) => `- ${m.responsibility}：能力（${m.capabilities.join("、")}）；考点（${m.checkpoints.join("、")}）`)
          .join("\n")
      : "（尚未拆解）",
    riskNotes: riskNotes.length ? riskNotes.join("；") : "（无）",
  })}\n\n【要重写的题目】\nQID: ${question.id}\n板块：${question.section ?? "未分类"}\n题干：${question.question}\n追问：${
    question.followUps.join(" / ") || "（无）"
  }\n评分要点：${question.rubric || "（无）"}\n参考答案：${question.answer || "（无）"}\n备注：${
    question.notes || "（无）"
  }\n\n${buildMaterials(inputs)}`;
}

/** 单题重跑：用户在题库页展开某题 → 看渲染后的提示词 → 改模板 → 只重写这一题（追问/rubric/参考答案/板块） */
export async function runRegenQuestion(
  inputs: TargetInputs,
  analysis: Analysis | undefined,
  question: BankQuestion,
  riskNotes: string[],
  targetId?: string,
  lang: TargetLanguage = "en",
  opts?: { override?: string; signal?: AbortSignal },
): Promise<Partial<BankQuestion>> {
  const prompt = buildRegenPrompt(inputs, analysis, question, riskNotes, lang, opts?.override);
  if (targetId) archivePrompt(targetId, "regen-question", prompt);

  const data = await brainJson<Partial<BankQuestion>>(
    "regen-question",
    prompt,
    (raw) => {
      const o = asObject(raw);
      const q = asString(o.question).trim();
      if (!q) throw new Error("重写结果缺少题干");
      return {
        question: q,
        followUps: asStringArray(o.followUps).slice(0, 3),
        rubric: asString(o.rubric),
        answer: asString(o.answer),
        notes: asString(o.notes),
        section: toSection(o.section),
      };
    },
    SCHEMA_HINT(lang),
    opts?.signal,
  );
  return data;
}
