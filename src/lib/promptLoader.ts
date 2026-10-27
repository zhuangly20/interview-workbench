import fs from "node:fs";
import path from "node:path";
import { promptsDir } from "./paths";

/**
 * 加载 prompts/<name>.md 并做 {{变量}} 插值。
 * 模板是用户可编辑资产：改完保存，下一次请求即生效（无需重启）。
 */
export function renderPrompt(name: string, vars: Record<string, string>): string {
  const file = path.join(promptsDir(), `${name}.md`);
  let tpl: string;
  try {
    tpl = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`找不到 prompt 模板 prompts/${name}.md`);
  }
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined ? `{{${key}}}` : v;
  });
}
