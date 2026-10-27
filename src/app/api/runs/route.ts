import { NextResponse } from "next/server";
import { listAllRuns } from "@/lib/runRegistry";
import { readMeta } from "@/lib/store";

/** 全局在跑任务列表：全站常驻的运行条每 3 秒轮询一次。
 *  目标名在服务端拼好，前端不用再查 meta。 */
export async function GET() {
  const runs = listAllRuns().map((r) => {
    const meta = readMeta(r.targetId);
    return { ...r, targetName: meta?.title || meta?.name || r.targetId };
  });
  return NextResponse.json({ runs });
}
