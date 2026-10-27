import { NextResponse } from "next/server";
import { readBank, writeBank } from "@/lib/store";
import type { Bank } from "@/lib/types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { bank?: Bank };
  if (!body.bank || !Array.isArray(body.bank.questions)) {
    return NextResponse.json({ error: "请求体缺少 bank" }, { status: 400 });
  }
  writeBank(id, body.bank);
  return NextResponse.json({ bank: body.bank });
}

/** GET /api/targets/<id>/bank?export=md —— 导出题库为 Markdown（M3 再做导入） */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get("export") !== "md") {
    return NextResponse.json({ bank: readBank(id) });
  }
  const bank = readBank(id);
  const lines: string[] = [`# 题库导出（${id}）`, ""];
  for (const q of bank.questions) {
    if (q.status === "archived") continue;
    lines.push(`## ${q.id} · ${q.locked ? "已锁定" : "未锁定"}`);
    lines.push("", `**Q：** ${q.question}`, "");
    if (q.followUps.length) lines.push(`**追问：** ${q.followUps.join(" / ")}`, "");
    if (q.rubric) lines.push(`**评分要点：** ${q.rubric}`, "");
    if (q.answer) lines.push(`**参考答案：**`, "", q.answer, "");
    if (q.notes) lines.push(`**备注：** ${q.notes}`, "");
    lines.push("---", "");
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="bank-${id}.md"`,
    },
  });
}
