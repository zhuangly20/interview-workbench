"use client";

// 火山「AI 音视频互动」语音引擎：
// - interview = 整场模拟面试：一通连续电话，豆包按注入的题单自己推进追问与切题；
//   听到结束语句（或时间兜底到点）自动挂断，全量逐字稿 POST 给 turn 接口按原题切分落盘。
// - teach = 单题教学：教练协议、候选人控节奏，挂断后服务端结算覆盖账本。
// 浏览器：RTC SDK 进房发布麦克风 / 订阅 AI 音频；二进制消息解析字幕(subv)与状态(conv)。

import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeSession } from "@/lib/types";

interface JoinInfo {
  appId: string;
  roomId: string;
  userId: string;
  agentUserId: string;
  taskId: string;
  token: string;
}

interface Seg {
  userId: string;
  text: string;
  definite: boolean;
}

interface EngineLike {
  joinRoom(
    token: string,
    roomId: string,
    userInfo: Record<string, unknown>,
    roomConfig: Record<string, unknown>,
  ): Promise<number | { code?: number; users?: string[] }>;
  leaveRoom(): Promise<void>;
  startAudioCapture(deviceId?: string): Promise<void>;
  stopAudioCapture(): Promise<void>;
  on(event: string, handler: (e: unknown) => void): void;
  setPlaybackVolume?(userId: string, streamIndex: number, volume: number): void;
}

interface VertcLike {
  createEngine(appId: string): EngineLike;
  destroyEngine(engine: EngineLike): void;
  events: Record<string, string>;
}

/** conv 消息里的 AI 状态码（对齐官方 demo AGENT_BRIEF） */
const AGENT_STAGE = { LISTENING: 1, THINKING: 2, SPEAKING: 3, INTERRUPTED: 4, FINISHED: 5 } as const;

/** 整场结束语句哨兵：协议要求豆包一字不差地说结束语；这里再放宽匹配几种说法 */
const CLOSE_RE = /面试就到这里|谢谢你的时间|end of today's interview|thank you for your time/i;

/** 进房兜底超时：joinRoom 在代理断连/浏览器不支持 WebRTC 时可能永远无响应 */
const JOIN_TIMEOUT_MS = 20_000;

function parseTlv(buf: ArrayBuffer): { type: string; value: string } | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < 8) return null;
  const type = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  const len = ((u8[4] << 24) | (u8[5] << 16) | (u8[6] << 8) | u8[7]) >>> 0;
  if (u8.length < 8 + len) return null;
  return { type, value: new TextDecoder().decode(u8.slice(8, 8 + len)) };
}

