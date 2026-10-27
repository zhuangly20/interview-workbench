import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { InputRole } from "./types";

export type { InputRole };

/** 把上传文件解析成纯文本：pdf / docx / txt / md（纯本地，不经过任何外部服务） */
export async function parseUpload(name: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const out = await pdfParse(buf);
    return out.text.trim();
  }
  if (lower.endsWith(".docx")) {
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value.trim();
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return buf.toString("utf8").trim();
  }
  throw new Error(`暂不支持解析 ${name}：只支持 pdf / docx / txt / md`);
}

/** 按文件名猜认领：哪份是 JD、哪份是简历、其余归背景（用户可在确认页改） */
export function guessRole(name: string): InputRole {
  const n = name.toLowerCase();
  const has = (re: RegExp) => re.test(n);
  if (has(/(^|[^a-z])jd([^a-z]|$)|(^|[^a-z])job([^a-z]|$)|position|岗位|职位|招聘|描述/)) return "jd";
  if (has(/(^|[^a-z])cv([^a-z]|$)|(^|[^a-z])resume([^a-z]|$)|简历|个人简介|个人资料/)) return "resume";
  return "background";
}
