import { NextResponse } from "next/server";
import { deleteTarget, readBundle, updateMeta } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = readBundle(id);
  if (!bundle) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  return NextResponse.json(bundle);
}

/** 改岗位名称等 meta 信息（手改后不再被 AI 提取覆盖） */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "岗位名称不能为空" }, { status: 400 });
  const meta = updateMeta(id, { title: title.slice(0, 60) });
  if (!meta) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  return NextResponse.json({ meta });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteTarget(id);
  return NextResponse.json({ ok: true });
}
