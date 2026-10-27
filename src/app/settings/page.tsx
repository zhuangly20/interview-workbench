"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/types";

interface BrainCheck {
  ok: boolean;
  provider: string;
  ms: number;
  error?: string;
}

interface VoiceCheck {
  ok: boolean;
  missing?: string[];
}

// 全部六款均已在本机账号实测出声（试音按钮，振幅判定）；en_ 开头的英文母语音色在
// 公共 TTS 资源下不出声，故不预设——想试别的编号用「自定义」+ 试音验证
const VOICE_PRESETS: { code: string; label: string; lang: "zh" | "en" }[] = [
  { code: "zh_female_yuanqinvyou_moon_bigtts", label: "撒娇学妹 · 元气女声", lang: "zh" },
  { code: "zh_female_cancan_mars_bigtts", label: "灿灿 · 知性女声（中英）", lang: "zh" },
  { code: "zh_female_sajiaonvyou_moon_bigtts", label: "柔美女友 · 温柔女声", lang: "zh" },
  { code: "zh_male_wennuanahu_moon_bigtts", label: "温暖阿虎 · 沉稳男声（中英）", lang: "zh" },
  { code: "zh_male_ruyaqingnian_mars_bigtts", label: "儒雅青年 · 沉稳男声", lang: "zh" },
  { code: "zh_male_yangguangqingnian_mars_bigtts", label: "阳光青年 · 明快男声", lang: "zh" },
];

