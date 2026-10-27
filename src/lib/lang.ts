import type { TargetLanguage } from "./types";

/** 语言的一切派生都在这里：猜语言、提示词称谓、语音 locale。目标语言定死不切换。 */

/** 从 JD 文本猜面试语言：中文字符占比 > 12% 视为中文面试（混少量中文术语的英文 JD 不受影响） */
export function guessLanguage(text: string): TargetLanguage {
  const body = text.replace(/\s/g, "");
  if (!body.length) return "en";
  const cjk = (body.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / body.length > 0.12 ? "zh" : "en";
}

/** 外部输入收敛成合法语言值：只有 "zh" 是明确指定，其余一律按 en 处理（老目标无此字段） */
export function normalizeLanguage(v: unknown): TargetLanguage {
  return v === "zh" ? "zh" : "en";
}

/** 提示词里的语言称谓（中文 prompt 模板用） */
export function langLabel(lang: TargetLanguage): string {
  return lang === "zh" ? "中文" : "英文";
}

/** 参考答案的口播长度指引（generate-bank 用） */
export function langAnswerLen(lang: TargetLanguage): string {
  return lang === "zh" ? "约 200-300 汉字" : "约 130-200 英文词";
}

/** 语音协议模板（voice-interview-whole / voice-teach）里的语言名 */
export function langSpokenName(lang: TargetLanguage): string {
  return lang === "zh" ? "Mandarin Chinese" : "English";
}

/** 浏览器 TTS 朗读 locale（练习页 Web Speech 用） */
export function speechLocale(lang: TargetLanguage): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}
