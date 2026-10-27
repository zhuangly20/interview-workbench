import { callBrain, type BrainTask } from "../brain";

/** 从模型输出中抠出 JSON（容忍 ```json 围栏与前后闲话） */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("输出中没有找到 JSON 对象");
  return JSON.parse(body.slice(start, end + 1));
}

export class PipelineError extends Error {
  raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
  }
}

/**
 * 大脑调用 + JSON 抽取 + schema 校验 + 一次重试。
 * 两次都失败时抛 PipelineError（携带原始文本，UI 降级展示）。
 */
export async function brainJson<T>(
  task: BrainTask,
  prompt: string,
  validate: (data: unknown) => T,
  schemaHint: string,
  signal?: AbortSignal,
): Promise<T> {
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptForCall =
      attempt === 0
        ? prompt
        : `${prompt}\n\n---\n你上一次的输出不是符合要求的 JSON。请只输出一个符合下面结构要求的 JSON 对象，不要输出任何其他文字：\n${schemaHint}`;
    raw = await callBrain({ task, prompt: promptForCall }, undefined, signal);
    try {
      return validate(extractJson(raw));
    } catch (e) {
      if (attempt === 1) {
        throw new PipelineError(
          `模型输出两次都无法解析为要求的 JSON（${e instanceof Error ? e.message : "未知错误"}）。以下为原始输出：`,
          raw,
        );
      }
    }
  }
  throw new PipelineError("unreachable", raw);
}

// ---------- 常用校验小工具 ----------

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
