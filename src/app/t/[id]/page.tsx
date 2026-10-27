"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TargetNav from "./TargetNav";
import LocalFiles from "./LocalFiles";
import RunStatus from "@/components/RunStatus";
import { useActiveRuns, type ActiveRun } from "@/components/RunWatcher";
import { useTargetId } from "@/lib/useTargetId";
import { IconArrowDown, IconArrowUp, IconPencil, IconRefresh, IconTrash } from "@/components/icons";
import type { Analysis, CapabilityMap, TargetBundle } from "@/lib/types";

type EditorData = {
  instruction: string;
  override: string | null;
  materials: { jd: string; background: string; resume: string };
  versions: { file: string; at: string }[];
};

type EditTarget = { kind: "summary" } | { kind: "risks" } | { kind: "card"; index: number };

type MaterialsData = {
  inputs: { jd: string; background: string; resume: string };
  rawFiles: { name: string; relPath: string }[];
  sources?: Partial<Record<string, string[]>> | null;
};

const MATCH_BADGE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-rose-100 text-rose-700",
};
const MATCH_LABEL: Record<string, string> = { high: "高匹配", medium: "中匹配", low: "低匹配" };

const iconBtnCls = "rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700";

export default function TargetPage() {
  const id = useTargetId();
  const { runs: allRuns } = useActiveRuns();
  // 本目标在跑的任务（全局状态，切页面不丢）；analyzeRun 为空但 busy 为真 = 自己刚点的那一下
  const analyzeRun = allRuns.find((r) => r.targetId === id && r.task === "analyze");
  const bankRun = allRuns.find((r) => r.targetId === id && r.task === "generate");
  const [bundle, setBundle] = useState<TargetBundle | null>(null);
  const [editor, setEditor] = useState<EditorData | null>(null);
  const [mats, setMats] = useState<MaterialsData | null>(null);
  const [matDraft, setMatDraft] = useState({ jd: "", background: "", resume: "" });
  const [draft, setDraft] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [risksDraft, setRisksDraft] = useState("");
  const [cardDraft, setCardDraft] = useState({
    responsibility: "",
    jdEvidence: "",
    capabilities: "",
    matchLevel: "",
    matchEvidence: "",
    checkpoints: "",
    sampleQuestions: "",
  });
  // 单卡提示词面板：同一时间只开一张卡
  const [cardPrompt, setCardPrompt] = useState<{
    index: number;
    instruction: string;
    override: string | null;
    draft: string;
    rendered: string;
    open: boolean;
  } | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runStartRef = useRef<string | null>(null);
  const cardAbortRef = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matLoaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [b, e, m] = await Promise.all([
        fetch(`/api/targets/${id}`).then((r) => r.json()),
        fetch(`/api/targets/${id}/analyze`).then((r) => r.json()),
        fetch(`/api/targets/${id}/inputs`).then((r) => r.json()),
      ]);
      setBundle(b);
      setEditor(e);
      setDraft(e.override ?? e.instruction);
      setMats(m);
      setMatDraft({ jd: m.inputs.jd, background: m.inputs.background, resume: m.inputs.resume });
      matLoaded.current = true;
      if (!b.analysis) setEditorOpen(true);
    } catch {
      setError("加载失败");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 拆解运行已与页面解耦（服务端注册表 + 全站常驻运行条）：
  // 本目标的拆解任务从「在跑」变「不在」时刷新数据——不管期间切过多少次页面
  const prevRunRef = useRef<ActiveRun | null>(null);
  useEffect(() => {
    const prev = prevRunRef.current;
    prevRunRef.current = analyzeRun ?? null;
    if (prev && !analyzeRun) {
      load();
      setBusy(false);
    }
  }, [analyzeRun, load]);

  // 材料自动保存（1 秒防抖；只在三个文本都加载完之后）
  useEffect(() => {
    if (!matLoaded.current || !mats) return;
    if (
      matDraft.jd === mats.inputs.jd &&
      matDraft.background === mats.inputs.background &&
      matDraft.resume === mats.inputs.resume
    )
      return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/targets/${id}/inputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matDraft),
      });
      if (res.ok) {
        const data = await res.json();
        setMats((prev) => (prev ? { ...prev, inputs: { ...matDraft } } : prev));
        setSavedNote("材料已保存");
        setTimeout(() => setSavedNote(""), 1800);
        void data;
      }
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [matDraft, mats, id]);

  async function openRaw(relPath: string) {
    await fetch(`/api/targets/${id}/files/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relPath, mode: "open" }),
    });
  }

  async function analyze(instruction?: string) {
    setBusy(true);
    runStartRef.current = new Date().toISOString();
    setError("");
    setRaw("");
    setSavedNote("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/targets/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instruction === undefined ? {} : { instruction }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "拆解失败");
      setBundle((prev) => (prev ? { ...prev, analysis: data.analysis } : prev));
      setEditor((prev) => (prev ? { ...prev, versions: data.versions ?? prev.versions } : prev));
      setEditorOpen(false);
      setEdit(null);
      fetch(`/api/targets/${id}/analyze`)
        .then((r) => r.json())
        .then((e) => {
          setEditor((prev) => (prev ? e : prev));
          setDraft(e.override ?? e.instruction);
        });
    } catch (e) {
      // 中止/已停止 = 用户主动停止，静默处理，不再弹黄色提示条
      if (!(e instanceof Error && (e.name === "AbortError" || e.message === "已停止"))) {
        setError(e instanceof Error ? e.message : "拆解失败");
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }

  /** ⏹ 停止：本地掐掉请求 + 通知服务端掐掉运行（服务端运行已与请求解耦，只掐本地不够） */
  async function stopAnalyze() {
    abortRef.current?.abort();
    abortRef.current = null;
    await fetch(`/api/targets/${id}/runs/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "analyze" }),
    }).catch(() => {});
  }

  async function saveAnalysis(next: Analysis, section: string) {
    const body = {
      analysis: {
        ...next,
        source: "user-edited",
        editedSections: { ...(next.editedSections ?? {}), [section]: new Date().toISOString() },
      },
    };
    const res = await fetch(`/api/targets/${id}/analyze`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "保存失败");
      return;
    }
    setBundle((prev) => (prev ? { ...prev, analysis: data.analysis } : prev));
    setSavedNote(`已保存（${section}）`);
    setTimeout(() => setSavedNote(""), 2000);
  }

  async function restoreVersion(file: string) {
    if (!confirm("回滚到该版本？当前版本会先自动存入历史。")) return;
    const res = await fetch(`/api/targets/${id}/analyze`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, restore: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "回滚失败");
      return;
    }
    setBundle((prev) => (prev ? { ...prev, analysis: data.current } : prev));
    fetch(`/api/targets/${id}/analyze`)
      .then((r) => r.json())
      .then((e) => {
        setEditor((prev) => (prev ? e : prev));
        setDraft(e.override ?? e.instruction);
      });
  }

  async function resetPrompt() {
    await fetch(`/api/targets/${id}/analyze`, { method: "DELETE" });
    if (editor) {
      setEditor({ ...editor, override: null });
      setDraft(editor.instruction);
    }
  }

  // ---- 单卡提示词 / 重生成 ----
  async function openCardPrompt(index: number) {
    const res = await fetch(`/api/targets/${id}/analyze/card`);
    const data = await res.json();
    setCardPrompt({ index, instruction: data.instruction, override: data.override, draft: data.override ?? data.instruction, rendered: "", open: true });
  }

  async function previewCardPrompt() {
    if (!cardPrompt) return;
    const res = await fetch(`/api/targets/${id}/analyze/card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: cardPrompt.index, instruction: cardPrompt.draft, preview: true }),
    });
    const data = await res.json();
    if (res.ok) setCardPrompt({ ...cardPrompt, rendered: data.rendered ?? "" });
    else setError(data.error ?? "预览失败");
  }

  async function regenCard() {
    if (!cardPrompt || !a) return;
    setCardBusy(true);
    setError("");
    setRaw("");
    const ctrl = new AbortController();
    cardAbortRef.current = ctrl;
    try {
      const res = await fetch(`/api/targets/${id}/analyze/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: cardPrompt.index, instruction: cardPrompt.draft }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "重生成失败");
      setBundle((prev) => (prev ? { ...prev, analysis: data.analysis } : prev));
      setCardPrompt((prev) => (prev ? { ...prev, open: false, rendered: "" } : prev));
      fetch(`/api/targets/${id}/analyze/card`)
        .then((r) => r.json())
        .then((d) => setCardPrompt((prev) => (prev ? { ...prev, override: d.override, draft: d.override ?? d.instruction } : prev)));
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "重生成失败");
      }
    } finally {
      if (cardAbortRef.current === ctrl) cardAbortRef.current = null;
      setCardBusy(false);
    }
  }

  function startEdit(t: EditTarget) {
    if (!a) return;
    if (t.kind === "summary") setSummaryDraft(a.roleSummary);
    if (t.kind === "risks") setRisksDraft(a.riskNotes.join("\n"));
    if (t.kind === "card") {
      const m = a.mapping[t.index];
      setCardDraft({
        responsibility: m.responsibility,
        jdEvidence: m.jdEvidence ?? "",
        capabilities: m.capabilities.join("\n"),
        matchLevel: m.matchLevel ?? "",
        matchEvidence: m.matchEvidence ?? "",
        checkpoints: m.checkpoints.join("\n"),
        sampleQuestions: (m.sampleQuestions ?? []).join("\n"),
      });
    }
    setEdit(t);
  }

  function cardFromDraft(): CapabilityMap {
    return {
      responsibility: cardDraft.responsibility.trim(),
      jdEvidence: cardDraft.jdEvidence.trim() || undefined,
      capabilities: cardDraft.capabilities.split("\n").map((s) => s.trim()).filter(Boolean),
      matchLevel: (["high", "medium", "low"] as const).includes(cardDraft.matchLevel as "high" | "medium" | "low")
        ? (cardDraft.matchLevel as "high" | "medium" | "low")
        : undefined,
      matchEvidence: cardDraft.matchEvidence.trim() || undefined,
      checkpoints: cardDraft.checkpoints.split("\n").map((s) => s.trim()).filter(Boolean),
      sampleQuestions: cardDraft.sampleQuestions.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  }

  if (!bundle || !editor || !mats) return <p className="text-sm text-gray-500">{error || "加载中…"}</p>;
  const a = bundle.analysis;
  const title = bundle.meta.title || bundle.meta.name;
  const hasSources = Object.values(mats.sources ?? {}).some((arr) => arr?.length);

  return (
    <div className="space-y-4">
      <TargetNav
        id={id}
        title={title}
        onTitleChange={(t) => setBundle((prev) => (prev ? { ...prev, meta: { ...prev.meta, title: t } } : prev))}
      />

      {/* ===== 材料（可折叠；改动自动保存；原始文件点开） ===== */}
      <details className="rounded-lg border bg-white p-4" open={!a}>
        <summary className="cursor-pointer text-sm font-medium text-gray-600">
          材料（JD / 简历 / 其他）{savedNote && <span className="ml-2 text-xs text-green-600">{savedNote}</span>}
        </summary>
        <div className="mt-3 space-y-3">
          {mats.rawFiles.length > 0 && !hasSources && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">原始文件：</span>
              {mats.rawFiles.map((f) => (
                <button
                  key={f.relPath}
                  onClick={() => openRaw(f.relPath)}
                  className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                  title={`打开 ${f.relPath}`}
                >
                  📄 {f.name}
                </button>
              ))}
            </div>
          )}
          {(
            [
              ["jd", "岗位 JD"],
              ["resume", "简历"],
              ["background", "其他 / 行业背景"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block space-y-1">
              <span className="text-xs font-medium text-gray-500">
                {label}
                {(mats.sources?.[k]?.length ?? 0) > 0 && (
                  <span className="ml-2 font-normal text-gray-400">
                    来源：
                    {mats.sources?.[k]?.map((name, i) => (
                      <span key={name}>
                        {i > 0 && "、"}
                        <button
                          className="underline decoration-dotted hover:text-gray-600"
                          onClick={() => openRaw(`inputs/raw/${name}`)}
                          title={`打开 ${name}`}
                        >
                          {name}
                        </button>
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <textarea
                className="h-32 w-full rounded-md border px-3 py-2 text-sm"
                value={matDraft[k]}
                onChange={(e) => setMatDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            </label>
          ))}
          <p className="text-xs text-gray-400">改完自动保存。拆解、出题、评分都会用这里的最新内容。</p>
        </div>
      </details>

      {/* ===== 整体拆解提示词编辑器 ===== */}
      {editorOpen && (
        <div className="space-y-2 rounded-lg border bg-white p-4">
          <h2 className="text-sm font-medium">
            拆解提示词 {editor.override ? "（当前使用你保存的改写版）" : "（默认模板，可改）"}
          </h2>
          <textarea
            className="h-72 w-full rounded-md border bg-gray-50 px-3 py-2 font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {a && <p className="text-xs text-amber-600">重新拆解会覆盖当前结果（当前版自动存入历史，可回滚）。</p>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => analyze(draft)}
              disabled={busy}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {busy ? "拆解中…（调用模型，约 30-90 秒）" : "确认生成"}
            </button>
            {busy && (
              <button
                onClick={stopAnalyze}
                className="shrink-0 rounded-md border px-3 py-1 text-xs hover:bg-gray-100"
              >
                ⏹ 停止
              </button>
            )}
            {editor.override && (
              <button onClick={resetPrompt} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100">
                恢复默认模板
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== 拆解结果 ===== */}
      {a ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setEditorOpen((v) => !v)}
              className={iconBtnCls}
              title="提示词 / DIY：查看和改写发给模型的提示词模板，改完点「确认生成」按新模板重拆"
              aria-label="提示词 / DIY"
            >
              <IconRefresh />
            </button>
            <p className="text-sm text-gray-500">
              {a.source === "user-edited" ? "编辑于" : "拆解于"} {new Date(a.generatedAt).toLocaleString("zh-CN")}
              {a.source === "seed" && "（内置种子，可重新生成）"}
              {savedNote && !savedNote.startsWith("材料") && <span className="ml-2 text-green-600">{savedNote}</span>}
            </p>
          </div>

          {/* 岗位画像 */}
          <div className="rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-500">岗位画像</h2>
              {edit?.kind === "summary" ? (
                <div className="flex gap-2 text-xs">
                  <button
                    className="rounded bg-gray-900 px-3 py-1 text-white"
                    onClick={() => {
                      saveAnalysis({ ...a, roleSummary: summaryDraft }, "roleSummary");
                      setEdit(null);
                    }}
                  >
                    保存
                  </button>
                  <button className="underline" onClick={() => setEdit(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <button className={iconBtnCls} onClick={() => startEdit({ kind: "summary" })} title="编辑" aria-label="编辑">
                  <IconPencil />
                </button>
              )}
            </div>
            {edit?.kind === "summary" ? (
              <textarea
                className="mt-2 h-28 w-full rounded-md border px-3 py-2 text-sm"
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
              />
            ) : (
              <p className="mt-1">{a.roleSummary}</p>
            )}
          </div>

          {/* 拆解卡：一行一卡 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-500">岗位拆解（职责 → 能力 → 考察点）</h2>
              <button
                className="text-xs text-gray-500 underline"
                onClick={() => {
                  setBundle((prev) =>
                    prev && prev.analysis
                      ? { ...prev, analysis: { ...prev.analysis, mapping: [...prev.analysis.mapping, { responsibility: "", capabilities: [], checkpoints: [] }] } }
                      : prev,
                  );
                  setCardDraft({
                    responsibility: "",
                    jdEvidence: "",
                    capabilities: "",
                    matchLevel: "",
                    matchEvidence: "",
                    checkpoints: "",
                    sampleQuestions: "",
                  });
                  setEdit({ kind: "card", index: a.mapping.length });
                }}
              >
                + 新增卡片
              </button>
            </div>
            {a.mapping.map((m, i) =>
              edit?.kind === "card" && edit.index === i ? (
                /* ---- 编辑态 ---- */
                <div key={i} className="space-y-2 rounded-lg border-2 border-gray-900 bg-white p-4">
                  <input
                    className="w-full rounded-md border px-3 py-1.5 text-sm font-medium"
                    value={cardDraft.responsibility}
                    onChange={(e) => setCardDraft({ ...cardDraft, responsibility: e.target.value })}
                    placeholder="岗位描述（职责）*"
                  />
                  <input
                    className="w-full rounded-md border px-3 py-1.5 text-xs"
                    value={cardDraft.jdEvidence}
                    onChange={(e) => setCardDraft({ ...cardDraft, jdEvidence: e.target.value })}
                    placeholder="JD 原文依据（这条职责来自 JD 哪句话）"
                  />
                  <textarea
                    className="h-20 w-full rounded-md border px-3 py-1.5 text-xs"
                    value={cardDraft.capabilities}
                    onChange={(e) => setCardDraft({ ...cardDraft, capabilities: e.target.value })}
                    placeholder="需要的能力（每行一条）"
                  />
                  <div className="flex gap-2">
                    <select
                      className="rounded-md border px-2 py-1.5 text-xs"
                      value={cardDraft.matchLevel}
                      onChange={(e) => setCardDraft({ ...cardDraft, matchLevel: e.target.value })}
                    >
                      <option value="">简历匹配度（未评估）</option>
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                    <input
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs"
                      value={cardDraft.matchEvidence}
                      onChange={(e) => setCardDraft({ ...cardDraft, matchEvidence: e.target.value })}
                      placeholder="简历上匹配的地方（引用具体经历；没匹配就留空）"
                    />
                  </div>
                  <textarea
                    className="h-20 w-full rounded-md border px-3 py-1.5 text-xs"
                    value={cardDraft.checkpoints}
                    onChange={(e) => setCardDraft({ ...cardDraft, checkpoints: e.target.value })}
                    placeholder="面试考察点（每行一条）"
                  />
                  <textarea
                    className="h-20 w-full rounded-md border px-3 py-1.5 text-xs"
                    value={cardDraft.sampleQuestions}
                    onChange={(e) => setCardDraft({ ...cardDraft, sampleQuestions: e.target.value })}
                    placeholder="可能被问的问题（每行一条，可留空）"
                  />
                  <div className="flex gap-2 text-xs">
                    <button
                      className="rounded bg-gray-900 px-3 py-1 text-white"
                      onClick={() => {
                        const mapping = [...a.mapping];
                        mapping[i] = cardFromDraft();
                        saveAnalysis({ ...a, mapping }, `mapping[${i}]`);
                        setEdit(null);
                      }}
                    >
                      保存
                    </button>
                    <button
                      className="underline"
                      onClick={() => {
                        setEdit(null);
                        // 取消新增时移除刚加的空卡
                        setBundle((prev) =>
                          prev && prev.analysis && !prev.analysis.mapping[i]?.responsibility
                            ? { ...prev, analysis: { ...prev.analysis, mapping: prev.analysis.mapping.filter((_, j) => j !== i) } }
                            : prev,
                        );
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* ---- 展示态：一行一卡 ---- */
                <div key={i} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium">
                      <span className="mr-2 text-gray-300">{String(i + 1).padStart(2, "0")}</span>
                      {m.responsibility || "（未命名）"}
                    </h3>
                    <div className="flex shrink-0 items-center gap-1 text-gray-400">
                      <button
                        className={iconBtnCls}
                        onClick={() => openCardPrompt(i)}
                        title="提示词 / 重生成"
                        aria-label="提示词 / 重生成"
                      >
                        <IconRefresh />
                      </button>
                      <button
                        className={iconBtnCls}
                        onClick={() => startEdit({ kind: "card", index: i })}
                        title="编辑"
                        aria-label="编辑"
                      >
                        <IconPencil />
                      </button>
                      {i > 0 && (
                        <button
                          className={iconBtnCls}
                          title="上移"
                          aria-label="上移"
                          onClick={() => {
                            const mapping = [...a.mapping];
                            [mapping[i - 1], mapping[i]] = [mapping[i], mapping[i - 1]];
                            saveAnalysis({ ...a, mapping }, "mapping-reorder");
                          }}
                        >
                          <IconArrowUp />
                        </button>
                      )}
                      {i < a.mapping.length - 1 && (
                        <button
                          className={iconBtnCls}
                          title="下移"
                          aria-label="下移"
                          onClick={() => {
                            const mapping = [...a.mapping];
                            [mapping[i + 1], mapping[i]] = [mapping[i], mapping[i + 1]];
                            saveAnalysis({ ...a, mapping }, "mapping-reorder");
                          }}
                        >
                          <IconArrowDown />
                        </button>
                      )}
                      <button
                        className="rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-600"
                        title="删除"
                        aria-label="删除"
                        onClick={() => {
                          if (!confirm("删除这张拆解卡？")) return;
                          saveAnalysis({ ...a, mapping: a.mapping.filter((_, j) => j !== i) }, "mapping-delete");
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid items-start gap-2.5 md:grid-cols-2">
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-400">需要的能力</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                        {m.capabilities.map((c, j) => (
                          <li key={j}>{c}</li>
                        ))}
                        {!m.capabilities.length && <li className="list-none text-gray-300">（无）</li>}
                      </ul>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-400">面试考察点</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                        {m.checkpoints.map((c, j) => (
                          <li key={j}>{c}</li>
                        ))}
                        {!m.checkpoints.length && <li className="list-none text-gray-300">（无）</li>}
                      </ul>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-400">简历匹配度</p>
                      <p className="mt-1.5">
                        {m.matchLevel ? (
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${MATCH_BADGE[m.matchLevel]}`}>
                            {MATCH_LABEL[m.matchLevel]}
                          </span>
                        ) : (
                          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-400">未评估</span>
                        )}
                      </p>
                      {m.jdEvidence && (
                        <p className="mt-1.5 rounded bg-white px-2 py-1 text-xs italic text-gray-500">JD 原文：{m.jdEvidence}</p>
                      )}
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                        {(m.matchEvidence ?? "")
                          .split(/；|;|\n/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((r, j) => (
                            <li key={j}>{r}</li>
                          ))}
                        {!(m.matchEvidence ?? "").trim() && <li className="list-none text-gray-300">（无）</li>}
                      </ul>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-400">可能被问的问题</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                        {(m.sampleQuestions ?? []).map((c, j) => (
                          <li key={j}>{c}</li>
                        ))}
                        {!(m.sampleQuestions ?? []).length && <li className="list-none text-gray-300">（无）</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>

          {/* 红线 */}
          {a.riskNotes.length > 0 || edit?.kind === "risks" ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-red-700">红线 / 风险（出题与练习时遵守）</h2>
                {edit?.kind === "risks" ? (
                  <div className="flex gap-2 text-xs">
                    <button
                      className="rounded bg-red-700 px-3 py-1 text-white"
                      onClick={() => {
                        saveAnalysis({ ...a, riskNotes: risksDraft.split("\n").map((s) => s.trim()).filter(Boolean) }, "riskNotes");
                        setEdit(null);
                      }}
                    >
                      保存
                    </button>
                    <button className="underline" onClick={() => setEdit(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600"
                    onClick={() => startEdit({ kind: "risks" })}
                    title="编辑"
                    aria-label="编辑"
                  >
                    <IconPencil />
                  </button>
                )}
              </div>
              {edit?.kind === "risks" ? (
                <textarea
                  className="mt-2 h-28 w-full rounded-md border px-3 py-2 text-sm"
                  value={risksDraft}
                  onChange={(e) => setRisksDraft(e.target.value)}
                  placeholder="每行一条红线"
                />
              ) : (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
                  {a.riskNotes.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        !editorOpen && (
          <div className="rounded-lg border bg-white p-8 text-center">
            <p className="text-sm text-gray-500">材料就绪，还没有拆解结果。</p>
            <button
              onClick={() => analyze()}
              disabled={busy}
              className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {busy ? "拆解中…" : "生成拆解"}
            </button>
          </div>
        )
      )}

      {/* 单卡提示词面板（共享模板 + 渲染预览） */}
      {cardPrompt && a && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-6" onClick={() => !cardBusy && setCardPrompt(null)}>
          <div className="w-full max-w-3xl space-y-3 rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                单卡提示词 · {a.mapping[cardPrompt.index]?.responsibility || `第 ${cardPrompt.index + 1} 卡`}
              </h3>
              <button
                className="shrink-0 rounded px-2 py-1 text-gray-400 hover:bg-gray-100"
                onClick={() => !cardBusy && setCardPrompt(null)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400">
              模板是这张卡与所有卡共享的（改动影响每次重新生成）；渲染预览展示的是当前这张卡的实际注入内容。
            </p>
            <textarea
              className="h-64 w-full rounded-md border bg-gray-50 px-3 py-2 font-mono text-xs"
              value={cardPrompt.draft}
              onChange={(e) => setCardPrompt({ ...cardPrompt, draft: e.target.value })}
            />
            {cardPrompt.rendered && (
              <div>
                <p className="text-xs font-medium text-gray-500">渲染预览（发给模型的完整提示词）</p>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-600">
                  {cardPrompt.rendered}
                </pre>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={previewCardPrompt} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-100">
                预览渲染结果
              </button>
              <button
                onClick={regenCard}
                disabled={cardBusy}
                className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {cardBusy ? "重新生成本卡…" : "重新生成本卡"}
              </button>
              {cardPrompt.override && (
                <button
                  onClick={() => setCardPrompt({ ...cardPrompt, draft: cardPrompt.instruction })}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-100"
                >
                  换回默认模板内容
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">重生成只替换这张卡，其余卡不动；当前内容自动存入版本历史。</p>
          </div>
        </div>
      )}

      {cardBusy && (
        <RunStatus
          estimate="30-90 秒"
          onStop={() => {
            cardAbortRef.current?.abort();
            cardAbortRef.current = null;
          }}
        />
      )}

      {(busy || analyzeRun) && (
        <RunStatus
          startedAt={analyzeRun?.startedAt ?? runStartRef.current ?? undefined}
          estimate="1-2 分钟"
          onStop={stopAnalyze}
        />
      )}

      {!busy && !analyzeRun && bankRun && (
        <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500">
          正在后台补充题库…（可随时离开，题库页会显示进度）
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">{error}</p>
          {raw && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{raw}</pre>}
        </div>
      )}

      {editor.versions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white px-4 py-2 text-xs text-gray-500">
          <span className="font-medium">版本历史（{editor.versions.length}）：</span>
          {editor.versions.slice(0, 8).map((v, i) => (
            <span key={v.file} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-300">·</span>}
              <span>{new Date(v.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <button
                className="underline hover:text-gray-900 disabled:opacity-40"
                onClick={() => restoreVersion(v.file)}
                disabled={busy}
              >
                撤回
              </button>
            </span>
          ))}
          {editor.versions.length > 8 && <span className="text-gray-400">…更早的在 data/targets/{id}/analysis/versions/</span>}
        </div>
      )}

      <LocalFiles id={id} />
    </div>
  );
}
