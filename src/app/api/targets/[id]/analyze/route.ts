import { NextResponse } from "next/server";
import { defaultAnalyzeInstruction, readInputs, readPromptOverride, readAnalysisVersion, listAnalysisVersions, readAnalysis, saveAnalysisWithHistory, writeAnalysis, clearPromptOverride, writePromptOverride } from "@/lib/store";
import type { Analysis } from "@/lib/types";
import { runAnalyze, normalizeCard } from "@/lib/pipeline/analyze";
import { PipelineError } from "@/lib/pipeline/json";
import { startRun, endRun } from "@/lib/runRegistry";
import { ensureBankFilled } from "@/lib/bankGen";

/** 拆解页 DIY 所需数据：默认指令模板 + 用户改写 + 三件套 + 版本历史 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({
    instruction: defaultAnalyzeInstruction(),
    override: readPromptOverride(id) ?? null,
    materials: readInputs(id),
    versions: listAnalysisVersions(id),
  });
}

/**
 * POST 重新拆解。
 * - body 为空 / {instruction: null}：沿用已保存的改写（没有就用默认模板）。
 * - {instruction: "..."}：用这段指令拆解；与默认模板不同则持久化改写，相同则清掉改写。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { instruction?: string | null };
  const instruction = typeof body.instruction === "string" ? body.instruction : undefined;
  if (instruction !== undefined) {
    if (!instruction.trim()) {
      return NextResponse.json({ error: "提示词不能为空（想恢复默认请点「恢复默认」）" }, { status: 400 });
    }
    if (instruction.trim() === defaultAnalyzeInstruction().trim()) clearPromptOverride(id);
    else writePromptOverride(id, instruction);
  }
  // 运行与这次 HTTP 请求解耦：用户切走页面、连接断开都继续跑完；「⏹ 停止」走 /runs/stop
  const signal = startRun(id, "analyze");
  try {
    const analysis = await runAnalyze(readInputs(id), id, {
      override: instruction ?? readPromptOverride(id),
      signal,
    });
    saveAnalysisWithHistory(id, analysis);
    // 拆解完成 → 自动后台补充题库（注册表任务 generate，切页不断；失败静默，手动出题仍可用）
    void ensureBankFilled(id).catch(() => {});
    return NextResponse.json({ analysis, versions: listAnalysisVersions(id) });
  } catch (e) {
    if (signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "拆解失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  } finally {
    endRun(id, "analyze");
  }
}

/** 恢复默认提示词（清除改写） */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  clearPromptOverride(id);
  return NextResponse.json({ ok: true });
}

/** 保存拆解页上的手动编辑（source 标记为 user-edited，不整体归档） */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { analysis?: Partial<Analysis> };
  const a = body.analysis;
  if (!a || !Array.isArray(a.mapping)) {
    return NextResponse.json({ error: "analysis 数据不完整" }, { status: 400 });
  }
  const prev = readAnalysis(id);
  const analysis: Analysis = {
    roleSummary: String(a.roleSummary ?? ""),
    mapping: a.mapping.map(normalizeCard),
    riskNotes: Array.isArray(a.riskNotes) ? a.riskNotes.map(String) : [],
    generatedAt: new Date().toISOString(),
    source: "user-edited",
    editedSections: a.editedSections ?? prev?.editedSections,
  };
  writeAnalysis(id, analysis);
  return NextResponse.json({ analysis });
}

/** 查看某个历史版本；带 restore=true 则回滚为该版本（当前版会先自动归档） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { file?: string; restore?: boolean };
  if (!body.file) return NextResponse.json({ error: "缺少 file" }, { status: 400 });
  const v = readAnalysisVersion(id, body.file);
  if (!v) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  if (body.restore) {
    saveAnalysisWithHistory(id, v);
  }
  return NextResponse.json({ analysis: v, current: readAnalysis(id) });
}
