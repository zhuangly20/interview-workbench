import { newId } from "../store";
import { langAnswerLen, langLabel } from "../lang";
import type { Analysis, BankQuestion, TargetInputs, TargetLanguage } from "../types";
import { toSection } from "../sections";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson } from "./json";

const SCHEMA_HINT = (lang: TargetLanguage) =>
  `{"questions":[{"question":"面试官的问题（${langLabel(lang)}）","followUps":["追问"],"rubric":"评分要点（含权重）","answer":"基于该简历的参考答案（${langLabel(lang)}）","notes":"出题理由","section":"intro|motivation|resume|role|knowledge|other"}]}`;

/**
 * 第二步：题目生成 —— 拆解 + 简历 → 一批新题（纯追加，调用方负责并入库）。
 * keepQuestions 语义 = 「不要重复」清单：调用方传入全部现有题面，生成结果与它们错开。
 */
export async function runGenerateBank(
  inputs: TargetInputs,
  analysis: Analysis | undefined,
  keepQuestions: string[],
  targetId?: string,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<BankQuestion[]> {
  const prompt = renderPrompt("generate-bank", {
    jd: inputs.jd || "（未提供）",
    background: inputs.background || "（未提供）",
    resume: inputs.resume || "（未提供）",
    analysis: analysis
      ? analysis.mapping
          .map((m) => {
            const match = m.matchLevel ? `（简历匹配：${m.matchLevel === "high" ? "高" : m.matchLevel === "medium" ? "中" : "低"}）` : "";
            return `- ${m.responsibility}${match}：能力（${m.capabilities.join("、")}）；考点（${m.checkpoints.join("、")}）${
              m.sampleQuestions?.length ? `；可能被问（${m.sampleQuestions.join(" / ")}）` : ""
            }`;
          })
          .join("\n") + (analysis.riskNotes.length ? `\n红线：${analysis.riskNotes.join("；")}` : "")
      : "（尚未拆解，请直接根据 JD 判断）",
    existing: keepQuestions.length ? keepQuestions.map((q) => `- ${q}`).join("\n") : "（暂无）",
    lang: langLabel(lang),
    langAnswerLen: langAnswerLen(lang),
  });
  if (targetId) archivePrompt(targetId, "generate-bank", prompt);

  const data = await brainJson<BankQuestion[]>(
    "generate-bank",
    prompt,
    (raw) => {
      const arr = asObject(raw).questions;
      if (!Array.isArray(arr)) throw new Error("缺少 questions 数组");
      return arr.map((q) => {
        const qo = asObject(q);
        return {
          id: newId("q"),
          question: asString(qo.question),
          followUps: asStringArray(qo.followUps).slice(0, 3),
          rubric: asString(qo.rubric),
          answer: asString(qo.answer),
          notes: asString(qo.notes),
          section: toSection(qo.section),
          status: "draft" as const,
          source: "ai-draft" as const,
          lastEdited: new Date().toISOString(),
        };
      });
    },
    SCHEMA_HINT(lang),
    opts?.signal,
  );

  const valid = data.filter((q) => q.question.trim().length > 0);
  if (!valid.length) throw new Error("生成的题目为空");
  return valid;
}
