import { readInputs } from "../store";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, brainJson } from "./json";

/** 创建目标后后台提取岗位名称（meta.title）；提取结果只在还没设置过 title 时写入 */
export async function runExtractTitle(targetId: string, opts?: { signal?: AbortSignal }): Promise<string> {
  const jd = readInputs(targetId).jd;
  const prompt = renderPrompt("extract-title", { jd: jd.slice(0, 4000) || "（未提供）" });
  archivePrompt(targetId, "extract-title", prompt);
  const data = await brainJson<{ title: string }>(
    "extract-title",
    prompt,
    (raw) => ({ title: asString(asObject(raw).title).trim() }),
    `{"title":"岗位名称"}`,
    opts?.signal,
  );
  if (!data.title) throw new Error("提取的岗位名称为空");
  return data.title;
}
