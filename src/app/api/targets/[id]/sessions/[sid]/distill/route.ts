import { NextResponse } from "next/server";
import { readBank, readLanguage, readSession, writeSession } from "@/lib/store";
import { runDistillAnswer } from "@/lib/pipeline/distillAnswer";
import { PipelineError } from "@/lib/pipeline/json";

/** 教学场次蒸馏：把练出来的好句子融成参考答案草稿（纯展示不写库）。
 * 结果缓存进场次数据——生成过就直接返回，不重复烧大脑。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const session = readSession(id, sid);
  if (!session) return NextResponse.json({ error: "练习场次不存在" }, { status: 404 });
  if (session.turns.length === 0) {
    return NextResponse.json({ error: "本场还没有任何对话，无可沉淀内容" }, { status: 400 });
  }
  if (session.distill) return NextResponse.json({ distill: session.distill, cached: true });

  const qid = session.questions[0]?.id ?? "";
  const bankQuestion = readBank(id).questions.find((q) => q.id === qid);
  if (!bankQuestion) return NextResponse.json({ error: "题目已不在题库中" }, { status: 400 });

  try {
    const proposal = await runDistillAnswer(bankQuestion, session, readLanguage(id), {
      signal: req.signal,
    });
    session.distill = { ...proposal, generatedAt: new Date().toISOString() };
    writeSession(session);
    return NextResponse.json({ distill: session.distill, cached: false });
  } catch (e) {
    if (req.signal.aborted) return NextResponse.json({ error: "已停止" }, { status: 400 });
    const raw = e instanceof PipelineError ? e.raw : undefined;
    const message = e instanceof Error ? e.message : "蒸馏失败";
    return NextResponse.json({ error: message, raw }, { status: 502 });
  }
}
