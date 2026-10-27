import { NextResponse } from "next/server";
import { listPromptArchives, readPromptArchive } from "@/lib/promptArchive";

/** 目标文件夹里 prompts/ 存档的列表与读取：?file=xxx 返回单份全文 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = new URL(req.url).searchParams.get("file");
  if (file) {
    const content = readPromptArchive(id, file);
    if (content === undefined) return NextResponse.json({ error: "存档不存在" }, { status: 404 });
    return NextResponse.json({ file, content });
  }
  return NextResponse.json({ prompts: listPromptArchives(id) });
}
