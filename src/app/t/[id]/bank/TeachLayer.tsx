"use client";

// T6 教学陪练层：题库页点「🎯 陪练」就地弹出（不跳页）。
// 一上来就是语音（火山实时语音 + 教练协议，自动连房）；文字输入是备用通道。
// 覆盖账本：文字模式逐轮实时更新；语音模式挂断后服务端结算。
// 结束 → 覆盖清单 → 「沉淀参考答案」随时可点（结果缓存进场次，纯展示不写库）。

import { useEffect, useRef, useState } from "react";
import RunStatus from "@/components/RunStatus";
import { sectionLabel } from "@/lib/sections";
import VoicePanel from "../practice/VoicePanel";
import type { BankQuestion, ChatMsg, Coverage, DistillResult, PracticeSession, TargetBundle } from "@/lib/types";

type Phase = "loading" | "voice" | "text" | "gate" | "ended";

export default function TeachLayer({ id, qid, onClose }: { id: string; qid: string; onClose: () => void }) {
  const [bundle, setBundle] = useState<TargetBundle | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [voiceOk, setVoiceOk] = useState(false);
  const [voiceMissing, setVoiceMissing] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [runEstimate, setRunEstimate] = useState("");
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [distill, setDistill] = useState<DistillResult | null>(null);
  const [distillBusy, setDistillBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // 已点发送、还没拿到教练回复的那句话：先乐观上屏，免得像没发出去
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  // 语音面板的内部阶段：关闭确认要区分"通话中（关了丢内容）"和"保存结算期（关了没事）"
  const [voiceStage, setVoiceStage] = useState<string | null>(null);
  // 语音逐字稿实时气泡（VoicePanel 抬升上来，与文字气泡同形态）
  const [liveLines, setLiveLines] = useState<{ agent: boolean; text: string }[]>([]);
  const [liveInterim, setLiveInterim] = useState<{ agent: string; user: string }>({ agent: "", user: "" });
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const question: BankQuestion | undefined = bundle?.bank?.questions.find((q) => q.id === qid);
  const turn = session?.turns.find((t) => t.questionId === qid);
  const liveCoverage = coverage ?? turn?.coverage ?? null;
  const goldCount = turn?.gold?.length ?? 0;
  const chat: ChatMsg[] = turn?.chat ?? [];
  const lang = bundle?.meta.language === "zh" ? "中文" : "英文";

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 开层：建场次 + 语音预检 → 凭证齐自动进语音，缺凭证进文字引导
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bRes, vRes] = await Promise.all([fetch(`/api/targets/${id}`), fetch("/api/voice/check")]);
        const bundleData = await bRes.json();
        const voice = await vRes.json();
        if (cancelled) return;
        setBundle(bundleData);
        setVoiceOk(voice.ok === true);
        setVoiceMissing(voice.missing ?? []);
        const sRes = await fetch(`/api/targets/${id}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: qid }),
        });
        const sData = await sRes.json();
        if (cancelled) return;
        if (!sRes.ok) {
          setError(sData.error ?? "无法开始");
          setPhase("gate");
          return;
        }
        setSession(sData.session);
        setPhase(voice.ok ? "voice" : "gate");
      } catch {
        if (!cancelled) {
          setError("加载失败");
          setPhase("gate");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, qid]);

  // 吸底滚动：新消息 / 乐观气泡 / 逐字稿到达 / 进入结束态时都滚到最新内容（ended 的清单和按钮在聊天记录下方）
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, pendingMsg, busy, phase, liveLines.length, liveInterim.agent, liveInterim.user]);

  function stopRun() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  /** 文字通道：发一句给教练（逐轮大脑调用，回复带覆盖账本/金句/ended） */
  async function sendText() {
    const msg = input.trim();
    if (!msg || !session || busy) return;
    setInput("");
    setPendingMsg(msg);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setRunEstimate("模型思考中（几秒到 1 分钟）");
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: qid, answer: msg, mode: "teach" }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setPendingMsg(null);
        setError(data.error ?? "发送失败");
        setRaw(data.raw ?? "");
        setInput(msg); // 没发出去，还给她
        return;
      }
      setPendingMsg(null); // 真消息已随 session 回来，撤掉乐观气泡
      setSession(data.session);
      setCoverage(data.coverage ?? null);
      if (data.ended) setPhase("ended");
    } catch {
      setPendingMsg(null);
      setError("已停止（这条消息可能没发出，可重发）");
      setInput(msg);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setRunEstimate("");
    }
  }

  /** 结束练习（文字模式）：归档场次（教学场次不评分）→ 展示清单 */
  async function endSession() {
    if (!session) return;
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/finish`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.session) setSession(data.session);
    } catch { /* 归档失败也不拦截展示清单 */ }
    setPhase("ended");
  }

  /** 蒸馏：点了才调大脑；结果缓存进场次，再点直接返回缓存 */
  async function runDistill() {
    if (!session || distillBusy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDistillBusy(true);
    setRunEstimate("蒸馏中（30-60 秒）");
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/distill`, {
        method: "POST",
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "蒸馏失败");
        setRaw(data.raw ?? "");
        return;
      }
      setDistill(data.distill);
    } catch {
      setError("已停止（可重试）");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setDistillBusy(false);
      setRunEstimate("");
    }
  }

  function copyDraft() {
    if (!distill) return;
    void navigator.clipboard.writeText(distill.referenceDraft.replaceAll("✨", ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /** 再开一轮：新场次，回到语音（或 gate 引导） */
  async function restart() {
    setError("");
    setRaw("");
    setCoverage(null);
    setDistill(null);
    setCopied(false);
    const res = await fetch(`/api/targets/${id}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: qid }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "无法开始");
      return;
    }
    setSession(data.session);
    setPhase(voiceOk ? "voice" : "gate");
  }

  function requestClose() {
    // 只有真在通话/连接中（逐字稿还没提交）才需要挽留；保存结算期关掉，服务器照样把保存+结算跑完
    if (phase === "voice" && (voiceStage === "live" || voiceStage === "starting")) {
      if (!window.confirm("语音正在进行中，这段对话还没保存，直接关闭会丢失。确定关闭？")) return;
    }
    onClose();
  }

  /** 蒸馏草稿里的 ✨金句✨ 高亮渲染 */
  function renderMarked(text: string) {
    return text.split("✨").map((p, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="rounded bg-amber-100 px-0.5">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  }

  const coverageCard = liveCoverage && (liveCoverage.covered.length > 0 || liveCoverage.missing.length > 0) && (
    <div className="rounded-lg border bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">得分点覆盖（✓ 已练到 / ✗ 还没练到）</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {liveCoverage.covered.map((c, i) => (
          <span key={`c${i}`} className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
            ✓ {c}
          </span>
        ))}
        {liveCoverage.missing.map((m, i) => (
          <span key={`m${i}`} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            ✗ {m}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={requestClose}>
      <div
        className="absolute inset-x-0 bottom-0 top-14 mx-auto flex max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              🎯 单题教学陪练
              {goldCount > 0 && <span className="text-xs font-normal text-amber-600">✨ 已收集 {goldCount} 句金句</span>}
            </p>
            {question && <p className="mt-0.5 truncate text-xs text-gray-400">{question.question}</p>}
          </div>
          <button onClick={requestClose} className="shrink-0 rounded px-2 py-1 text-gray-400 hover:bg-gray-100">
            ✕
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">{error}</p>
            {raw && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{raw}</pre>}
          </div>
        )}
        {busy && runEstimate && (
          <div className="mx-5 mt-3">
            <RunStatus estimate={runEstimate} onStop={stopRun} />
          </div>
        )}

        {/* 主体 */}
        <div ref={scrollerRef} className="flex-1 space-y-3 overflow-auto px-5 py-4">
          {phase === "loading" && <p className="text-center text-sm text-gray-400">准备中…</p>}

          {phase === "gate" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">语音陪练还差 {voiceMissing.length} 项火山配置：{voiceMissing.join("、")}</p>
              <p className="mt-1">
                去<a href="/settings" className="underline">设置页</a>补齐后就能一上来就语音。现在可以先用文字练：
              </p>
              <button
                onClick={() => setPhase("text")}
                className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                用文字练习
              </button>
            </div>
          )}

          {(phase === "text" || phase === "voice" || (phase === "ended" && chat.length > 0)) && (
            <div className="space-y-2">
              {chat.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {m.text}
                  </p>
                </div>
              ))}
              {pendingMsg && (
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white opacity-60">
                    {pendingMsg}
                  </p>
                </div>
              )}
              {/* 语音逐字稿实时气泡（与文字气泡同形态；正在说的半句半透明） */}
              {phase === "voice" &&
                liveLines.map((l, i) => (
                  <div key={`l${i}`} className={`flex ${l.agent ? "justify-start" : "justify-end"}`}>
                    <p
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                        l.agent ? "bg-gray-100 text-gray-800" : "bg-blue-600 text-white"
                      }`}
                    >
                      {l.text}
                    </p>
                  </div>
                ))}
              {phase === "voice" && liveInterim.agent && (
                <div className="flex justify-start">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gray-100 px-3 py-2 text-sm italic text-gray-400 opacity-70">
                    {liveInterim.agent}…
                  </p>
                </div>
              )}
              {phase === "voice" && liveInterim.user && (
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-3 py-2 text-sm italic text-white opacity-60">
                    {liveInterim.user}…
                  </p>
                </div>
              )}
            </div>
          )}

          {phase === "text" && (
            <div className="rounded-lg border p-3">
              {question && (
                <p className="mb-2 text-xs text-gray-400">
                  本题：{question.question}
                  <span className="ml-2">{sectionLabel(question.section)}</span>
                  {!question.rubric && <span className="ml-2">（暂无评分要点，自然陪聊）</span>}
                </p>
              )}
              <textarea
                className="h-24 w-full rounded-md border px-3 py-2 text-sm"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`用${lang}说，磕磕绊绊也没关系——问「这个用${lang}怎么说」教练会教你…`}
                disabled={busy}
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void sendText()}
                  disabled={busy || !input.trim()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy ? "教练看消息中…" : "发送"}
                </button>
                {voiceOk && (
                  <button
                    onClick={() => setPhase("voice")}
                    className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
                    title="切换回语音陪练"
                  >
                    🎙️ 转语音
                  </button>
                )}
                <button
                  onClick={() => void endSession()}
                  disabled={busy}
                  className="ml-auto rounded-lg border px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                >
                  结束练习
                </button>
              </div>
            </div>
          )}

          {phase === "ended" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                本题练习结束（逐字稿已保存，教学场次不出评分）。
                {chat.length === 0 && " 这场没有留下内容。"}
              </p>
              {coverageCard}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-blue-900">沉淀参考答案</p>
                  {!distill && (
                    <button
                      onClick={() => void runDistill()}
                      disabled={distillBusy}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {distillBusy ? "蒸馏中…" : "生成参考答案草稿"}
                    </button>
                  )}
                </div>
                {distill && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-blue-700">
                        金句已用 <span className="rounded bg-amber-200 px-1">高亮</span> 标出；觉得有道理就复制进题库编辑器。
                        {distill.generatedAt && (
                          <span className="ml-1 opacity-60">
                            （{new Date(distill.generatedAt).toLocaleString("zh-CN")} 生成{distill === session?.distill ? "，缓存结果" : ""}）
                          </span>
                        )}
                      </p>
                      <button
                        onClick={copyDraft}
                        className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                      >
                        {copied ? "✓ 已复制" : "一键复制"}
                      </button>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 text-sm leading-relaxed">
                      {renderMarked(distill.referenceDraft)}
                    </p>
                    {distill.uncovered.length > 0 && (
                      <p className="mt-2 text-xs text-amber-700">这次还没聊到的要点：{distill.uncovered.join("；")}</p>
                    )}
                  </div>
                )}
                {!distill && !distillBusy && (
                  <p className="mt-1 text-xs text-blue-700/70">
                    把这场练出来的好句子融成一份参考答案草稿（不写题库，你自己决定抄不抄）。
                  </p>
                )}
              </div>
              <div className="flex gap-2 pb-2">
                <button
                  onClick={() => void restart()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                >
                  再开一轮
                </button>
                <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100">
                  返回题库
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 语音控制条固定在弹层底部：放进滚动区会被吸底滚动的聊天气泡顶出视口（结束按钮滚没了） */}
        {phase === "voice" && session && (
          <div className="shrink-0 border-t px-5 py-3">
            <VoicePanel
              key={session.id}
              targetId={id}
              sessionId={session.id}
              questionId={qid}
              getDurationSec={() => seconds}
              variant="teach"
              onStageChange={setVoiceStage}
              onTranscript={(lines, interim) => {
                setLiveLines(lines);
                setLiveInterim(interim);
              }}
              onQuit={() => setPhase("text")}
              onTeachEnd={(ss, cov) => {
                // finishedAt 已由服务端在逐字稿落盘时写入，这里只做界面收尾
                if (ss) setSession(ss);
                setCoverage(cov ?? null);
                setPhase("ended");
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
