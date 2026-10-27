"use client";

import { useCallback, useEffect, useState } from "react";
import { QUESTION_SECTIONS, SECTION_COLORS } from "@/lib/sections";
import type { Bank, PracticeSession } from "@/lib/types";

/** 场次复盘弹窗（题库页与模拟页共用）：
 * - full 场次：评分卡（总评+五维+点评）→ 本场结构（按板块分组、附考察点）→ 做得好的 → 下次改进
 * - single 场次：覆盖账本 + 聊天记录 + 蒸馏草稿
 */
export default function SessionReviewModal({
  id,
  sid,
  onClose,
  onChanged,
}: {
  id: string;
  sid: string;
  onClose: () => void;
  /** 复盘有改动（如采纳建议 / 改匹配）时通知父页面刷新 */
  onChanged?: () => void;
}) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [distillBusy, setDistillBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/targets/${id}/sessions/${sid}`)
      .then((r) => r.json())
      .then((d) => setSession(d.session))
      .catch(() => setError("加载失败"));
    fetch(`/api/targets/${id}/bank`)
      .then((r) => r.json())
      .then((d) => setBank(d.bank))
      .catch(() => {});
  }, [id, sid]);

  useEffect(load, [load]);

  async function scoreNow() {
    setBusy(true);
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${sid}/finish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "评分失败");
      setSession(data.session);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion(index: number) {
    const res = await fetch(`/api/targets/${id}/bank/apply-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, index }),
    });
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
      onChanged?.();
    }
  }

  /** 用户改选试卷题 ↔ 题库题的对应关系（AI 匹配只是建议） */
  async function setMatch(questionId: string, bankQuestionId: string | null) {
    const res = await fetch(`/api/targets/${id}/sessions/${sid}/match`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, bankQuestionId }),
    });
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
    }
  }

  async function distillNow() {
    setDistillBusy(true);
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${sid}/distill`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "蒸馏失败");
      setSession((prev) => (prev ? { ...prev, distill: data.distill } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "蒸馏失败");
    } finally {
      setDistillBusy(false);
    }
  }

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-4xl space-y-4 rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {session?.mode === "single" ? "陪练复盘" : "模拟面试复盘"} ·{" "}
            {session && new Date(session.startedAt).toLocaleString("zh-CN")}
            {session?.mode === "single" && (
              <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 align-middle text-xs font-normal text-blue-700">
                🎯 教学 · 不评分
              </span>
            )}
          </h2>
          <button className="shrink-0 rounded px-2 py-1 text-gray-400 hover:bg-gray-100" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {!session && <p className="text-sm text-gray-500">{error || "加载中…"}</p>}

        {session && session.mode === "single" && (
          <SingleView session={session} id={id} sid={sid} onSettled={(s) => setSession(s)} />
        )}

        {session && session.mode !== "single" && (
          <FullView
            id={id}
            sid={sid}
            session={session}
            bank={bank}
            busy={busy}
            scoreNow={scoreNow}
            applySuggestion={applySuggestion}
            setMatch={setMatch}
          />
        )}

        {session?.mode === "single" && (
          <DistillCard session={session} distillBusy={distillBusy} distillNow={distillNow} copied={copied} setCopied={setCopied} renderMarked={renderMarked} />
        )}

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">{error}</p>
            {raw && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{raw}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

function SingleView({
  session,
  id,
  sid,
  onSettled,
}: {
  session: PracticeSession;
  id: string;
  sid: string;
  onSettled: (s: PracticeSession) => void;
}) {
  const [settling, setSettling] = useState(false);
  const [settleErr, setSettleErr] = useState("");
  const firstTurn = session.turns[0];
  const chat = firstTurn?.chat ?? [];
  const cov = firstTurn?.coverage;
  const needSettle = chat.length > 0 && !(cov && (cov.covered.length > 0 || cov.missing.length > 0));

  async function settleNow() {
    setSettling(true);
    setSettleErr("");
    try {
      const res = await fetch(`/api/targets/${id}/sessions/${sid}/settle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "结算失败");
      if (data.session) onSettled(data.session);
    } catch (e) {
      setSettleErr(e instanceof Error ? e.message : "结算失败");
    } finally {
      setSettling(false);
    }
  }

  return (
    <>
      {needSettle && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-center justify-between gap-3">
            <p>语音逐字稿已保存，覆盖清单还没结算。</p>
            <button
              onClick={() => void settleNow()}
              disabled={settling}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {settling ? "结算中…" : "补算覆盖清单"}
            </button>
          </div>
          {settleErr && <p className="mt-1 text-xs text-red-600">{settleErr}</p>}
        </div>
      )}
      {cov && (cov.covered.length > 0 || cov.missing.length > 0) && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="text-sm font-medium text-gray-500">得分点覆盖（✓ 已练到 / ✗ 还没练到）</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cov.covered.map((c, i) => (
              <span key={`c${i}`} className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                ✓ {c}
              </span>
            ))}
            {cov.missing.map((m, i) => (
              <span key={`m${i}`} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                ✗ {m}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-500">陪练聊天记录</h3>
          {(firstTurn?.gold?.length ?? 0) > 0 && (
            <span className="text-xs text-amber-600">✨ 已收集 {firstTurn?.gold?.length} 句金句</span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium">{session.questions[0]?.question}</p>
        {chat.length > 0 ? (
          <div className="mt-3 space-y-2">
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
          </div>
        ) : (
          <details className="mt-2 text-xs text-gray-500">
            <summary className="cursor-pointer">查看逐字稿（旧场次格式）</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2">{firstTurn?.answer || "（未作答）"}</pre>
            {(firstTurn?.followUpQA ?? []).map((f, i) => (
              <div key={i} className="mt-2 rounded bg-blue-50 p-2">
                <p className="font-medium text-blue-900">追问：{f.q}</p>
                <pre className="mt-1 whitespace-pre-wrap">{f.a || "（未回答）"}</pre>
              </div>
            ))}
          </details>
        )}
      </div>
    </>
  );
}

function DistillCard({
  session,
  distillBusy,
  distillNow,
  copied,
  setCopied,
  renderMarked,
}: {
  session: PracticeSession;
  distillBusy: boolean;
  distillNow: () => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
  renderMarked: (t: string) => React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-blue-900">参考答案草稿（蒸馏）</h3>
        {!session.distill && (
          <button
            onClick={distillNow}
            disabled={distillBusy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {distillBusy ? "蒸馏中…" : "生成参考答案草稿"}
          </button>
        )}
      </div>
      {session.distill ? (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-blue-700">
              金句已用 <span className="rounded bg-amber-200 px-1">高亮</span> 标出；觉得有道理就复制进题库编辑器。
            </p>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(session.distill!.referenceDraft.replaceAll("✨", ""));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
            >
              {copied ? "✓ 已复制" : "一键复制"}
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 text-sm leading-relaxed">
            {renderMarked(session.distill.referenceDraft)}
          </p>
          {session.distill.uncovered.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">这次还没聊到的要点：{session.distill.uncovered.join("；")}</p>
          )}
        </div>
      ) : (
        !distillBusy && (
          <p className="mt-1 text-xs text-blue-700/70">
            把这场练出来的好句子融成一份参考答案草稿（不写题库，你自己决定抄不抄）。
          </p>
        )
      )}
    </div>
  );
}

function FullView({
  id,
  sid,
  session,
  bank,
  busy,
  scoreNow,
  applySuggestion,
  setMatch,
}: {
  id: string;
  sid: string;
  session: PracticeSession;
  bank: Bank | null;
  busy: boolean;
  scoreNow: () => void;
  applySuggestion: (i: number) => void;
  setMatch: (qid: string, bankQid: string | null) => void;
}) {
  const sc = session.scorecard;
  if (!sc) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center">
        <p className="text-sm text-gray-500">这场练习还没有评分（{session.turns.length} 个回答已保存）。</p>
        <button
          onClick={scoreNow}
          disabled={busy}
          className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? "评分中…" : "生成评分"}
        </button>
      </div>
    );
  }
  const bankOptions = (bank?.questions ?? []).filter((q) => q.status !== "archived");
  const scoreTone = (v: number) =>
    v >= 4 ? "bg-green-100 text-green-800" : v >= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  // 本场结构：按板块分组（板块按标准顺序，组内保持出场顺序），每组给均分
  const groups = QUESTION_SECTIONS.map(({ key, label }) => {
    const qs = session.questions.filter((q) => (q.section ?? "other") === key);
    const scores = qs
      .map((q) => sc.perQuestion.find((p) => p.questionId === q.id)?.score)
      .filter((x): x is number => typeof x === "number");
    return { key, label, qs, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
  }).filter((g) => g.qs.length > 0);

  return (
    <>
      {/* ① 评分卡：总评 + 五维 + 总体点评 */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="text-center">
            <div className="text-xs text-gray-500">总评</div>
            <div className="text-3xl font-bold">
              {sc.overall.toFixed(1)}
              <span className="text-sm font-normal text-gray-400"> / 5</span>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {(
              [
                ["content", "内容"],
                ["structure", "结构"],
                ["language", "语言"],
                ["timing", "节奏"],
                ["adaptability", "应变"],
              ] as const
            ).map(([key, label]) => (
              <span
                key={key}
                title={sc.dimensions[key].comment}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${scoreTone(sc.dimensions[key].score)}`}
              >
                {label} · {sc.dimensions[key].score.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm">{sc.summary}</p>
      </div>

      {/* ② 本场结构：分几个部分 + 每题考察点与表现 */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-500">
          本场结构：{groups.length} 个部分 · {session.questions.length} 题
        </h3>
        <p className="mt-0.5 text-xs text-gray-400">
          每题附考察点；「对应题库题」只是帮你翻参考答案的线索，猜错了可手改。
        </p>
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${SECTION_COLORS[g.key]}`}>{g.label}</span>
                <span className="text-xs text-gray-400">{g.qs.length} 题</span>
                {g.avg !== null && (
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${scoreTone(g.avg)}`}>均分 {g.avg.toFixed(1)}</span>
                )}
              </div>
              <ul className="mt-2 divide-y">
                {g.qs.map((q) => {
                  const p = sc.perQuestion.find((x) => x.questionId === q.id);
                  const turn = session.turns.find((t) => t.questionId === q.id);
                  const inBank = (bank?.questions ?? []).some((b) => b.id === q.id);
                  const matched = q.matchedBankQuestionId
                    ? (bank?.questions ?? []).find((b) => b.id === q.matchedBankQuestionId)
                    : undefined;
                  return (
                    <li key={q.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{q.question}</p>
                        <span className="shrink-0 text-sm font-semibold">{p ? p.score.toFixed(1) : "—"}</span>
                      </div>
                      {q.rubric && <p className="mt-0.5 text-xs text-gray-400">考察点：{q.rubric}</p>}
                      {p?.comment && <p className="mt-1 text-sm text-gray-600">{p.comment}</p>}
                      {p?.missed && p.missed.length > 0 && (
                        <p className="mt-1 text-xs text-amber-700">漏掉的要点：{p.missed.join("；")}</p>
                      )}
                      {!inBank && bank && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>对应题库题：</span>
                          <select
                            className="max-w-md rounded border px-2 py-1 text-xs"
                            value={q.matchedBankQuestionId ?? ""}
                            onChange={(e) => setMatch(q.id, e.target.value || null)}
                          >
                            <option value="">（不对应）</option>
                            {bankOptions.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.question.slice(0, 60)}
                                {b.question.length > 60 ? "…" : ""}
                              </option>
                            ))}
                          </select>
                          {matched && (
                            <details className="inline">
                              <summary className="cursor-pointer text-blue-700">
                                参考答案{q.matchedReason ? `（${q.matchedReason}）` : ""}
                              </summary>
                              <pre className="mt-1 max-w-2xl whitespace-pre-wrap rounded bg-gray-50 p-2">
                                {matched.answer || "（题库里这题还没有参考答案）"}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                      {turn && (
                        <details className="mt-2 text-xs text-gray-500">
                          <summary className="cursor-pointer">
                            查看逐字稿（{turn.followUpQA.length > 0 ? `${turn.followUpQA.length} 条追问` : "无追问"}
                            {turn.durationSec ? ` · 约 ${Math.round(turn.durationSec)} 秒` : ""}）
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2">{turn.answer || "（未作答）"}</pre>
                          {turn.followUpQA.map((f, i) => (
                            <div key={i} className="mt-2 rounded bg-blue-50 p-2">
                              <p className="font-medium text-blue-900">追问：{f.q}</p>
                              <pre className="mt-1 whitespace-pre-wrap">{f.a || "（未回答）"}</pre>
                            </div>
                          ))}
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ③ 做得好的 */}
      {sc.strengths.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="text-sm font-medium text-gray-500">做得好的</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
            {sc.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ④ 下次改进 */}
      {sc.suggestions.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="font-medium text-blue-900">下次改进（提案 —— 采纳后会写进对应题库题的备注）</h3>
          <ul className="mt-2 space-y-2">
            {sc.suggestions.map((s, i) => {
              const q = session.questions.find((x) => x.id === s.questionId);
              return (
                <li key={i} className="rounded-md bg-white p-3 text-sm">
                  {q && <p className="text-xs text-gray-400">针对：{q.question}</p>}
                  <p className="mt-0.5">{s.text}</p>
                  {s.applied ? (
                    <span className="mt-1 inline-block text-xs text-green-600">✓ 已采纳进题库</span>
                  ) : (
                    <button
                      onClick={() => applySuggestion(i)}
                      className="mt-1 rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                    >
                      采纳建议
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-300">场次文件：data/targets/{id}/sessions/{sid}.json</p>
    </>
  );
}
