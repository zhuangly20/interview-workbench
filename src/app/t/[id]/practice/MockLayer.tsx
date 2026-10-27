"use client";

// 模拟面试层：练习页选完时长/风格点开始后就地全屏弹出（不跳页）。
// 聊天气泡形态（与单题教学层统一）：面试官的问题/追问/点评是气泡，语音逐字稿也实时渲染成气泡。
// 时间机制：状态栏只显示时间；每题的时间预算由服务端按 elapsedSec 决策（超时强制切题、到点收尾）。
// 结束 → ended 卡片 → 用户自己点「生成评分复盘」（教学层的蒸馏同款节奏：大脑调用由用户触发）。

import { useEffect, useRef, useState } from "react";
import RunStatus from "@/components/RunStatus";
import SessionReviewModal from "../SessionReviewModal";
import VoicePanel from "./VoicePanel";
import type { PracticeSession } from "@/lib/types";

type Phase = "starting" | "voice" | "text" | "ended";
type Bubble = { role: "coach" | "user"; text: string };

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function MockLayer({
  id,
  minutes,
  styleText,
  voice,
  regeneratePaper,
  onClose,
}: {
  id: string;
  minutes: number;
  styleText: string;
  voice: boolean;
  /** true = 不用缓存的卷子，重新出一套（同时长 + 同拆解版本的缓存会被覆盖） */
  regeneratePaper?: boolean;
  onClose: () => void;
}) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [index, setIndex] = useState(0);
  // 纯展示用的对话流（真相在场次文件里）：问题/追问/点评/逐字稿统一渲染成气泡
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  // 语音逐字稿实时气泡（VoicePanel 抬升上来）
  const [liveLines, setLiveLines] = useState<{ agent: boolean; text: string }[]>([]);
  const [liveInterim, setLiveInterim] = useState<{ agent: string; user: string }>({ agent: "", user: "" });
  const liveLinesRef = useRef<{ agent: boolean; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [followUpQ, setFollowUpQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [runEstimate, setRunEstimate] = useState("");
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [voiceStage, setVoiceStage] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState("");
  const [startErr, setStartErr] = useState("");
  // 计时：全场 + 本题两条
  const [elapsed, setElapsed] = useState(0);
  const [qElapsed, setQElapsed] = useState(0);
  const sessionStartRef = useRef(0);
  const questionStartRef = useRef(0);
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishErr, setFinishErr] = useState("");
  const [timeupFlag, setTimeupFlag] = useState(false);
  const [reviewSid, setReviewSid] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const totalSec = (session?.plannedMinutes ?? minutes ?? 0) * 60;
  const current = session?.questions[index];

  // 全场 + 本题双计时器
  useEffect(() => {
    const t = setInterval(() => {
      if (sessionStartRef.current) setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      if (questionStartRef.current) setQElapsed(Math.floor((Date.now() - questionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // 开层：出卷建场次（30-90 秒，缓存命中则秒开）→ 语音预检（点了语音但缺配置就降级文字，不白连）
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    startAbortRef.current = ctrl;
    (async () => {
      try {
        const res = await fetch(`/api/targets/${id}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minutes: minutes > 0 ? minutes : undefined,
            style: styleText.trim() || undefined,
            regeneratePaper: regeneratePaper || undefined,
          }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStartErr(data.error ?? "无法开始");
          setPhase("ended");
          return;
        }
        const ss: PracticeSession = data.session;
        setSession(ss);
        sessionStartRef.current = Date.now();
        questionStartRef.current = Date.now();
        // 语音模式不推开局题气泡：AI 的 TTS 开场白会把第一题念出来并进逐字稿，再叠一条同样的题就是重复
        const firstBubble: Bubble = { role: "coach", text: ss.questions[0]?.question ?? "" };
        if (voice) {
          try {
            const vRes = await fetch("/api/voice/check");
            const v = await vRes.json();
            if (cancelled) return;
            if (v.ok) {
              setPhase("voice");
            } else {
              setVoiceNote(`语音还缺配置：${(v.missing ?? []).join("、")}。先用文字继续，或去设置页补齐。`);
              setBubbles([firstBubble]);
              setPhase("text");
            }
          } catch {
            if (!cancelled) {
              setVoiceNote("语音预检失败（网络中断），先用文字继续。");
              setBubbles([firstBubble]);
              setPhase("text");
            }
          }
        } else {
          setBubbles([firstBubble]);
          setPhase("text");
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof DOMException && e.name === "AbortError") setStartErr("已取消出卷。");
          else setStartErr("加载失败");
          setPhase("ended");
        }
      }
    })();
    return () => {
      cancelled = true;
      startAbortRef.current = null;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 吸底滚动：新气泡 / 乐观气泡 / 逐字稿到达 / 结束态时都滚到最新内容
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles.length, pendingMsg, busy, phase, liveLines.length, liveInterim.agent, liveInterim.user]);

  function stopRun() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  /** 把语音逐字稿气泡固化进对话流（转文字/结束时调用） */
  function mergeLiveToBubbles() {
    const settled = liveLinesRef.current
      .filter((l) => l.text.trim())
      .map((l): Bubble => ({ role: l.agent ? "coach" : "user", text: l.text }));
    liveLinesRef.current = [];
    setLiveLines([]);
    setLiveInterim({ agent: "", user: "" });
    setBubbles((b) => [...b, ...settled]);
  }

  /** 整场语音结束（结束语哨兵/时间兜底/手动结束面试）：逐字稿已在服务端按题切分 */
  function finishVoice(ss?: PracticeSession) {
    mergeLiveToBubbles();
    if (ss) setSession(ss);
    setPhase("ended");
  }

  /** 语音转文字：已说的部分已保存并切分，从第一道没答的题继续文字通道 */
  function handoverToText(ss?: PracticeSession) {
    mergeLiveToBubbles();
    if (ss) {
      setSession(ss);
      const done = ss.turns.length;
      if (done >= ss.questions.length) {
        setPhase("ended");
        return;
      }
      questionStartRef.current = Date.now();
      setQElapsed(0);
      setIndex(done);
      setInput("");
      setFollowUpQ("");
      setBubbles((b) => [...b, { role: "coach", text: ss.questions[done].question }]);
    }
    setPhase("text");
  }

  /** 文字通道切下一题：出下一题气泡（或收尾致谢） */
  function toNext(ss: PracticeSession, fromIndex: number) {
    const next = fromIndex + 1;
    if (next >= ss.questions.length) {
      setBubbles((b) => [...b, { role: "coach", text: "好的，今天的面试就到这里，谢谢你的时间。" }]);
      setPhase("ended");
      return;
    }
    questionStartRef.current = Date.now();
    setQElapsed(0);
    setIndex(next);
    setInput("");
    setFollowUpQ("");
    setBubbles((b) => [...b, { role: "coach", text: ss.questions[next].question }]);
  }

  /** 文字提交回答 → 面试官决策（followup / next / timeup） */
  async function submitAnswer() {
    if (!session || !current || busy) return;
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    setPendingMsg(msg);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setRunEstimate("面试官思考中（几秒到 1 分钟）");
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: current.id,
          answer: msg,
          durationSec: qElapsed,
          elapsedSec: elapsed,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setPendingMsg(null);
        setError(data.error ?? "提交失败");
        setRaw(data.raw ?? "");
        setInput(msg);
        return;
      }
      setPendingMsg(null);
      setSession(data.session);
      const coachBits: Bubble[] = [];
      if (data.comment) coachBits.push({ role: "coach", text: data.comment });
      if (data.action === "timeup") {
        setBubbles((b) => [...b, { role: "user", text: msg }, ...coachBits]);
        setTimeupFlag(true);
        setPhase("ended");
        return;
      }
      if (data.action === "followup" && data.followUp) {
        coachBits.push({ role: "coach", text: data.followUp });
        setFollowUpQ(data.followUp);
        setBubbles((b) => [...b, { role: "user", text: msg }, ...coachBits]);
        return;
      }
      setBubbles((b) => [...b, { role: "user", text: msg }, ...coachBits]);
      toNext(data.session, index);
    } catch {
      setPendingMsg(null);
      setError("已停止（面试官决策已中断；回答已保存，可重新提交）");
      setInput(msg);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setRunEstimate("");
    }
  }

  /** 文字提交追问的应答 → 服务端记录后直接下一题 */
  async function submitFollowUp() {
    if (!session || !current || busy || !followUpQ) return;
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    setPendingMsg(msg);
    setBusy(true);
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: current.id,
          followUp: { q: followUpQ, a: msg },
          durationSec: qElapsed,
          elapsedSec: elapsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPendingMsg(null);
        setError(data.error ?? "提交失败");
        setRaw(data.raw ?? "");
        setInput(msg);
        return;
      }
      setPendingMsg(null);
      setSession(data.session);
      setBubbles((b) => [...b, { role: "user", text: msg }]);
      toNext(data.session, index);
    } catch {
      setPendingMsg(null);
      setError("已停止（可重新提交）");
      setInput(msg);
    } finally {
      setBusy(false);
    }
  }

  async function skipQ() {
    if (!session || !current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: current.id,
          answer: "",
          skip: true,
          durationSec: qElapsed,
          elapsedSec: elapsed,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSession(data.session);
        toNext(data.session, index);
      } else {
        setError(data.error ?? "跳过失败");
      }
    } finally {
      setBusy(false);
    }
  }

  /** ended 卡片里的「生成评分复盘」：点了才调大脑（2-3 分钟），成功后打开复盘弹窗 */
  async function runFinish() {
    if (!session || finishBusy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setFinishBusy(true);
    setRunEstimate("评分生成中（2-3 分钟，含题库匹配）");
    setFinishErr("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${session.id}/finish`, { method: "POST", signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) {
        setFinishErr(data.error ?? "评分失败");
        setRaw(data.raw ?? "");
        return;
      }
      setSession(data.session);
      setReviewSid(session.id);
    } catch {
      setFinishErr("已停止（作答都已保存，可重试）");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setFinishBusy(false);
      setRunEstimate("");
    }
  }

  function requestClose() {
    // 只有真在通话/连接中（逐字稿还没提交）才需要挽留；保存期关掉，服务器照样把保存跑完
    if (phase === "voice" && (voiceStage === "live" || voiceStage === "starting")) {
      if (!window.confirm("语音正在进行中，这段对话还没保存，直接关闭会丢失。确定关闭？")) return;
    }
    onClose();
  }

  const timeDanger = totalSec > 0 && elapsed >= totalSec;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={requestClose}>
      <div
        className="absolute inset-x-0 bottom-0 top-14 mx-auto flex max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：状态栏只显示时间（尽可能模拟真实面试，不显示题数） */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <p className="text-sm font-medium">🎙️ 模拟面试</p>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-sm ${timeDanger ? "font-semibold text-red-600" : "text-gray-600"}`}>
              ⏱ {fmt(elapsed)}
              {totalSec > 0 ? ` / ${fmt(totalSec)}` : ""}
            </span>
            <button onClick={requestClose} className="rounded px-2 py-1 text-gray-400 hover:bg-gray-100">
              ✕
            </button>
          </div>
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

        {/* 主体：对话流 */}
        <div ref={scrollerRef} className="flex-1 space-y-3 overflow-auto px-5 py-4">
          {phase === "starting" && (
            <div className="py-8">
              <p className="text-center text-sm text-gray-500">正在出卷：按最新岗位拆解现出一套新题（约 30-90 秒；同一时长 + 同一版拆解会复用缓存）…</p>
              <div className="mx-auto mt-3 max-w-sm">
                <RunStatus
                  estimate="30-90 秒"
                  onStop={() => {
                    startAbortRef.current?.abort();
                    onClose();
                  }}
                />
              </div>
            </div>
          )}

          {phase === "ended" && bubbles.length === 0 && startErr && (
            <p className="text-center text-sm text-red-600">{startErr}</p>
          )}

          <div className="space-y-2">
            {bubbles.map((m, i) => (
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
            {liveLines.map((l, i) => (
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
            {liveInterim.agent && (
              <div className="flex justify-start">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gray-100 px-3 py-2 text-sm italic text-gray-400 opacity-70">
                  {liveInterim.agent}…
                </p>
              </div>
            )}
            {liveInterim.user && (
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-3 py-2 text-sm italic text-white opacity-60">
                  {liveInterim.user}…
                </p>
              </div>
            )}
          </div>

          {timeDanger && phase !== "ended" && (
            <p className="text-center text-xs font-medium text-red-600">⏰ 时间已到——面试官会收尾；准备好就结束本场。</p>
          )}

          {/* 结束卡片：评分由用户点按钮触发 */}
          {phase === "ended" && (
            <div className="space-y-3 pb-2">
              <p className="text-sm text-gray-500">
                {timeupFlag ? "时间到，本场模拟结束。" : "本场模拟结束。"}
                {session && ` 全场用时 ${fmt(elapsed)}，逐字稿已保存。`}
              </p>
              {finishErr && <p className="text-sm text-red-600">{finishErr}</p>}
              <div className="flex gap-2">
                {session && (
                  <button
                    onClick={() => void runFinish()}
                    disabled={finishBusy}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {finishBusy ? "评分生成中…" : "生成评分复盘（2-3 分钟）"}
                  </button>
                )}
                <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100">
                  返回
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 语音引擎（整场连续电话）：面试官自己推进题目；结束语哨兵/时间兜底自动挂断保存。
            固定在弹层底部——放进滚动区会被吸底滚动的聊天气泡顶出视口（结束按钮滚没了） */}
        {phase === "voice" && session && (
          <div className="shrink-0 border-t px-5 py-3">
            <VoicePanel
              key={session.id}
              targetId={id}
              sessionId={session.id}
              getDurationSec={() => elapsed}
              variant="interview"
              onStageChange={setVoiceStage}
              onTranscript={(lines, interim) => {
                liveLinesRef.current = lines;
                setLiveLines(lines);
                setLiveInterim(interim);
              }}
              autoFinishSec={totalSec > 0 ? totalSec + 90 : undefined}
              onQuit={(ss) => handoverToText(ss)}
              onWholeDone={(ss) => finishVoice(ss)}
            />
          </div>
        )}

        {/* 底部输入：文字通道（语音模式下 VoicePanel 自带按钮，这里不重复出） */}
        {phase === "text" && current && (
          <div className="border-t px-5 py-3">
            {voiceNote && (
              <p className="mb-2 text-xs text-amber-600">
                🎙️ {voiceNote}{" "}
                <a href="/settings" className="underline">
                  打开设置页
                </a>
              </p>
            )}
            <textarea
              className="h-20 w-full rounded-md border px-3 py-2 text-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={followUpQ ? "回答面试官的追问…" : "说出你的回答（可直接打字）…"}
              disabled={busy}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {followUpQ ? (
                <button
                  onClick={() => void submitFollowUp()}
                  disabled={busy || !input.trim()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy ? "面试官思考中…" : "提交追问回答"}
                </button>
              ) : (
                <button
                  onClick={() => void submitAnswer()}
                  disabled={busy || !input.trim()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy ? "面试官思考中…" : "回答完毕，请面试官继续"}
                </button>
              )}
              {!followUpQ && (
                <button
                  onClick={() => void skipQ()}
                  disabled={busy}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  跳过本题
                </button>
              )}
              <button
                onClick={() => setPhase("ended")}
                disabled={busy}
                className="ml-auto rounded-lg border px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                结束本场
              </button>
            </div>
          </div>
        )}
      </div>

      {reviewSid && session && (
        <SessionReviewModal
          id={id}
          sid={reviewSid}
          onClose={() => setReviewSid(null)}
        />
      )}
    </div>
  );
}
