import { NextResponse } from "next/server";
import { callBrain } from "@/lib/brain";
import { getSettings } from "@/lib/store";

/** 大脑自检：发一个最小 JSON 任务，验证「连通 + 按约定返回 JSON」。
 * 打开设置页时自动执行，无需按钮。agent-cli 要完整拉起 CLI，约 30-60 秒；
 * 成功结果缓存 5 分钟，失败不缓存（改完配置刷新页面即可重测）。 */
export const dynamic = "force-dynamic";

let cached: { at: number; result: CheckResult } | null = null;
let inflight: Promise<CheckResult> | null = null;
const OK_TTL_MS = 5 * 60 * 1000;

interface CheckResult {
  ok: boolean;
  provider: string;
  ms: number;
  error?: string;
}

async function probe(): Promise<CheckResult> {
  const started = Date.now();
  const s = getSettings();
  try {
    const raw = await callBrain(
      { task: "brain-check", prompt: '连通性自检。只输出一个 JSON 对象：{"ok":true}' },
      s,
      AbortSignal.timeout(120_000),
    );
    const ok = raw.includes('"ok"') && raw.trim().startsWith("{");
    return {
      ok,
      provider: s.provider,
      ms: Date.now() - started,
      error: ok ? undefined : `返回的不是约定 JSON：${raw.replace(/\s+/g, " ").slice(0, 120)}`,
    };
  } catch (e) {
    return { ok: false, provider: s.provider, ms: Date.now() - started, error: e instanceof Error ? e.message : "模型调用失败" };
  }
}

export async function GET() {
  // 缓存按 provider 绑定：设置页切 provider 后立即重测，不返回旧 provider 的结果
  if (
    cached &&
    cached.result.ok &&
    cached.result.provider === getSettings().provider &&
    Date.now() - cached.at < OK_TTL_MS
  ) {
    return NextResponse.json(cached.result);
  }
  if (!inflight) {
    inflight = probe().then((result) => {
      inflight = null;
      if (result.ok) cached = { at: Date.now(), result };
      return result;
    });
  }
  return NextResponse.json(await inflight);
}
