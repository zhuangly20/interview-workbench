import { NextResponse } from "next/server";
import { readBank, readLanguage, writeBank } from "@/lib/store";
import { runClassifySection } from "@/lib/pipeline/classifySection";
import { toSection } from "@/lib/sections";
import { PipelineError } from "@/lib/pipeline/json";
import { startRun, endRun } from "@/lib/runRegistry";

/** AI 归类板块：给没打标签的题批量打 section（已归类的题不会被覆盖） */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bank = readBank(id);
  const untagged = bank.questions.filter((q) => q.status !== "archived" && !q.section);
  if (!untagged.length) {
    return NextResponse.json({ error: "没有需要归类的题目（已归类的不会被覆盖）" }, { status: 400 });
  }
  try {
    // 运行与这次 HTTP 请求解耦：切走页面、连接断开都继续跑完；「停止」走 /runs/stop
    const signal = startRun(id, "classify");
    const assignments = await runClassifySection(untagged, id, readLanguage(id), { signal });
    const validIds = new Set(untagged.map((q) => q.id));
    const byId = new Map(
      assignments.filter((a) => validIds.has(a.id)).map((a) => [a.id, toSection(a.section)]),
    );
    if (!byId.size) {
      return NextResponse.json({ error: "AI 没有返回有效的归类结果" }, { status: 502 });
    }
    bank.questions = bank.questions.map((q) =>
      byId.has(q.id) ? { ...q, section: byId.get(q.id), lastEdited: new Date().toISOString() } : q,
    );
    bank.version += 1;
    writeBank(id, bank);
    return NextResponse.json({ assigned: byId.size, bank });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "归类失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  } finally {
    endRun(id, "classify");
  }
}
