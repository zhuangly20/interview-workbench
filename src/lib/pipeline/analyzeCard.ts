import type { CapabilityMap, TargetInputs } from "../types";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { brainJson } from "./json";
import { buildMaterials, normalizeCard } from "./analyze";

const SCHEMA_HINT = `{"responsibility":"职责","capabilities":["能力"],"checkpoints":["考点"],"jdEvidence":"JD 原文依据","matchLevel":"high|medium|low","matchEvidence":"简历匹配经历","sampleQuestions":["可能被问的问题"]}`;

/** 单卡重生成：只重跑一张拆解卡（共享模板 prompts/analyze-card.md + 该条职责插值） */
export async function runAnalyzeCard(
  inputs: TargetInputs,
  roleSummary: string,
  duty: string,
  targetId?: string,
  opts?: { override?: string; signal?: AbortSignal },
): Promise<CapabilityMap> {
  const prompt = `${opts?.override?.trim() || renderPrompt("analyze-card", {
    roleSummary: roleSummary || "（无）",
    duty,
  })}\n\n${buildMaterials(inputs)}`;
  if (targetId) archivePrompt(targetId, "analyze-card", prompt);

  const card = await brainJson<CapabilityMap>(
    "analyze-card",
    prompt,
    (raw) => normalizeCard(raw),
    SCHEMA_HINT,
    opts?.signal,
  );
  if (!card.responsibility && !card.capabilities.length) throw new Error("生成的拆解卡为空");
  return card;
}
