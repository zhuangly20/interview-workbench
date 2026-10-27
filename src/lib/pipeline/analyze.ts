import type { Analysis, CapabilityMap, TargetInputs } from "../types";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, asStringArray, brainJson, extractJson, PipelineError } from "./json";

const SCHEMA_HINT = `{"roleSummary":"一句话岗位画像","mapping":[{"responsibility":"职责","capabilities":["能力"],"checkpoints":["考点"],"jdEvidence":"JD 原文依据","matchLevel":"high|medium|low","matchEvidence":"简历匹配理由，多条用「；」分隔","sampleQuestions":["可能被问的问题"]}],"riskNotes":["风险或红线"]}`;

function toAnalysis(o: unknown): Analysis {
  const obj = asObject(o);
  return {
    roleSummary: asString(obj.roleSummary),
    mapping: Array.isArray(obj.mapping) ? obj.mapping.map(normalizeCard) : [],
    riskNotes: asStringArray(obj.riskNotes),
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
}

/** 严格校验：每张卡必须带全 jdEvidence / matchLevel / sampleQuestions，缺了就重试（否则界面全是「（无）」） */
function strictValidate(raw: unknown): Analysis {
  const data = toAnalysis(raw);
  if (!asString(asObject(raw).roleSummary).trim()) throw new Error("缺 roleSummary");
  if (!data.mapping.length) throw new Error("mapping 为空");
  const bad = data.mapping
    .map((c, i) => {
      const missing = [
        !c.jdEvidence && "jdEvidence",
        !c.matchLevel && "matchLevel",
        !c.sampleQuestions?.length && "sampleQuestions",
      ].filter(Boolean);
      return missing.length ? `第${i + 1}张卡缺 ${missing.join("、")}` : "";
    })
    .filter(Boolean);
  if (bad.length) throw new Error(bad.join("；"));
  return data;
}

/** matchLevel 宽容归一：中英文与大小写都接受，不认识的一律 undefined */
export function normalizeMatchLevel(v: unknown): "high" | "medium" | "low" | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["high", "h", "高", "高匹配"].includes(s)) return "high";
  if (["medium", "med", "m", "中", "中匹配", "部分匹配"].includes(s)) return "medium";
  if (["low", "l", "低", "低匹配"].includes(s)) return "low";
  return undefined;
}

/** 把模型/前端给的一条卡补全成合法 CapabilityMap（手动加卡与新字段宽容解析共用） */
export function normalizeCard(m: unknown): CapabilityMap {
  const mo = asObject(m);
  const sq = Array.isArray(mo.sampleQuestions) ? mo.sampleQuestions.map((x) => asString(x).trim()).filter(Boolean) : [];
  const jde = asString(mo.jdEvidence).trim();
  const me = asString(mo.matchEvidence).trim();
  return {
    responsibility: asString(mo.responsibility).trim(),
    capabilities: asStringArray(mo.capabilities).map((s) => s.trim()).filter(Boolean),
    checkpoints: asStringArray(mo.checkpoints).map((s) => s.trim()).filter(Boolean),
    jdEvidence: jde || undefined,
    matchLevel: normalizeMatchLevel(mo.matchLevel),
    matchEvidence: me || undefined,
    sampleQuestions: sq.length ? sq : undefined,
  };
}

/** 三份材料拼装成提示词的「材料区」；指令区（用户可改）与材料区分离，材料始终取自 inputs */
export function buildMaterials(inputs: TargetInputs): string {
  return [
    `【岗位 JD】\n${inputs.jd || "（未提供）"}`,
    `【行业 / 岗位背景信息】\n${inputs.background || "（未提供）"}`,
    `【候选人简历】\n${inputs.resume || "（未提供）"}`,
  ].join("\n\n");
}

/** 第一步：拆解 —— 指令（默认模板或用户改写）+ 材料 → 拆解卡（职责→能力→考点 + 简历匹配 + 可能被问的问题） */
export async function runAnalyze(
  inputs: TargetInputs,
  targetId?: string,
  opts?: { override?: string; signal?: AbortSignal },
): Promise<Analysis> {
  const prompt = `${opts?.override?.trim() || renderPrompt("analyze", {})}\n\n${buildMaterials(inputs)}`;
  if (targetId) archivePrompt(targetId, "analyze", prompt);

  let data: Analysis;
  try {
    data = await brainJson<Analysis>("analyze", prompt, strictValidate, SCHEMA_HINT, opts?.signal);
  } catch (e) {
    if (opts?.signal?.aborted || !(e instanceof PipelineError)) throw e;
    // 两次都缺字段：宽容降级收下（缺的字段界面显示（无），可单卡重生成补全），总比整步失败好
    data = toAnalysis(extractJson(e.raw));
    if (!data.mapping.length) throw e;
  }

  if (!data.mapping.length) throw new Error("拆解结果为空");
  return data;
}
