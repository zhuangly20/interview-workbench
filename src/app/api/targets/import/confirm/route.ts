import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createTarget } from "@/lib/store";
import { stagingDir, targetDir } from "@/lib/paths";
import { guessLanguage } from "@/lib/lang";
import { runExtractTitle } from "@/lib/pipeline/extractTitle";
import type { InputRole, TargetInputs } from "@/lib/types";

/** 新建目标（文件路线）：确认暂存区里每个文件的板块 + 各板块粘贴文本 → 建目标 → 原件归档 inputs/raw/ → 清暂存区 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    stagingId?: string;
    /** 用户确认后的最终清单（可删可改板块）：name → jd|background|resume */
    files?: { name: string; role: InputRole }[];
    texts?: Partial<Record<InputRole, string>>;
    language?: string;
  } | null;
  if (!body?.stagingId || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "缺少 stagingId 或 files" }, { status: 400 });
  }

  const dir = path.join(stagingDir(), body.stagingId);
  let staged: { name: string; role: InputRole; text: string }[] = [];
  try {
    staged = JSON.parse(fs.readFileSync(path.join(dir, "parsed.json"), "utf8"));
  } catch {
    return NextResponse.json({ error: "暂存区已失效，请重新拖入文件" }, { status: 400 });
  }

  // 以客户端发来的最终清单为准（用户可能移除了文件或改了板块归属）
  const want = new Map(body.files.map((f) => [f.name, f.role]));
  const chosen = staged.filter((s) => want.has(s.name));

  // 三个角色的最终文本 = 粘贴文本 + 该板块名下所有解析文件（都要，不二选一）；多份用分隔线拼接
  const inputs: TargetInputs = { jd: "", background: "", resume: "" };
  for (const role of ["jd", "background", "resume"] as InputRole[]) {
    const parts: string[] = [];
    if (body.texts?.[role]?.trim()) parts.push(body.texts[role].trim());
    for (const s of chosen) {
      if ((want.get(s.name) ?? s.role) === role && s.text.trim()) parts.push(s.text.trim());
    }
    inputs[role] = parts.join("\n\n----\n\n");
  }
  if (!inputs.jd.trim()) {
    return NextResponse.json({ error: "JD 不能为空：请在 JD 板块粘贴或导入一份 JD" }, { status: 400 });
  }

  // 记录每个板块来自哪些原始文件（材料区展示用；用确认后的板块归属，不是导入时的猜测）
  const sources: TargetInputs["sources"] = {};
  for (const role of ["jd", "background", "resume"] as InputRole[]) {
    const names = chosen.filter((s) => (want.get(s.name) ?? s.role) === role).map((s) => s.name);
    if (names.length) sources[role] = names;
  }

  // 目标名 = JD 首行占位（岗位名创建后由大脑提取，用户可改）
  const name =
    inputs.jd
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean)
      ?.slice(0, 40) || "未命名目标";
  const slug = name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "target";
  const id = `${slug}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;

  // 面试语言创建时定死：前端传了就用，没传按 JD 自动判断
  const language = body.language === "zh" || body.language === "en" ? body.language : guessLanguage(inputs.jd);
  createTarget({ id, name, createdAt: new Date().toISOString(), language }, inputs, Object.keys(sources).length ? sources : undefined);

  // 原始文件原样归档进目标目录，保持"一个岗位 = 一个可搬走的文件夹"；用户移除的不留档
  const rawDir = path.join(targetDir(id), "inputs", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const keep = new Set(chosen.map((s) => s.name));
  for (const sub of ["raw", "files"] as const) {
    const filesDir = path.join(dir, sub);
    if (!fs.existsSync(filesDir)) continue;
    for (const f of fs.readdirSync(filesDir)) {
      if (!keep.has(f)) continue;
      const dest = path.join(rawDir, f);
      if (sub === "raw") fs.copyFileSync(path.join(filesDir, f), dest);
      else if (!fs.existsSync(dest)) fs.copyFileSync(path.join(filesDir, f), dest);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // 后台提取岗位名称（失败静默，界面显示占位名）
  void runExtractTitle(id)
    .then((title) => import("@/lib/store").then((m) => m.updateMeta(id, { title })))
    .catch(() => {});

  return NextResponse.json({ meta: { id, name } });
}
