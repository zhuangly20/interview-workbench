import { NextResponse } from "next/server";
import {
  defaultInstruction,
  readAnalysis,
  readBank,
  readInputs,
  readLanguage,
  readPromptOverrideAt,
  writeBank,
  writePromptOverrideAt,
  clearPromptOverrideAt,
} from "@/lib/store";
import { runRegenQuestion } from "@/lib/pipeline/regenQuestion";
import { PipelineError } from "@/lib/pipeline/json";

/**
 * 单题重跑（共享模板 + 本题插值）：
 * - GET：默认模板 + 用户改写
 * - POST {qid, instruction?, preview?}：preview 只返回渲染后的完整提示词；否则只重写这一题
 * 锁定的题也允许重跑（锁防的是批量重新生成，不拦用户主动重跑），前端做二次确认。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({
    instruction: defaultInstruction("regen-question"),
    override: readPromptOverrideAt(id, "regen-question") ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { qid?: string; instruction?: string | null; preview?: boolean };
  const bank = readBank(id);
  const question = bank.questions.find((q) => q.id === body.qid);
  if (!question) return NextResponse.json({ error: "题目不存在" }, { status: 404 });

  let override = readPromptOverrideAt(id, "regen-question");
  if (typeof body.instruction === "string") {
    if (!body.instruction.trim()) {
      return NextResponse.json({ error: "提示词不能为空（想恢复默认请点「恢复默认」）" }, { status: 400 });
    }
    const isDefault = body.instruction.trim() === defaultInstruction("regen-question").trim();
    if (isDefault) clearPromptOverrideAt(id, "regen-question");
    else writePromptOverrideAt(id, "regen-question", body.instruction);
    override = isDefault ? undefined : body.instruction;
  }

  const inputs = readInputs(id);
  const analysis = readAnalysis(id);
  const lang = readLanguage(id);
  const riskNotes = analysis?.riskNotes ?? [];

  if (body.preview) {
    const { buildRegenPrompt } = await import("@/lib/pipeline/regenQuestion");
    const prompt = buildRegenPrompt(inputs, analysis, question, riskNotes, lang, override);
    return NextResponse.json({ rendered: prompt });
  }

  try {
    const patch = await runRegenQuestion(inputs, analysis, question, riskNotes, id, lang, {
      override,
      signal: req.signal,
    });
    bank.questions = bank.questions.map((q) =>
      q.id === question.id ? { ...q, ...patch, lastEdited: new Date().toISOString() } : q,
    );
    bank.version += 1;
    writeBank(id, bank);
    return NextResponse.json({ question: bank.questions.find((q) => q.id === question.id) });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    return NextResponse.json({ error: e instanceof Error ? e.message : "重写失败", raw }, { status: 502 });
  }
}
