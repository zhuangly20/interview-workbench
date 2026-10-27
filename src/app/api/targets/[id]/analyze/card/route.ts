import { NextResponse } from "next/server";
import {
  defaultInstruction,
  listAnalysisVersions,
  readAnalysis,
  readInputs,
  readPromptOverrideAt,
  saveAnalysisWithHistory,
  writePromptOverrideAt,
  clearPromptOverrideAt,
} from "@/lib/store";
import { runAnalyzeCard } from "@/lib/pipeline/analyzeCard";
import { buildMaterials } from "@/lib/pipeline/analyze";
import { renderPrompt } from "@/lib/promptLoader";
import { PipelineError } from "@/lib/pipeline/json";

/**
 * 单卡重生成（共享模板 + 该条职责插值）：
 * - GET：默认模板 + 用户改写 + 渲染材料区说明
 * - POST {index, instruction?, preview?}：preview 只返回渲染后的完整提示词；否则重跑这一张卡
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({
    instruction: defaultInstruction("analyze-card"),
    override: readPromptOverrideAt(id, "analysis-card") ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    index?: number;
    instruction?: string | null;
    preview?: boolean;
  };
  const analysis = readAnalysis(id);
  if (!analysis) return NextResponse.json({ error: "还没有拆解结果" }, { status: 400 });
  const index = typeof body.index === "number" ? body.index : -1;
  if (index < 0 || index >= analysis.mapping.length) {
    return NextResponse.json({ error: "卡片序号无效" }, { status: 400 });
  }
  const duty = analysis.mapping[index].responsibility?.trim();
  if (!duty) return NextResponse.json({ error: "这张卡还没有职责，先填职责再重新生成" }, { status: 400 });

  // 提示词：与拆解主模板同规则——传了就保存改写（与默认相同则清掉）
  let override = readPromptOverrideAt(id, "analysis-card");
  if (typeof body.instruction === "string") {
    if (!body.instruction.trim()) {
      return NextResponse.json({ error: "提示词不能为空（想恢复默认请点「恢复默认」）" }, { status: 400 });
    }
    const isDefault = body.instruction.trim() === defaultInstruction("analyze-card").trim();
    if (isDefault) clearPromptOverrideAt(id, "analysis-card");
    else writePromptOverrideAt(id, "analysis-card", body.instruction);
    override = isDefault ? undefined : body.instruction;
  }

  const inputs = readInputs(id);
  const prompt = `${
    override?.trim() ||
    `${renderPrompt("analyze-card", { roleSummary: analysis.roleSummary || "（无）", duty })}\n\n${buildMaterials(inputs)}`
  }`;
  if (body.preview) {
    return NextResponse.json({ rendered: prompt });
  }

  try {
    const card = await runAnalyzeCard(inputs, analysis.roleSummary, duty, id, {
      override,
      signal: req.signal,
    });
    const mapping = [...analysis.mapping];
    mapping[index] = card;
    const next = {
      ...analysis,
      mapping,
      generatedAt: new Date().toISOString(),
      source: "user-edited" as const,
    };
    saveAnalysisWithHistory(id, next);
    return NextResponse.json({ analysis: next, versions: listAnalysisVersions(id) });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    return NextResponse.json({ error: e instanceof Error ? e.message : "重生成失败", raw }, { status: 502 });
  }
}
