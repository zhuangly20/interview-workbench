"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TargetNav from "../TargetNav";
import RunStatus from "@/components/RunStatus";
import { useActiveRuns, type ActiveRun } from "@/components/RunWatcher";
import SessionReviewModal from "../SessionReviewModal";
import TeachLayer from "./TeachLayer";
import { IconArrowDown, IconArrowUp, IconDownload, IconTrash, IconUser } from "@/components/icons";
import { QUESTION_SECTIONS, SECTION_COLORS, sectionLabel } from "@/lib/sections";
import { useTargetId } from "@/lib/useTargetId";
import type { SessionSummary } from "@/lib/types";
import type { Bank, BankQuestion, QuestionSection, TargetBundle } from "@/lib/types";

export default function BankPage() {
  const id = useTargetId();
  const { runs: allRuns } = useActiveRuns();
  // 本目标在跑的任务（全局状态，切页面不丢）
  const serverGenerate = allRuns.find((r) => r.targetId === id && r.task === "generate");
  const serverClassify = allRuns.find((r) => r.targetId === id && r.task === "classify");
  const [bundle, setBundle] = useState<TargetBundle | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [teachQid, setTeachQid] = useState<string | null>(null);
  const [reviewSid, setReviewSid] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [note, setNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  // 单题提示词面板：qid → 面板数据（同一时间只开一题）
  const [qPrompt, setQPrompt] = useState<{
    qid: string;
    instruction: string;
    override: string | null;
    draft: string;
    rendered: string;
  } | null>(null);
  const [qPromptBusy, setQPromptBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const qAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    fetch(`/api/targets/${id}`)
      .then((r) => r.json())
      .then((d: TargetBundle) => {
        setBundle(d);
        setBank(d.bank ?? { questions: [], version: 1 });
        setDirty(false);
      })
      .catch(() => setError("加载失败"));
  }, [id]);

  useEffect(load, [load]);

  const loadSessions = useCallback(() => {
    fetch(`/api/targets/${id}/sessions`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, [id]);

  useEffect(loadSessions, [loadSessions]);

  // 出题/归类已与页面解耦（服务端注册表 + 全站常驻运行条）：
  // 本目标任务从「在跑」变「不在」时刷新——不管期间切过多少次页面。
  // 自己点按钮发起的那场（prev.local）已由请求回调提示过，这里只静默刷新。
  const prevRunRef = useRef<{ run: ActiveRun; local: boolean } | null>(null);
  useEffect(() => {
    const serverRun = serverGenerate ?? serverClassify ?? null;
    const prev = prevRunRef.current;
    prevRunRef.current = serverRun ? { run: serverRun, local: busy === serverRun.task } : null;
    if (prev && !serverRun) {
      load();
      loadSessions();
      if (!prev.local) {
        setNote(prev.run.task === "generate" ? "出题完成，题库已刷新" : "归类完成，已刷新");
        setTimeout(() => setNote(""), 4000);
      }
    }
  }, [serverGenerate, serverClassify, busy, load, loadSessions]);

  /** ⏹ 停止指定任务：本地掐掉请求 + 通知服务端掐掉运行（服务端运行已与请求解耦，只掐本地不够） */
  async function stopRunTask(task: string) {
    abortRef.current?.abort();
    abortRef.current = null;
    if (task === "generate" || task === "classify") {
      await fetch(`/api/targets/${id}/runs/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      }).catch(() => {});
    }
    setBusy("");
  }

  function updateQuestion(qid: string, patch: Partial<BankQuestion>) {
    if (!bank) return;
    setBank({
      ...bank,
      questions: bank.questions.map((q) =>
        q.id === qid ? { ...q, ...patch, lastEdited: new Date().toISOString() } : q,
      ),
    });
    setDirty(true);
  }

  /** "+" 加题：多行 = 每行一题。题干即所得，板块可之后让 AI 归类 */
  function addFromInput() {
    if (!bank) return;
    const lines = newQuestion.split("\n").map((s) => s.trim().replace(/^[-·•]\s*/, "")).filter(Boolean);
    if (!lines.length) return;
    const now = new Date().toISOString();
    const qs: BankQuestion[] = lines.map((t) => ({
      id: `q_${Math.random().toString(36).slice(2, 12)}`,
      question: t,
      followUps: [],
      rubric: "",
      answer: "",
      notes: "",
      status: "draft",
      source: "user-written",
      locked: true,
      lastEdited: now,
    }));
    setBank({ ...bank, questions: [...bank.questions, ...qs] });
    setNewQuestion("");
    setAddOpen(false);
    setOpenId(qs[0].id);
    setDirty(true);
  }

  function removeQuestion(qid: string) {
    if (!bank) return;
    setBank({ ...bank, questions: bank.questions.filter((q) => q.id !== qid) });
    setDirty(true);
  }

  /** 上移/下移：只在未归档题之间换位（归档题不参与排序，也不被打扰） */
  function moveQuestion(qid: string, dir: -1 | 1) {
    if (!bank) return;
    const qs = [...bank.questions];
    const activeIdx = qs.map((q, i) => (q.status !== "archived" ? i : -1)).filter((i) => i >= 0);
    const pos = activeIdx.findIndex((i) => qs[i].id === qid);
    const next = pos + dir;
    if (pos < 0 || next < 0 || next >= activeIdx.length) return;
    const a = activeIdx[pos];
    const b = activeIdx[next];
    [qs[a], qs[b]] = [qs[b], qs[a]];
    setBank({ ...bank, questions: qs });
    setDirty(true);
  }

  async function save() {
    if (!bank) return;
    setBusy("save");
    const res = await fetch(`/api/targets/${id}/bank`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bank }),
    });
    if (res.ok) {
      setDirty(false);
    } else {
      setError("保存失败");
    }
    setBusy("");
  }

  /** 题目生成：纯追加——只增新题、不动现有题，新题自动锁定；已有题时先弹窗确认口径 */
  async function generate() {
    if (
      bank &&
      bank.questions.some((q) => q.status !== "archived") &&
      !window.confirm("点「确定」会根据最新材料把题库分批补到至少 50 道题（每批几分钟，中途可点停止）——只加新题、不替换现有题；对新增的题不满意的，直接点那题右侧的删除即可。")
    )
      return;
    setError("");
    setRaw("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy("generate");
    try {
      const res = await fetch(`/api/targets/${id}/bank/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "出题失败");
        setRaw(data.raw ?? "");
      } else {
        setBank(data.bank);
        setDirty(false);
        setNote(`已新增 ${data.added} 题，现有题未动`);
        setTimeout(() => setNote(""), 4000);
        loadSessions();
      }
    } catch (e) {
      // 中止/已停止 = 用户主动停止，静默处理
      if (!(e instanceof Error && (e.name === "AbortError" || e.message === "已停止"))) setError(e instanceof Error ? e.message : "出题失败");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy("");
    }
  }

  async function handleClassify() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy("classify");
    setError("");
    setRaw("");
    try {
      const res = await fetch(`/api/targets/${id}/bank/classify`, { method: "POST", signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "归类失败");
        setRaw(data.raw ?? "");
      } else {
        load();
      }
    } catch (e) {
      // 中止/已停止 = 用户主动停止，静默处理
      if (!(e instanceof Error && (e.name === "AbortError" || e.message === "已停止"))) setError(e instanceof Error ? e.message : "归类失败");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy("");
    }
  }

  // ---- 单题提示词 / 只重写这一题 ----
  async function openQPrompt(q: BankQuestion) {
    const res = await fetch(`/api/targets/${id}/bank/regen-question`);
    const data = await res.json();
    setQPrompt({ qid: q.id, instruction: data.instruction, override: data.override, draft: data.override ?? data.instruction, rendered: "" });
  }

  async function previewQPrompt() {
    if (!qPrompt || !bank) return;
    const res = await fetch(`/api/targets/${id}/bank/regen-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qid: qPrompt.qid, instruction: qPrompt.draft, preview: true }),
    });
    const data = await res.json();
    if (res.ok) setQPrompt({ ...qPrompt, rendered: data.rendered ?? "" });
    else setError(data.error ?? "预览失败");
  }

  async function regenOne() {
    if (!qPrompt || !bank) return;
    setQPromptBusy(true);
    setError("");
    setRaw("");
    const ctrl = new AbortController();
    qAbortRef.current = ctrl;
    try {
      const res = await fetch(`/api/targets/${id}/bank/regen-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qid: qPrompt.qid, instruction: qPrompt.draft }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "重写失败");
      setBank((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((x) => (x.id === data.question.id ? { ...x, ...data.question } : x)),
            }
          : prev,
      );
      setQPrompt(null);
      loadSessions();
    } catch (e) {
      // 中止 = 用户主动停止，静默处理
      if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "重写失败");
    } finally {
      if (qAbortRef.current === ctrl) qAbortRef.current = null;
      setQPromptBusy(false);
    }
  }

  if (!bundle || !bank) return <p className="text-sm text-gray-500">{error || "加载中…"}</p>;

  const activeQuestions = bank.questions.filter((q) => q.status !== "archived");
  const archivedQuestions = bank.questions.filter((q) => q.status === "archived");
  const untaggedCount = activeQuestions.filter((q) => !q.section).length;
  const title = bundle.meta.title || bundle.meta.name;
  // 材料比题库新 → 提示重新生成
  const stale =
    !!bundle.analysis && !!bank.generatedAt && !!bank.analysisVersion && bank.analysisVersion !== bundle.analysis.generatedAt;

  return (
    <div className="space-y-4">
      <TargetNav
        id={id}
        title={title}
        onTitleChange={(t) => setBundle((prev) => (prev ? { ...prev, meta: { ...prev.meta, title: t } } : prev))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={generate}
          disabled={!!busy}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          题目生成
        </button>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded p-1 text-lg leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          title="手动加题"
          aria-label="手动加题"
        >
          +
        </button>
        {note && <span className="text-xs text-green-600">{note}</span>}
        {stale && (
          <span className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">
            材料已更新：点「题目生成」补充新题，现有题不会被动
          </span>
        )}
        {dirty && (
          <button
            onClick={save}
            disabled={busy === "save"}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            {busy === "save" ? "保存中…" : "保存全部修改"}
          </button>
        )}
        <a
          href={`/api/targets/${id}/bank?export=md`}
          aria-label="导出题库Markdown"
          className="group relative rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <IconDownload />
          <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            导出题库Markdown
          </span>
        </a>
        {untaggedCount > 0 && (
          <button
            onClick={handleClassify}
            disabled={!!busy}
            className="rounded-lg border px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            title="让 AI 给没打板块标签的题归类（已归类的不会被覆盖）"
          >
            {busy === "classify" ? "归类中…" : `AI 归类板块（${untaggedCount} 题未分类）`}
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">共 {activeQuestions.length} 题</span>
      </div>

      {(busy === "generate" || serverGenerate) && (
        <RunStatus
          startedAt={serverGenerate?.startedAt}
          estimate="分批补到 50 题，每批 2-4 分钟"
          onStop={() => stopRunTask("generate")}
        />
      )}
      {(busy === "classify" || serverClassify) && (
        <RunStatus
          startedAt={serverClassify?.startedAt}
          estimate="30-60 秒"
          onStop={() => stopRunTask("classify")}
        />
      )}

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">{error}</p>
          {raw && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{raw}</pre>}
        </div>
      )}

      {/* 手动加题弹窗（「题目生成」旁的 +） */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-xl space-y-3 rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">手动加题</h3>
            <textarea
              className="h-32 w-full rounded-md border px-3 py-2 text-sm"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              autoFocus
              placeholder="输入题干；粘贴多行文本 = 每行一题。板块之后可点「AI 归类板块」自动补。"
            />
            <div className="flex gap-2">
              <button
                onClick={addFromInput}
                disabled={!newQuestion.trim()}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
              >
                添加
              </button>
              <button onClick={() => setAddOpen(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 题库列表 */}
      <div className="space-y-2">
        {activeQuestions.map((q, qi) => {
          const open = openId === q.id;
          const hist = sessions.filter((s) => s.active && s.mode === "single" && s.questionIds.includes(q.id));
          return (
            <div key={q.id} className="rounded-lg border bg-white">
              <div className="flex items-start gap-3 p-3">
                <button
                  onClick={() => setTeachQid(q.id)}
                  className="mt-0.5 shrink-0 rounded bg-blue-50 p-1 text-blue-600 hover:bg-blue-100 hover:text-blue-700"
                  title="开始 AI 陪练"
                  aria-label="开始 AI 陪练"
                >
                  <IconUser />
                </button>
                <button onClick={() => setOpenId(open ? null : q.id)} className="flex-1 text-left">
                  <p className={`text-sm ${q.question ? "" : "italic text-gray-400"}`}>{q.question || "（空题干，点开编辑）"}</p>
                  <p className="mt-0.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${SECTION_COLORS[q.section ?? "other"]}`}>
                      {sectionLabel(q.section)}
                    </span>
                  </p>
                </button>
                {qi > 0 && (
                  <button
                    onClick={() => moveQuestion(q.id, -1)}
                    className="mt-0.5 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="上移"
                    aria-label="上移"
                  >
                    <IconArrowUp />
                  </button>
                )}
                {qi < activeQuestions.length - 1 && (
                  <button
                    onClick={() => moveQuestion(q.id, 1)}
                    className="mt-0.5 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="下移"
                    aria-label="下移"
                  >
                    <IconArrowDown />
                  </button>
                )}
                <button
                  onClick={() => removeQuestion(q.id)}
                  title="删除"
                  aria-label="删除"
                  className="mt-0.5 shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  <IconTrash />
                </button>
              </div>

              {hist.length > 0 && (
                <details className="border-t px-3 py-2">
                  <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                    练过 {hist.length} 次 · 最近 {fmtDate(hist[0].startedAt)}
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {hist.map((s) => (
                      <li key={s.id} className="text-xs">
                        <button
                          className="text-blue-700 hover:underline"
                          onClick={() => {
                            setReviewSid(s.id);
                            setOpenId(null);
                          }}
                        >
                          {fmtDate(s.startedAt)} · 🎯 陪练 ·{" "}
                          {s.finishedAt ? "已结束" : "进行中"}
                          {s.overall !== undefined && ` · ${s.overall} 分`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {open && (
                <div className="space-y-3 border-t p-3">
                  <LabeledTextarea
                    label="问题（面试官会这样问）"
                    value={q.question}
                    onChange={(v) => updateQuestion(q.id, { question: v })}
                    rows={2}
                  />
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-gray-500">板块（AI 建议的归类，可改）</span>
                    <select
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={q.section ?? ""}
                      onChange={(e) => updateQuestion(q.id, { section: (e.target.value || undefined) as QuestionSection | undefined })}
                    >
                      <option value="">未分类</option>
                      {QUESTION_SECTIONS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <LabeledTextarea
                    label="追问（每行一条）"
                    value={q.followUps.join("\n")}
                    onChange={(v) => updateQuestion(q.id, { followUps: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
                    rows={2}
                  />
                  <LabeledTextarea
                    label="评分要点 rubric（建议写明维度与权重）"
                    value={q.rubric}
                    onChange={(v) => updateQuestion(q.id, { rubric: v })}
                    rows={2}
                  />
                  <LabeledTextarea
                    label="参考答案（陪练与复盘时的对照基准）"
                    value={q.answer}
                    onChange={(v) => updateQuestion(q.id, { answer: v })}
                    rows={8}
                  />
                  <LabeledTextarea
                    label="备注（记忆钩子 / 口径 / Delivery 提示）"
                    value={q.notes}
                    onChange={(v) => updateQuestion(q.id, { notes: v })}
                    rows={2}
                  />
                  <div className="border-t pt-2">
                    <button className="text-xs text-gray-500 underline" onClick={() => openQPrompt(q)}>
                      这题的提示词 / 只重写这一题
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {activeQuestions.length === 0 && (
          <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
            题库为空。点「题目生成」让 AI 出一套题，或点它旁边的 + 手动加题。
          </div>
        )}

        {archivedQuestions.length > 0 && (
          <details className="rounded-lg border bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-gray-600">
              已归档（{archivedQuestions.length}）—— 不参与练习与生成，可随时恢复
            </summary>
            <ul className="mt-2 space-y-2">
              {archivedQuestions.map((q) => (
                <li key={q.id} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="min-w-0 flex-1 truncate">{q.question || q.id}</span>
                  <button
                    onClick={() => updateQuestion(q.id, { status: "draft" })}
                    disabled={!!busy}
                    className="shrink-0 underline hover:text-gray-900 disabled:opacity-50"
                  >
                    恢复
                  </button>
                  <button
                    onClick={() => removeQuestion(q.id)}
                    className="shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-600"
                    title="彻底删除"
                    aria-label="彻底删除"
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-400">改动会与题库其他修改一起，在点「保存全部修改」后落盘。</p>
          </details>
        )}
      </div>

      {/* 单题提示词面板（共享模板 + 渲染预览 + 只重写这一题） */}
      {qPrompt && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-6" onClick={() => !qPromptBusy && setQPrompt(null)}>
          <div className="w-full max-w-3xl space-y-3 rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                单题提示词 · {bank.questions.find((x) => x.id === qPrompt.qid)?.question.slice(0, 40) ?? qPrompt.qid}
              </h3>
              <button
                className="shrink-0 rounded px-2 py-1 text-gray-400 hover:bg-gray-100"
                onClick={() => !qPromptBusy && setQPrompt(null)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400">
              模板对整套题库共享（改动影响以后每次「只重写这一题」）；渲染预览展示这题的实际注入内容。重写会更新这题的题干/追问/rubric/参考答案/板块，其余题不受影响。
            </p>
            <textarea
              className="h-64 w-full rounded-md border bg-gray-50 px-3 py-2 font-mono text-xs"
              value={qPrompt.draft}
              onChange={(e) => setQPrompt({ ...qPrompt, draft: e.target.value })}
            />
            {qPrompt.rendered && (
              <div>
                <p className="text-xs font-medium text-gray-500">渲染预览（发给模型的完整提示词）</p>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-600">
                  {qPrompt.rendered}
                </pre>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={previewQPrompt} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-100">
                预览渲染结果
              </button>
              <button
                onClick={regenOne}
                disabled={qPromptBusy}
                className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {qPromptBusy ? "重写中…" : "只重写这一题"}
              </button>
              {qPrompt.override && (
                <button
                  onClick={() => setQPrompt({ ...qPrompt, draft: qPrompt.instruction })}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-100"
                >
                  换回默认模板内容
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {qPromptBusy && (
        <RunStatus
          estimate="30-90 秒"
          onStop={() => {
            qAbortRef.current?.abort();
            qAbortRef.current = null;
          }}
        />
      )}

      {reviewSid && (
        <SessionReviewModal
          id={id}
          sid={reviewSid}
          onClose={() => {
            setReviewSid(null);
            loadSessions();
          }}
          onChanged={() => {
            fetch(`/api/targets/${id}`)
              .then((r) => r.json())
              .then((d: TargetBundle) => {
                setBundle(d);
                setBank((prev) => ({ ...(prev ?? { questions: [], version: 1 }), ...d.bank }));
              })
              .catch(() => {});
          }}
        />
      )}

      {teachQid && (
        <TeachLayer
          id={id}
          qid={teachQid}
          onClose={() => {
            setTeachQid(null);
            loadSessions();
          }}
        />
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function LabeledTextarea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <textarea
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
