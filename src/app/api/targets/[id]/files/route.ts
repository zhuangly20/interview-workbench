import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { dataDir, targetDir } from "@/lib/paths";

/** 目标目录里所有用户可能想直接看的文件（本地文件面板用；路径只在服务端拼，不收任意路径） */
const ENTRIES: [string, string][] = [
  ["meta.json（目标信息 / 面试语言）", "meta.json"],
  ["inputs.json（三件套现文）", "inputs.json"],
  ["analysis.json（拆解结果）", "analysis.json"],
  ["analysis/prompt-override.md（拆解提示词改写）", "analysis/prompt-override.md"],
  ["bank.json（题库）", "bank.json"],
  ["progress.json（练习历史分数）", "progress.json"],
  ["inputs/versions/（材料历史版本）", "inputs/versions"],
  ["analysis/versions/（拆解历史版本）", "analysis/versions"],
  ["prompts/（提示词存档）", "prompts"],
  ["sessions/（练习场次逐字稿）", "sessions"],
];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = targetDir(id);
  if (!fs.existsSync(dir)) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  const items = ENTRIES.map(([label, rel]) => {
    const full = path.join(dir, rel);
    return { label, relPath: rel, path: full, exists: fs.existsSync(full) };
  });
  const rawDir = path.join(dir, "inputs", "raw");
  const rawFiles = fs.existsSync(rawDir)
    ? fs
        .readdirSync(rawDir)
        .filter((f) => fs.statSync(path.join(rawDir, f)).isFile())
        .sort()
        .map((name) => ({ label: name, relPath: `inputs/raw/${name}`, path: path.join(rawDir, name), exists: true }))
    : [];
  return NextResponse.json({ dataRoot: dataDir(), items, rawFiles });
}
