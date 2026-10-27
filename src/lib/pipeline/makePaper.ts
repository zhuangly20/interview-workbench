import { newId } from "../store";
import { langLabel } from "../lang";
import type { Analysis, Paper, PaperQuestion, TargetInputs, TargetLanguage } from "../types";
import { toSection } from "../sections";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson } from "./json";

const SCHEMA_HINT = `{"questions":[{"question":"面试题","section":"intro|motivation|resume|role|knowledge|other","focus":["考察点"],"rubric":"评分要点（含权重）","notes":"考的是哪条职责/能力（中文）"}]}`;

/**
 * 模拟面试出卷：按拆解 + 时长现出一套试卷（题面全新表述，不抄题库）。
 * 每题自带考察点与评分要点 —— 评分主要依据它们，不依赖事后匹配题库。
 */
export async function runMakePaper(
  inputs: TargetInputs,
  analysis: Analysis,
  minutes: number,
  avoidQuestions: string[],
  targetId?: string,
  lang: TargetLanguage = "en",
  opts?: { override?: string; signal?: AbortSignal },
): Promise<Paper> {
  const count = minutes > 0 ? Math.max(1, Math.round(minutes / 3)) : 10;
  const analysisBlock = analysis.mapping
    .map((m) => {
      const match = m.matchLevel ? `（简历匹配：${m.matchLevel === "high" ? "高" : m.matchLevel === "medium" ? "中" : "低"}）` : "";
      return `- ${m.responsibility}${match}：能力（${m.capabilities.join("、")}）；考点（${m.checkpoints.join("、")}）${
        m.matchEvidence ? `；简历匹配处：${m.matchEvidence}` : ""
      }`;
    })
    .join("\n");
  const prompt = `${opts?.override?.trim() || renderPrompt("make-paper", {
    lang: langLabel(lang),
    minutes: minutes > 0 ? `${minutes} 分钟` : "不限时（约 10 题）",
    count: String(count),
    perQ: minutes > 0 ? String(Math.max(1, Math.round(minutes / count))) : "3",
    analysis: analysisBlock || "（无）",
    roleSummary: analysis.roleSummary || "",
    riskNotes: analysis.riskNotes.length ? analysis.riskNotes.join("；") : "（无）",
    avoid: avoidQuestions.length ? avoidQuestions.map((q) => `- ${q}`).join("\n") : "（暂无）",
  })}\n\n【候选人简历】\n${inputs.resume || "（未提供）"}\n\n【行业 / 岗位背景】\n${inputs.background || "（未提供）"}`;
  if (targetId) archivePrompt(targetId, "make-paper", prompt);

  const data = await brainJson<{ questions: PaperQuestion[] }>(
    "make-paper",
    prompt,
    (raw) => {
      const arr = asObject(raw).questions;
      if (!Array.isArray(arr)) throw new Error("缺少 questions 数组");
      return {
        questions: arr.map((q) => {
          const qo = asObject(q);
          return {
            id: newId("pq"),
            question: asString(qo.question),
            section: toSection(qo.section),
            focus: asStringArray(qo.focus),
            rubric: asString(qo.rubric),
            notes: asString(qo.notes),
          };
        }),
      };
    },
    SCHEMA_HINT,
    opts?.signal,
  );

  const valid = data.questions.filter((q) => q.question.trim().length > 0);
  if (!valid.length) throw new Error("生成的试卷为空");
  return {
    id: newId("paper"),
    targetId: targetId ?? "",
    minutes,
    analysisVersion: analysis.generatedAt,
    createdAt: new Date().toISOString(),
    questions: valid,
  };
}
