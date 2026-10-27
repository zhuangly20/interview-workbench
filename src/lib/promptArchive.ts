import fs from "node:fs";
import path from "node:path";
import { targetDir } from "./paths";

/** 每次大脑调用实际发出的完整 prompt，按时间戳存档到 data/targets/<id>/prompts/ */
export function archivePrompt(targetId: string, task: string, prompt: string): void {
  try {
    const dir = path.join(targetDir(targetId), "prompts");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `${task}-${stamp}.txt`), prompt, "utf8");
  } catch {
    /* 存档失败不影响主流程 */
  }
}

export interface PromptArchiveEntry {
  file: string;
  task: string;
  at: string;
  chars: number;
}

const FILE_RE = /^([a-z-]+)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.txt$/;

export function listPromptArchives(targetId: string): PromptArchiveEntry[] {
  const dir = path.join(targetDir(targetId), "prompts");
  if (!fs.existsSync(dir)) return [];
  const out: PromptArchiveEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(f);
    if (!m) continue;
    out.push({
      file: f,
      task: m[1],
      at: m[2],
      chars: fs.statSync(path.join(dir, f)).size,
    });
  }
  return out.sort((a, b) => b.file.localeCompare(a.file));
}

/** 读取单份存档；file 名必须匹配存档命名规则，防目录穿越 */
export function readPromptArchive(targetId: string, file: string): string | undefined {
  if (!FILE_RE.test(file) || file.includes("/") || file.includes("\\")) return undefined;
  try {
    return fs.readFileSync(path.join(targetDir(targetId), "prompts", file), "utf8");
  } catch {
    return undefined;
  }
}
