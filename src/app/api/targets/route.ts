import { NextResponse } from "next/server";
import { createTarget, listTargets, newId } from "@/lib/store";
import { guessLanguage } from "@/lib/lang";
import { runExtractTitle } from "@/lib/pipeline/extractTitle";

export async function GET() {
  return NextResponse.json({ targets: listTargets() });
}

/** 创建目标：岗位名不再手填 —— 先用 JD 首行占位，创建后后台用大脑提取正式岗位名（用户可改） */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    jd?: string;
    background?: string;
    resume?: string;
    language?: string;
  };
  if (!body.jd?.trim()) return NextResponse.json({ error: "请提供岗位 JD（粘贴或导入文件）" }, { status: 400 });
  // 面试语言创建时定死：前端传了就用，没传按 JD 自动判断
  const language = body.language === "zh" || body.language === "en" ? body.language : guessLanguage(body.jd);
  const placeholder =
    body.jd
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean)
      ?.slice(0, 40) || "未命名目标";
  const meta = { id: newId("t"), name: placeholder, createdAt: new Date().toISOString(), language };
  createTarget(meta, {
    jd: body.jd ?? "",
    background: body.background ?? "",
    resume: body.resume ?? "",
  });
  // 后台提取岗位名称（失败静默：界面先显示占位名，用户也可手改）
  void runExtractTitle(meta.id)
    .then((title) => import("@/lib/store").then((m) => m.updateMeta(meta.id, { title })))
    .catch(() => {});
  return NextResponse.json({ meta });
}