interface RtcEngineLike {
  joinRoom(token: string, roomId: string, userInfo: { userId: string }, roomConfig: Record<string, unknown>): Promise<unknown>;
  leaveRoom(): Promise<unknown>;
}
interface VertcLike {
  createEngine(appId: string): RtcEngineLike;
  destroyEngine(engine: RtcEngineLike): void;
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [brainCheck, setBrainCheck] = useState<BrainCheck | null>(null);
  const [voiceCheck, setVoiceCheck] = useState<VoiceCheck | null>(null);
  const [voiceTest, setVoiceTest] = useState<{ status: "running" | "ok" | "silent" | "error"; message?: string } | null>(null);
  const [customVoice, setCustomVoice] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setS(d.settings));
    // 打开本页即自动自检，无需任何按钮；大脑结果成功后服务端缓存 5 分钟
    fetch("/api/brain/check").then((r) => r.json()).then(setBrainCheck).catch(() => setBrainCheck({ ok: false, provider: "-", ms: 0, error: "自检请求失败（网络中断）" }));
    fetch("/api/voice/check").then((r) => r.json()).then(setVoiceCheck).catch(() => setVoiceCheck({ ok: false, missing: ["自检请求失败"] }));
  }, []);

  if (!s) return <p className="text-sm text-gray-500">加载中…</p>;

  const v = s.voice.volcengine;
  const providerOptions: [string, string][] = [
    ["mock", "Mock（无需 key，用模拟数据演示全流程）"],
    ["openai-compatible", "OpenAI 兼容接口（智谱 / DeepSeek / OpenAI / Ollama…）"],
  ];
  // agent-cli 是实验特性，不再作为常规选项展示；仅当当前正在使用时列出（便于看到现状并切走）
  if (s.provider === "agent-cli") providerOptions.push(["agent-cli", "Agent CLI（本地 agent 当模型，实验特性）"]);

  async function save() {
    setBusy(true);
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    const data = await res.json();
    setS(data.settings);
    setSaved(true);
    setBusy(false);
  }

  /** 试音：用表单里当前选的音色（未保存也可以）起一个 15 秒探针任务，进房实测振幅——
   * 连上但全程静音 = 编号无效或账户欠费停服，别等练习时才发现 */
  async function runVoiceTest(voiceType: string) {
    setVoiceTest({ status: "running" });
    let engine: RtcEngineLike | null = null;
    let stop: { appId: string; roomId: string; taskId: string } | null = null;
    const mod = (await import("@volcengine/rtc")) as unknown as { default?: VertcLike } & VertcLike;
    const VERTC = mod.default ?? mod;
    try {
      const res = await fetch("/api/voice/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceType }),
      });
      const info = (await res.json()) as { appId: string; roomId: string; userId: string; taskId: string; token: string; error?: string };
      if (!res.ok) throw new Error(info.error ?? "试音任务启动失败");
      stop = { appId: info.appId, roomId: info.roomId, taskId: info.taskId };

      engine = VERTC.createEngine(info.appId);
      await Promise.race([
        engine.joinRoom(info.token, info.roomId, { userId: info.userId }, { isAutoPublish: false, isAutoSubscribeAudio: true, roomProfileType: 5 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("进房超时：请检查代理与网络")), 15_000)),
      ]);

      // 等 SDK 建好播放元素并挂上音频流（自动播放策略偶尔拦播放：点按钮就是用户手势，矫正即可）
      const audio = await new Promise<HTMLAudioElement | null>((resolve) => {
        const t0 = Date.now();
        const tick = () => {
          const el = document.querySelector("audio");
          if (el && el.srcObject) return resolve(el as HTMLAudioElement);
          if (Date.now() - t0 > 5000) return resolve(null);
          setTimeout(tick, 200);
        };
        tick();
      });
      if (!audio) throw new Error("浏览器里没有出现音频播放元素");
      audio.muted = false;
      if (audio.volume === 0) audio.volume = 1;
      await audio.play().catch(() => {});

      const verdict = await new Promise<"ok" | "silent">((resolve) => {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(audio.srcObject as MediaStream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const t0 = Date.now();
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          if (peak > 0.01) { clearInterval(timer); void ctx.close(); resolve("ok"); }
          else if (Date.now() - t0 > 12_000) { clearInterval(timer); void ctx.close(); resolve("silent"); }
        }, 300);
      });
      setVoiceTest(verdict === "ok" ? { status: "ok" } : { status: "silent" });
    } catch (e) {
      setVoiceTest({ status: "error", message: e instanceof Error ? e.message : "试音失败" });
    } finally {
      if (engine) {
        try { await engine.leaveRoom(); } catch { /* 忽略 */ }
        try { VERTC.destroyEngine(engine); } catch { /* 忽略 */ }
      }
      if (stop) {
        await fetch("/api/voice/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stop),
        }).catch(() => {});
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">模型设置</h1>
        <p className="mt-1 text-sm text-gray-500">
          平台自己不带模型：拆解、出题、陪练、评分都调用你在这里配置的模型。默认 Mock 无需任何 key，即可体验全流程。
        </p>
        <p
          className={
            brainCheck
              ? brainCheck.ok
                ? "mt-2 text-sm text-green-700"
                : "mt-2 text-sm text-red-600"
              : "mt-2 text-sm text-gray-400"
          }
        >
          自动检测：
          {!brainCheck
            ? s.provider === "agent-cli"
              ? "检测中…（拉起本地 agent 约需 30-60 秒）"
              : "检测中…"
            : brainCheck.ok
              ? `✅ 模型正常（${brainCheck.provider}，${(brainCheck.ms / 1000).toFixed(1)} 秒响应）`
              : `❌ ${brainCheck.error ?? "模型不可用"}`}
        </p>
      </div>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">Provider</h2>
        {providerOptions.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="provider"
              checked={s.provider === value}
              onChange={() => setS({ ...s, provider: value as Settings["provider"] })}
            />
            {label}
          </label>
        ))}
      </section>

      {s.provider === "openai-compatible" && (
        <section className="space-y-3 rounded-lg border bg-white p-4">
          <h2 className="font-medium">OpenAI 兼容配置</h2>
          <Field label="Base URL">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={s.openai.baseUrl}
              onChange={(e) => setS({ ...s, openai: { ...s.openai, baseUrl: e.target.value } })}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
            />
          </Field>
          <Field label="API Key（只存在本地 data/settings.json）">
            <input
              type="password"
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={s.openai.apiKey}
              onChange={(e) => setS({ ...s, openai: { ...s.openai, apiKey: e.target.value } })}
            />
          </Field>
          <Field label="模型名">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={s.openai.model}
              onChange={(e) => setS({ ...s, openai: { ...s.openai, model: e.target.value } })}
              placeholder="glm-4-flash / deepseek-chat …"
            />
          </Field>
        </section>
      )}

      {s.provider === "agent-cli" && (
        <section className="space-y-3 rounded-lg border bg-white p-4">
          <h2 className="font-medium">Agent CLI 配置</h2>
          <Field label="命令模板（{prompt} 会被替换为完整 prompt）">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm font-mono"
              value={s.agentCli.command}
              onChange={(e) => setS({ ...s, agentCli: { ...s.agentCli, command: e.target.value } })}
              placeholder={`zcode -p "{prompt}"  或  codex exec "{prompt}"`}
            />
          </Field>
          <Field label={`超时（秒，当前 ${s.agentCli.timeoutSec}）`}>
            <input
              type="number"
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={s.agentCli.timeoutSec}
              onChange={(e) =>
                setS({ ...s, agentCli: { ...s.agentCli, timeoutSec: Number(e.target.value) || 120 } })
              }
            />
          </Field>
          <p className="text-xs text-gray-400">
            后端以子进程方式执行该命令并取 stdout。你的 agent 能读本地文件、带自己的系统提示词。
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">实时语音（火山引擎 · AI 音视频互动）</h2>
        <Field label="RTC AppId（RTC 控制台-应用管理，24 位）">
          <input
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            value={s.voice.volcengine.appId}
            onChange={(e) =>
              setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, appId: e.target.value } } })
            }
          />
        </Field>
        <Field label="RTC AppKey（同页获取；只存本地，用于签发进房 Token）">
          <input
            type="password"
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            value={s.voice.volcengine.appKey}
            onChange={(e) =>
              setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, appKey: e.target.value } } })
            }
          />
        </Field>
        <Field label="API 访问密钥 AK（访问控制-API 访问密钥，用于 StartVoiceChat 签名）">
          <input
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            value={s.voice.volcengine.accessKeyId}
            onChange={(e) =>
              setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, accessKeyId: e.target.value } } })
            }
          />
        </Field>
        <Field label="API 访问密钥 SK">
          <input
            type="password"
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            value={s.voice.volcengine.secretKey}
            onChange={(e) =>
              setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, secretKey: e.target.value } } })
            }
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="语音模型（豆包）">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm font-mono"
              value={s.voice.volcengine.llmModel}
              onChange={(e) =>
                setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, llmModel: e.target.value } } })
              }
              placeholder="doubao-seed-2-1-turbo-260628"
            />
          </Field>
          <Field label="音色">
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={
                customVoice || !VOICE_PRESETS.some((v) => v.code === s.voice.volcengine.voiceType)
                  ? "custom"
                  : s.voice.volcengine.voiceType
              }
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomVoice(true);
                  return;
                }
                setCustomVoice(false);
                setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, voiceType: e.target.value } } });
              }}
            >
              <optgroup label="中文">
                {VOICE_PRESETS.filter((v) => v.lang === "zh").map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
              {VOICE_PRESETS.some((p) => p.lang === "en") && (
                <optgroup label="英文">
                  {VOICE_PRESETS.filter((v) => v.lang === "en").map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="custom">自定义 voice_type…</option>
            </select>
            {(customVoice || !VOICE_PRESETS.some((v) => v.code === s.voice.volcengine.voiceType)) && (
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 text-sm font-mono"
                value={s.voice.volcengine.voiceType}
                onChange={(e) =>
                  setS({ ...s, voice: { ...s.voice, volcengine: { ...s.voice.volcengine, voiceType: e.target.value } } })
                }
                placeholder="从火山控制台「语音技术 → 音色管理」粘贴 voice_type"
              />
            )}
            <p className="mt-1 text-xs text-gray-400">这些音色都能讲英文；选完记得点「试音」确认出声。</p>
          </Field>
        </div>
        <p
          className={
            voiceCheck
              ? voiceCheck.ok
                ? "text-sm text-green-700"
                : "text-sm text-amber-600"
              : "text-sm text-gray-400"
          }
        >
          就绪自检：
          {!voiceCheck
            ? "检查中…"
            : voiceCheck.ok
              ? "✅ 凭证已配齐"
              : `⚠️ 还缺：${(voiceCheck.missing ?? []).join("、")}`}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void runVoiceTest(v.voiceType)}
            disabled={voiceTest?.status === "running" || !voiceCheck?.ok}
            className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {voiceTest?.status === "running" ? "试音中…（约 15 秒）" : "🔊 试音"}
          </button>
          {voiceTest?.status === "ok" && <span className="text-xs text-green-700">✅ 这个音色能出声</span>}
          {voiceTest?.status === "silent" && <span className="text-xs text-red-600">❌ 连上了但没有声音：音色编号无效，或账户欠费被停服</span>}
          {voiceTest?.status === "error" && <span className="text-xs text-red-600">❌ {voiceTest.message}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">语音作答（浏览器 STT，即将支持）</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.voice.sttEnabled}
            onChange={(e) => setS({ ...s, voice: { ...s.voice, sttEnabled: e.target.checked } })}
          />
          麦克风语音作答（STT，需要 Chrome/Edge）
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存设置"}
        </button>
        {saved && <span className="text-sm text-green-600">已保存，下一次请求即生效。</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
