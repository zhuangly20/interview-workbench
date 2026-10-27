import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { targetDir } from "@/lib/paths";

/** 打开目标目录内的文件：mode=open 用系统默认程序直接打开；mode=reveal（默认）在文件管理器里选中它 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { relPath?: string; mode?: "open" | "reveal" };
  const rel = body.relPath ?? "";
  if (!rel || rel.includes("..")) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  const root = path.resolve(targetDir(id));
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "路径越出目标目录" }, { status: 400 });
  }
  if (!fs.existsSync(full)) {
    return NextResponse.json({ error: "文件还不存在（先跑一次对应的步骤）" }, { status: 404 });
  }
  const folder = path.dirname(full);
  const mode = body.mode === "open" ? "open" : "reveal";
  try {
    if (process.platform === "win32") {
      // explorer /select 只能选中；直接打开用 cmd start（注意空标题参数防止路径被当标题）
      if (mode === "open") exec(`cmd /c start "" "${full}"`);
      else exec(`explorer /select,"${full}"`);
    } else if (process.platform === "darwin") {
      exec(mode === "open" ? `open "${full}"` : `open -R "${full}"`);
    } else {
      exec(`xdg-open "${mode === "open" ? full : folder}"`);
    }
  } catch {
    // explorer 等命令即使成功也可能返回非零码，失败时静默即可
  }
  return NextResponse.json({ ok: true });
}
