import { NextResponse } from "next/server";
import {
  clearPromptOverrideAt,
  defaultInstruction,
  isOverrideKey,
  readPromptOverrideAt,
  writePromptOverrideAt,
} from "@/lib/store";

/** 各管线共享提示词模板的读取/改写/恢复默认。key 见 store.OVERRIDE_KEYS（analysis/analysis-card/regen-question/score/paper） */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!isOverrideKey(key)) return NextResponse.json({ error: "未知的提示词 key" }, { status: 400 });
  return NextResponse.json({
    key,
    instruction: defaultInstruction(key),
    override: readPromptOverrideAt(id, key) ?? null,
  });
}

/** 保存改写；传 {reset:true} 恢复默认（清掉改写文件） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { key?: string; instruction?: string; reset?: boolean };
  if (!body.key || !isOverrideKey(body.key)) return NextResponse.json({ error: "未知的提示词 key" }, { status: 400 });
  if (body.reset) {
    clearPromptOverrideAt(id, body.key);
    return NextResponse.json({ ok: true, override: null });
  }
  const text = body.instruction?.trim();
  if (!text) return NextResponse.json({ error: "提示词不能为空（恢复默认请传 reset）" }, { status: 400 });
  writePromptOverrideAt(id, body.key, text);
  return NextResponse.json({ ok: true, override: text });
}