export default function VoicePanel({
  targetId,
  sessionId,
  questionId,
  getDurationSec,
  onQuit,
  variant = "interview",
  onTeachEnd,
  onStageChange,
  onTranscript,
  onWholeDone,
  autoFinishSec,
}: {
  targetId: string;
  sessionId: string;
  /** teach 模式必传（单题）；interview 整场模式不需要 */
  questionId?: string;
  getDurationSec: () => number;
  /** teach：转文字；interview：handover 会在保存成功后带上更新后的场次调用 */
  onQuit: (saved?: PracticeSession) => void;
  /** interview = 正式模拟（默认，整场连续电话）；teach = 教学陪练（教练协议、结束即结算） */
  variant?: "interview" | "teach";
  /** 教学结束：逐字稿保存并结算完成（coverage 为服务端结算出的覆盖账本） */
  onTeachEnd?: (session?: PracticeSession, coverage?: { covered: string[]; missing: string[] }) => void;
  /** 把内部阶段报给父层（父层的关闭确认需要区分"通话中会丢内容"和"保存结算期关了也没事"） */
  onStageChange?: (stage: "starting" | "live" | "saving" | "ended" | "error") => void;
  /** 显示抬升：传了就把逐字稿实时报给父层渲染成聊天气泡，本组件不再自渲染逐字稿框 */
  onTranscript?: (lines: { agent: boolean; text: string }[], interim: { agent: string; user: string }) => void;
  /** interview 整场结束：逐字稿已保存并按题切分（session 为更新后的场次） */
  onWholeDone?: (session?: PracticeSession) => void;
  /** 整场时间兜底（秒）：到点自动挂断保存（结束语没被识别时的保险） */
  autoFinishSec?: number;
}) {
  const [stage, setStage] = useState<"starting" | "live" | "saving" | "ended" | "error">("starting");
  const [aiStage, setAiStage] = useState<"listening" | "thinking" | "speaking" | null>(null);
  const [lines, setLines] = useState<{ agent: boolean; text: string }[]>([]);
  const [interim, setInterim] = useState<{ agent: string; user: string }>({ agent: "", user: "" });
  const [error, setError] = useState("");
  // AI 在说话（逐字稿在滚动）但 SDK 播放元素全部被静音/暂停：屏幕直接提示去解静音，别让她对着无声画面干等
  const [playbackMuted, setPlaybackMuted] = useState(false);
  const [selfCheckNote, setSelfCheckNote] = useState("");
  // 整场结束哨兵命中：豆包说了结束语 → 自动挂断保存
  const [closeHit, setCloseHit] = useState(false);
  const closeRef = useRef(false);

  const engineRef = useRef<EngineLike | null>(null);
  const joinRef = useRef<JoinInfo | null>(null);
  const segsRef = useRef<Seg[]>([]);
  // 教练/面试官在房间的 userId：结算保存失败重试时连接已拆除，从这里取
  const agentUidRef = useRef<string | null>(null);
  // 逐字稿滚动容器：新字幕到达时吸底
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 启动代际号：teardown/重启会让旧 start 的异步流程作废（防双任务、防孤儿）
  const runIdRef = useRef(0);
  // 最新回调放 ref，挂载自动启动的 useEffect 只跑一次
  const cbsRef = useRef({ onQuit, onTeachEnd, onStageChange, onTranscript, onWholeDone });
  cbsRef.current = { onQuit, onTeachEnd, onStageChange, onTranscript, onWholeDone };
  const durRef = useRef(getDurationSec);
  durRef.current = getDurationSec;

  const teardown = useCallback(async () => {
    runIdRef.current += 1; // 作废所有在途 start
    const info = joinRef.current;
    const engine = engineRef.current;
    joinRef.current = null;
    engineRef.current = null;
    if (engine) {
      try {
        await engine.stopAudioCapture();
      } catch { /* 忽略 */ }
      try {
        await engine.leaveRoom();
      } catch { /* 忽略 */ }
      try {
        const mod = (await import("@volcengine/rtc")) as unknown as { default?: VertcLike } & VertcLike;
        (mod.default ?? mod).destroyEngine(engine);
      } catch { /* 忽略 */ }
    }
    if (info) {
      // 兜底停任务，避免 180s 宽限期继续计费
      void fetch("/api/voice/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: info.appId, roomId: info.roomId, taskId: info.taskId }),
        keepalive: true,
      });
    }
  }, []);

  const start = useCallback(async () => {
    // 已有连接（重试/双挂载竞态）先清掉，保证全页最多一个任务、一个引擎
    if (joinRef.current || engineRef.current) await teardown();
    const myRun = ++runIdRef.current;
    setStage("starting");
    setError("");
    setAiStage(null);
    setLines([]);
    setInterim({ agent: "", user: "" });
    segsRef.current = [];
    closeRef.current = false;
    setCloseHit(false);

    let info: JoinInfo;
    try {
      const res = await fetch("/api/voice/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          variant === "teach"
            ? { targetId, sid: sessionId, questionId, teach: true }
            : { targetId, sid: sessionId },
        ),
      });
      const data = (await res.json()) as JoinInfo & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "启动语音任务失败");
      info = data;
      if (runIdRef.current !== myRun) {
        // 等待期间被卸载/新启动作废：停掉刚创建的任务，不留孤儿
        void fetch("/api/voice/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId: data.appId, roomId: data.roomId, taskId: data.taskId }),
          keepalive: true,
        });
        return;
      }
    } catch (e) {
      if (runIdRef.current !== myRun) return;
      setStage("error");
      setError(e instanceof Error ? e.message : "启动语音任务失败");
      return;
    }

    try {
      const mod = (await import("@volcengine/rtc")) as unknown as { default?: VertcLike } & VertcLike;
      const VERTC = mod.default ?? mod;
      const engine = VERTC.createEngine(info.appId);
      engineRef.current = engine;
      joinRef.current = info;
      agentUidRef.current = info.agentUserId;

      const evt = VERTC.events ?? {};
      engine.on(evt.onRoomBinaryMessageReceived ?? "onRoomBinaryMessageReceived", (e: unknown) => {
        const { message } = e as { userId: string; message: ArrayBuffer };
        const msg = parseTlv(message);
        if (!msg) return;
        if (msg.type === "subv") {
          try {
            const parsed = JSON.parse(msg.value) as { data?: { userId: string; text: string; definite: boolean }[] };
            for (const item of parsed.data ?? []) {
              if (!item.text?.trim()) continue;
              const agent = item.userId === info.agentUserId;
              if (item.definite) {
                segsRef.current.push({ userId: item.userId, text: item.text, definite: true });
                setLines((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.agent === agent) {
                    return [...prev.slice(0, -1), { agent, text: `${last.text} ${item.text}` }];
                  }
                  return [...prev, { agent, text: item.text }];
                });
                setInterim((p) => ({ ...p, [agent ? "agent" : "user"]: "" }));
                // 整场模式：面试官说出结束语 → 自动挂断保存
                if (variant === "interview" && agent && !closeRef.current && CLOSE_RE.test(item.text)) {
                  closeRef.current = true;
                  setCloseHit(true);
                }
              } else {
                setInterim((p) => ({ ...p, [agent ? "agent" : "user"]: item.text }));
              }
            }
          } catch { /* 字幕 JSON 解析失败，跳过 */ }
        } else if (msg.type === "conv") {
          try {
            const parsed = JSON.parse(msg.value) as { Stage?: { Code?: number } };
            const code = Number(parsed.Stage?.Code);
            if (code === AGENT_STAGE.LISTENING || code === AGENT_STAGE.INTERRUPTED || code === AGENT_STAGE.FINISHED) {
              setAiStage("listening");
            } else if (code === AGENT_STAGE.THINKING) {
              setAiStage("thinking");
            } else if (code === AGENT_STAGE.SPEAKING) {
              setAiStage("speaking");
            }
          } catch { /* 状态消息解析失败，跳过 */ }
        }
      });

      // 信令断连等致命错误（RECONNECT_FAILED/TOKEN_ERROR 等）：SDK 给了真实原因就直接展示，不等兜底超时
      engine.on(evt.onError ?? "onError", (raw: unknown) => {
        if (runIdRef.current !== myRun) return;
        const code = String((raw as { errorCode?: string | number } | null)?.errorCode ?? "unknown");
        setStage("error");
        setError(`语音连接出错（${code}）：请检查代理与网络后重试`);
        void teardown();
      });

      // 失败时 SDK 会 reject；成功时 4.69 返回 {users, streams}（无 code），旧版返回数字 0
      // 代理未运行/浏览器不支持 WebRTC 时 joinRoom 可能永远无响应；而用户切走窗口后，页面里的
      // setTimeout 会被 Chrome 冻结、报错永远不出现——兜底定时器放进 Worker，不受页面节流影响
      const joinWorker = new Worker(
        URL.createObjectURL(new Blob([`setTimeout(() => postMessage(0), ${JOIN_TIMEOUT_MS})`], { type: "text/javascript" })),
      );
      const joined = await Promise.race([
        engine.joinRoom(
          info.token,
          info.roomId,
          { userId: info.userId, extraInfo: JSON.stringify({ user_name: info.userId }) },
          // RoomProfileType.chat = 5（SDK 枚举是数值，传字符串会被进房校验拒绝）
          { isAutoPublish: true, isAutoSubscribeAudio: true, roomProfileType: 5 },
        ),
        new Promise<never>((_, reject) => {
          joinWorker.onmessage = () =>
            reject(new Error("语音连接超时：房间一直没连上。请确认代理软件（如 Clash）在运行；若开着代理也可试试关掉再试"));
        }),
      ]).finally(() => joinWorker.terminate());
      const code = typeof joined === "object" && joined !== null ? joined.code : joined;
      if (code !== undefined && code !== 0) {
        const detail = typeof joined === "object" ? JSON.stringify(joined) : String(joined);
        throw new Error(`进房失败（${detail}），请检查 AppId/Token`);
      }
      if (runIdRef.current !== myRun) {
        await teardown(); // 进房期间被作废：清连接并停任务
        return;
      }
      await engine.startAudioCapture();
      setStage("live");
      // SDK 自动建的播放元素偶发停在 muted/paused（自动播放策略）：进房后统一矫正一次
      requestAnimationFrame(() => {
        document.querySelectorAll("audio, video").forEach((raw) => {
          const el = raw as HTMLMediaElement;
          el.muted = false;
          if (el.volume === 0) el.volume = 1;
          void el.play().catch(() => { /* 仍被拦也没关系，用户可点声音自检 */ });
        });
      });
    } catch (e) {
      if (runIdRef.current !== myRun) return; // 已作废的启动，错误不再展示
      setStage("error");
      setError(e instanceof Error ? e.message : "RTC 连接失败");
      void teardown();
    }
  }, [questionId, sessionId, targetId, teardown, variant]);

  // 挂载即启动（父组件按场次加 key；整场模式一场只挂一次）
  const startRef = useRef(start);
  startRef.current = start;
  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;
  useEffect(() => {
    void startRef.current();
    // 卸载时清连接并停火山任务：覆盖 StrictMode 的挂载-卸载-再挂载与页面离开
    return () => {
      void teardownRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishQuestion = useCallback(
    async (mode: "finish" | "handover") => {
      const info = joinRef.current;
      const segments = segsRef.current;
      if (info?.agentUserId) agentUidRef.current = info.agentUserId;
      // 挂断并给出明确的保存状态（教学模式的服务端结算要等大脑，真大脑约 30-60 秒）
      setStage("saving");
      await teardown();

      if (variant === "teach") {
        // 教学结束：逐字稿全量落盘（服务端先存后结算）→ 父层展示清单与蒸馏入口
        const agentUid = agentUidRef.current ?? "interviewer";
        const userSpoke = segments.some((s) => s.userId !== agentUid && s.text.trim());
        if (!userSpoke) {
          cbsRef.current.onTeachEnd?.();
          return;
        }
        try {
          const res = await fetch(`/api/targets/${targetId}/sessions/${sessionId}/turn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId,
              mode: "teach",
              transcript: {
                agentUserId: agentUid,
                segments,
                durationSec: durRef.current(),
              },
            }),
          });
          const data = (await res.json()) as {
            session?: PracticeSession;
            coverage?: { covered: string[]; missing: string[] };
            error?: string;
          };
          // 逐字稿已落盘就进结束态：结算失败最多缺覆盖清单（复盘页蒸馏仍可用），不再卡错误页
          if (data.session) {
            cbsRef.current.onTeachEnd?.(data.session, data.coverage);
            return;
          }
          throw new Error(data.error ?? "逐字稿保存失败");
        } catch (e) {
          setStage("error");
          setError(e instanceof Error ? e.message : "逐字稿保存失败");
        }
        return;
      }

      // interview = 整场：挂断后全量逐字稿 POST（不带 questionId），服务端按原题文本切分成每题 turn
      const agentUid = agentUidRef.current ?? "interviewer";
      const userSpoke = segments.some((s) => s.userId !== agentUid && s.text.trim());
      if (!userSpoke) {
        // 一句没说：没有可保存的内容，直接交给父层（结束卡 / 文字通道）
        if (mode === "handover") cbsRef.current.onQuit?.();
        else cbsRef.current.onWholeDone?.();
        return;
      }
      try {
        const res = await fetch(`/api/targets/${targetId}/sessions/${sessionId}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: { agentUserId: agentUid, segments, durationSec: durRef.current() },
          }),
        });
        const data = (await res.json()) as { session?: PracticeSession; error?: string };
        if (!res.ok || !data.session) throw new Error(data.error ?? "逐字稿保存失败");
        if (mode === "handover") cbsRef.current.onQuit?.(data.session);
        else cbsRef.current.onWholeDone?.(data.session);
      } catch (e) {
        setStage("error");
        setError(e instanceof Error ? e.message : "逐字稿保存失败");
      }
    },
    [questionId, sessionId, targetId, teardown, variant],
  );

  const finishRef = useRef(finishQuestion);
  finishRef.current = finishQuestion;

  // 哨兵命中 → 自动挂断保存（结束语驱动整场收尾）
  useEffect(() => {
    if (closeHit && stage === "live") {
      void finishRef.current("finish");
    }
  }, [closeHit, stage]);

  // 时间兜底：到点（总时长 + 90 秒宽限）自动挂断保存，防结束语没被识别导致通话无限挂着一直计费
  useEffect(() => {
    if (variant !== "interview" || stage !== "live" || !autoFinishSec) return;
    const t = setInterval(() => {
      if (!closeRef.current && durRef.current() >= autoFinishSec) {
        closeRef.current = true;
        void finishRef.current("finish");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [variant, stage, autoFinishSec]);

  // 页面关闭兜底停任务（不保存逐字稿）
  useEffect(() => {
    const onUnload = () => {
      const info = joinRef.current;
      if (info) {
        void fetch("/api/voice/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId: info.appId, roomId: info.roomId, taskId: info.taskId }),
          keepalive: true,
        });
      }
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      onUnload();
    };
  }, []);

  // 逐字稿吸底：新字幕（含正在说的临时句）到达时滚到最新一条
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, interim]);

  // 逐字稿抬升给父层渲染聊天气泡（单题教学层 / 模拟面试层统一用气泡）
  useEffect(() => {
    cbsRef.current.onTranscript?.(lines, interim);
  }, [lines, interim]);

  // 阶段上报给父层（关闭确认用）
  useEffect(() => {
    cbsRef.current.onStageChange?.(stage);
  }, [stage]);

  // 直播中每 3 秒检查 SDK 的播放元素：全部被静音/暂停/音量为 0 就提示（正常播放时不打扰）
  useEffect(() => {
    if (stage !== "live") {
      setPlaybackMuted(false);
      return;
    }
    const t = setInterval(() => {
      const els = [...document.querySelectorAll("audio, video")] as HTMLMediaElement[];
      setPlaybackMuted(els.length > 0 && els.every((a) => a.muted || a.paused || a.volume === 0));
    }, 3000);
    return () => clearInterval(t);
  }, [stage]);

  const who = variant === "teach" ? "教练" : "面试官";

  /** 一键声音自检：短哔走用户手势测窗口出声能力，同时修复所有已知无声原因并报告诊断结果 */
  const soundSelfCheck = useCallback(async () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      osc.onended = () => void ctx.close();
    } catch { /* WebAudio 不可用时忽略，修复照做 */ }

    let fixed = 0;
    let trackDead = false;
    const els = [...document.querySelectorAll("audio, video")] as HTMLMediaElement[];
    for (const el of els) {
      if (el.muted || el.paused || el.volume === 0) fixed++;
      el.muted = false;
      if (el.volume === 0) el.volume = 1;
      // WebRTC 声音可能被指向“默认通信设备”（拔掉的耳机等）：强制回默认输出
      if (el.sinkId && el.sinkId !== "") await el.setSinkId("").catch(() => {});
      await el.play().catch(() => {});
      if ((el.srcObject as MediaStream | null)?.getAudioTracks().some((t) => t.muted)) trackDead = true;
    }
    // SDK 内部远端音量万一被置 0：拉回 100%
    try {
      await engineRef.current?.setPlaybackVolume?.(agentUidRef.current ?? "interviewer", 0, 100);
    } catch { /* 旧版本 SDK 无此方法 */ }

    setSelfCheckNote(
      els.length === 0
        ? "页面上还没有音频播放元素——等两秒再点一次"
        : trackDead
          ? "AI 的音频轨道没有在传数据——通常重开一场语音就恢复；还不行告诉我"
          : fixed > 0
            ? `恢复了 ${fixed} 处静音/暂停/输出指向——AI 的声音应该来了`
            : "哔——浏览器出声正常、播放元素状态正常；若 AI 仍无声，重开一场语音试试",
    );
  }, []);
  const stageLabel =
    stage === "starting"
      ? "连接中…（请在浏览器弹窗允许麦克风）"
      : stage === "saving"
        ? variant === "teach"
          ? "💾 逐字稿已保存，正在结算覆盖账本（约 30-60 秒）——可以放心等待或关闭"
          : "💾 面试已结束，正在保存并按题切分逐字稿…"
        : aiStage === "speaking"
          ? `🗣️ ${who}发言中（说话即可打断）`
          : aiStage === "thinking"
            ? `🤔 ${who}思考中…`
            : variant === "teach"
              ? "🎙️ 听你说——说完停顿几秒，教练会接话；不说停就一直练"
              : "🎙️ 听你说——面试官会自己推进题目，你只管回答";

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
          {stage === "ended" ? "已结束" : stageLabel}
        </span>
        <span className="text-xs text-gray-400">火山实时语音 · 每场约 0.1-0.5 元</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void soundSelfCheck()}
          className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          🔊 声音自检
        </button>
        {selfCheckNote && <span className="text-xs text-amber-600">{selfCheckNote}</span>}
      </div>

      {!onTranscript && stage !== "starting" && (lines.length > 0 || interim.agent || interim.user) && (
        <div ref={boxRef} className="max-h-64 space-y-2 overflow-auto rounded-md bg-gray-50 p-3 text-sm">
          {lines.map((l, i) => (
            <p key={i} className={l.agent ? "text-gray-500" : "font-medium"}>
              <span className="mr-1 text-xs text-gray-400">{l.agent ? who : "你"}</span>
              {l.text}
            </p>
          ))}
          {interim.agent && <p className="text-gray-400 italic">{who}：{interim.agent}…</p>}
          {interim.user && <p className="text-gray-400 italic">你：{interim.user}…</p>}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {playbackMuted && stage === "live" && (
        <p className="text-sm text-amber-600">
          🔇 AI 在说话，但浏览器的声音被静音了：右键标签页看是否「网站静音」，或点地址栏左侧图标检查「声音」是否允许；
          也可以看 Windows 音量混合器里这个浏览器是不是被静音了
        </p>
      )}

      {stage === "live" && variant === "teach" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void finishQuestion("finish")}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            结束练习（保存并结算）
          </button>
          <button
            onClick={() => onQuit()}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
            title="退出语音，改用文字继续陪练"
          >
            转文字输入
          </button>
        </div>
      )}
      {stage === "live" && variant !== "teach" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void finishQuestion("finish")}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            结束面试
          </button>
          <button
            onClick={() => void finishQuestion("handover")}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
            title="挂断语音，已说的部分保存后转文字通道继续"
          >
            转文字继续
          </button>
        </div>
      )}
      {stage === "error" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void finishQuestion("finish")}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            {variant === "teach" ? "重新保存并结算" : "重新保存逐字稿"}
          </button>
          <button
            onClick={() => cbsRef.current.onQuit?.()}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
          >
            放弃保存，转文字
          </button>
        </div>
      )}
    </div>
  );
}
