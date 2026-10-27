import { NextResponse } from "next/server";
import { stopRun, type RunTask } from "@/lib/runRegistry";

const TASKS: RunTask[] = ["analyze", "generate", "classify"];

/** 停止一个进行中的长任务。运行已与 HTTP 请求解耦，「⏹ 停止」统一走这里 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { task?: string };
  if (!body.task || !TASKS.includes(body.task as RunTask)) {
    return NextResponse.json({ error: "task 必须是 analyze / generate / classify" }, { status: 400 });
  }
  return NextResponse.json({ ok: stopRun(id, body.task as RunTask) });
}
