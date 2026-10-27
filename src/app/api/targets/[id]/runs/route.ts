import { NextResponse } from "next/server";
import { listRuns } from "@/lib/runRegistry";

/** 查询该目标正在运行的长任务（拆解/出题/归类）。前端切走再切回来时靠它恢复「运行中」状态 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ runs: listRuns(id) });
}
