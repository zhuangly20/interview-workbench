import { NextResponse } from "next/server";
import { readBank } from "@/lib/store";
import { ensureBankFilled } from "@/lib/bankGen";
import { PipelineError } from "@/lib/pipeline/json";

/**
 * 题目生成（纯追加）：见 ensureBankFilled。拆解成功后也会自动触发同样的后台出题。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const added = await ensureBankFilled(id);
    return NextResponse.json({ bank: readBank(id), added });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ error: "已停止" }, { status: 400 });
    }
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "出题失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  }
}
