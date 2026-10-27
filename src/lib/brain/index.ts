import { exec } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { getSettings } from "../store";
import type { Settings } from "../types";
import { mockBrain } from "./mock";

// 出题/拆解是大 prompt 任务，网关高峰期可能 5 分钟以上才返回响应头，而 Node 内置 fetch 的
// undici 默认 5 分钟就掐断并报 "fetch failed"。LLM 调用单独走 undici 的 fetch + 30 分钟超时；
// 真正的提前中断仍由调用方传入的 signal（注册表 AbortController）负责。
const llmDispatcher = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 });

export type BrainTask =
  | "analyze"
  | "analyze-card"
  | "extract-title"
  | "generate-bank"
  | "regen-question"
  | "make-paper"
  | "match-questions"
  | "practice-turn"
  | "teach-turn"
  | "settle-teach"
  | "distill-answer"
  | "score"
  | "classify-section"
  | "brain-check";

export interface BrainCall {
  task: BrainTask;
  /** 完整 prompt（通常来自 prompts/*.md 模板插值），各 provider 拿到的文本一致 */
  prompt: string;
}

/** 统一大脑入口：按 Settings.provider 分发，返回原始文本（由 pipeline 做 JSON 解析与校验）。
 * signal 来自路由的 request.signal（客户端点「停止」时中断），openai 用它断开 fetch，agent-cli 用它杀子进程。 */
export async function callBrain(call: BrainCall, settings?: Settings, signal?: AbortSignal): Promise<string> {
  const s = settings ?? getSettings();
  switch (s.provider) {
    case "openai-compatible":
      return callOpenAI(call, s, signal);
    case "agent-cli":
      return callAgentCli(call, s, signal);
    case "mock":
    default:
      return mockBrain(call);
  }
}

async function callOpenAI(call: BrainCall, s: Settings, signal?: AbortSignal): Promise<string> {
  const base = s.openai.baseUrl.replace(/\/+$/, "");
  const messages = [{ role: "user", content: call.prompt }];
  const post = async (body: Record<string, unknown>) => {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.openai.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        dispatcher: llmDispatcher,
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`LLM 连接失败：${cause?.code || cause?.message || (e as Error).message}`);
    }
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
  };
  // 强制 JSON 输出，根治偶发返回散文；少数兼容网关不认识该参数（400 且点名 response_format）则去掉重试
  let r = await post({ model: s.openai.model, temperature: 0.4, messages, response_format: { type: "json_object" } });
  if (!r.ok && r.status === 400 && /response_format|json_object/i.test(r.text)) {
    r = await post({ model: s.openai.model, temperature: 0.4, messages });
  }
  if (!r.ok) throw new Error(`LLM 请求失败 HTTP ${r.status}：${r.text.slice(0, 300)}`);
  let json: { choices?: { message?: { content?: string } }[] };
  try {
    json = JSON.parse(r.text);
  } catch {
    throw new Error("LLM 返回不是合法 JSON 响应");
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("LLM 返回为空");
  return text;
}

async function callAgentCli(call: BrainCall, s: Settings, signal?: AbortSignal): Promise<string> {
  const command = s.agentCli.command;
  if (!command || !command.includes("{prompt}")) {
    throw new Error(
      "agent-cli 未配置：请在 Settings 填写命令模板，例如 zcode -p \"{prompt}\" 或 codex exec \"{prompt}\"",
    );
  }
  // Windows cmd.exe 单条命令最长 8191 字符，而评分/出题 prompt 轻易超过；
  // agent CLI 又自带系统提示词（如 zcode 的编码智能体人格），长任务容易跑偏成散文。
  // 所以：完整 prompt 落盘成临时文件用 --attach 递交，命令行上只放一条带 JSON 硬约束的短指令。
  const wrapped = `严格只输出一个 JSON 对象（以 { 开头、} 结尾），不要输出分析过程、markdown 或任何其他文字。以下是任务：\n\n${call.prompt}\n\n再次强调：直接输出 JSON 对象本身，不要任何别的文字。`;
  const file = join(agentCliCwd(), `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  writeFileSync(file, wrapped, "utf8");
  const instruction =
    "附件文件里是完整任务说明。读取并严格执行它；它要求输出一个 JSON 对象——直接只输出该 JSON 对象本身，不要任何其他文字。";
  const full = `${command.replace("{prompt}", shellQuote(instruction))} --attach ${shellQuote(file)}`;
  return new Promise<string>((resolve, reject) => {
    exec(
      full,
      {
        // 中立空目录：避免 CLI 把工作台仓库当工作区去翻文件，也保证各次调用互不可见
        cwd: agentCliCwd(),
        timeout: Math.max(30, s.agentCli.timeoutSec) * 1000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        signal,
      },
      (err, stdout, stderr) => {
        try {
          unlinkSync(file);
        } catch {
          /* 临时 prompt 文件清理失败可忽略 */
        }
        if (signal?.aborted) {
          reject(new Error("已停止"));
          return;
        }
        if (err) {
          reject(new Error(`agent-cli 执行失败：${err.message}${stderr ? `\n${stderr.slice(0, 300)}` : ""}`));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          reject(new Error("agent-cli 没有输出（stdout 为空）"));
          return;
        }
        resolve(text);
      },
    );
  });
}

function agentCliCwd(): string {
  const dir = join(tmpdir(), "interview-workbench-agent-cwd");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 跨平台的安全引号包裹：Windows cmd 与 POSIX 都用双引号 + 转义 */
function shellQuote(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}
