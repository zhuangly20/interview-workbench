import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { newId } from "@/lib/store";
import { stagingDir } from "@/lib/paths";
import { guessRole, parseUpload, type InputRole } from "@/lib/parseFile";

interface StagedFile {
  name: string;
  role: InputRole;
  text: string;
}

const MAX_FILES = 12;
const MAX_BYTES = 10 * 1024 * 1024;

/** 拖拽导入第一步：接收文件 → 本地解析 → 按板块指定（或文件名猜）认领 → 原件+文本存暂存区等待确认 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求不是有效的文件上传" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `一次最多 ${MAX_FILES} 个文件` }, { status: 400 });
  }

  // 三分栏新建页分多次拖拽：带上 stagingId 就追加进同一个暂存区（重名自动加序号）
  let stagingId = typeof form.get("stagingId") === "string" ? (form.get("stagingId") as string) : "";
  if (stagingId && !/^imp_[\w]+$/.test(stagingId)) {
    return NextResponse.json({ error: "stagingId 无效" }, { status: 400 });
  }
  const dir = stagingId ? path.join(stagingDir(), stagingId) : "";
  if (stagingId && !fs.existsSync(path.join(dir, "parsed.json"))) {
    return NextResponse.json({ error: "暂存区已失效，请重新拖入文件" }, { status: 400 });
  }
  if (!stagingId) {
    stagingId = newId("imp");
    fs.mkdirSync(path.join(stagingDir(), stagingId, "files"), { recursive: true });
  }
  fs.mkdirSync(path.join(stagingDir(), stagingId, "raw"), { recursive: true });

  // 跨批次去重：同一暂存区里已有同名文件就换名
  const usedNames = new Set<string>();
  const prevParsedPath = path.join(stagingDir(), stagingId, "parsed.json");
  try {
    const prev = JSON.parse(fs.readFileSync(prevParsedPath, "utf8")) as { name: string }[];
    for (const p of prev) usedNames.add(p.name);
  } catch {
    /* 首次拖入 */
  }

  // 前端按板块（JD/CV/其他）拖文件时直接指定角色；没指定就按文件名猜
  let roleOverrides: Record<string, InputRole> = {};
  const rolesRaw = form.get("roles");
  if (typeof rolesRaw === "string") {
    try {
      roleOverrides = JSON.parse(rolesRaw) as Record<string, InputRole>;
    } catch {
      /* 忽略：回退到文件名猜测 */
    }
  }

  const finalDir = path.join(stagingDir(), stagingId);
  const staged: StagedFile[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      errors.push(`${f.name} 超过 10MB，已跳过`);
      continue;
    }
    // 重名文件加序号，避免暂存区里互相覆盖
    let safe = f.name.replace(/[\\/:*?"<>|]/g, "_");
    let n = 2;
    while (usedNames.has(safe)) safe = f.name.replace(/(\.[^.]*)?$/, (ext) => `-${n++}${ext ?? ""}`);
    usedNames.add(safe);
    try {
      const buf = Buffer.from(await f.arrayBuffer());
      const text = await parseUpload(f.name, buf);
      // 原件留档（确认后搬进目标 inputs/raw/），解析文本单独存
      fs.writeFileSync(path.join(finalDir, "raw", safe), buf);
      fs.writeFileSync(path.join(finalDir, "files", safe), Buffer.from(text, "utf8"));
      staged.push({ name: safe, role: roleOverrides[f.name] ?? guessRole(f.name), text });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `解析 ${f.name} 失败`);
    }
  }
  if (staged.length === 0) {
    return NextResponse.json({ error: "没有可解析的文件", errors }, { status: 400 });
  }

  // 追加进 parsed.json（多次拖拽累积）
  let allStaged: StagedFile[] = [...staged];
  try {
    const prev = JSON.parse(fs.readFileSync(prevParsedPath, "utf8")) as StagedFile[];
    const prevNames = new Set(prev.map((p) => p.name));
    allStaged = [...prev, ...staged.filter((s) => !prevNames.has(s.name))];
  } catch {
    /* 首次拖入 */
  }
  fs.writeFileSync(prevParsedPath, JSON.stringify(allStaged, null, 2), "utf8");

  return NextResponse.json({
    stagingId,
    files: staged.map((s) => ({ name: s.name, role: s.role, chars: s.text.length, text: s.text })),
    errors,
  });
}
