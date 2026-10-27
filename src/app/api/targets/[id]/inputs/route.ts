import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { listInputVersions, readInputs, updateInput } from "@/lib/store";
import { targetDir } from "@/lib/paths";

/** 材料读取：当前三件套 + 历史版本列表 + 原始文件清单（inputs/raw/，点击可直接打开） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawDir = path.join(targetDir(id), "inputs", "raw");
  const rawFiles = fs.existsSync(rawDir)
    ? fs
        .readdirSync(rawDir)
        .filter((f) => fs.statSync(path.join(rawDir, f)).isFile())
        .map((f) => ({ name: f, relPath: `inputs/raw/${f}` }))
    : [];
  return NextResponse.json({
    inputs: readInputs(id),
    versions: listInputVersions(id),
    rawFiles,
    sources: readInputs(id).sources ?? null,
  });
}

/** 更新材料：旧文本自动归档到 inputs/versions/，之后可在题库页跑「对账」 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { jd?: string; background?: string; resume?: string };
  const roles = ["jd", "background", "resume"] as const;
  const current = readInputs(id);
  const changed = roles.filter((r) => typeof body[r] === "string" && body[r] !== current[r]);
  for (const r of changed) updateInput(id, r, body[r] as string);
  return NextResponse.json({ ok: true, changed, versions: listInputVersions(id) });
}
