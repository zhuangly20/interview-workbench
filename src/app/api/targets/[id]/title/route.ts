import { NextResponse } from "next/server";
import { readMeta, updateMeta } from "@/lib/store";
import { runExtractTitle } from "@/lib/pipeline/extractTitle";
import { PipelineError } from "@/lib/pipeline/json";

/** 岗位名称：POST 用大脑重新提取（用户没手改时才写入）；请求体带 {title} 则视为手动设置 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  if (!readMeta(id)) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  const manual = body.title?.trim();
  if (manual) {
    const meta = updateMeta(id, { title: manual.slice(0, 60) });
    return NextResponse.json({ meta });
  }
  try {
    const title = await runExtractTitle(id, { signal: req.signal });
    const meta = updateMeta(id, { title });
    return NextResponse.json({ meta });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    return NextResponse.json({ error: e instanceof Error ? e.message : "提取失败", raw }, { status: 502 });
  }
}
