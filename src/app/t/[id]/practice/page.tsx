"use client";

// 模拟面试页：选时长档 + 面试官风格 → 点开始先「出卷」（按拆解现出一套新题，缓存），再弹出全屏聊天层。
// 过去的整场模拟记录列在下方，点开即复盘弹窗（复盘页已并入弹窗）。

import { useCallback, useEffect, useState } from "react";
import TargetNav from "../TargetNav";
import SessionReviewModal from "../SessionReviewModal";
import MockLayer from "./MockLayer";
import { useTargetId } from "@/lib/useTargetId";
import type { SessionSummary, TargetBundle } from "@/lib/types";

/** T7 面试官风格预置：选中即填入可编辑文本框，开场可改，随场次保存。
 * 压力面写成行为级指令（模型有抓手才真有压迫感），不只是形容词。 */
const STYLE_PRESETS: Record<string, string> = {
  standard: "专业友善，节奏平稳：正常追问、正常点评。",
  pressure:
    "压力面（强势质询型）：不寒暄、不肯定、不铺垫。用短句连续发问，节奏快。对含糊、没有数据、没有细节的回答直接点破并要求给证据（如「这个词太虚了，给我一个具体数字」「你这段说了半天，核心结论是什么」）。可以质疑回答与简历/常识的一致性（如「这真是你独立完成的吗？」）。可以用打断式短句开场（如「打断一下——」）。点评要冷、直接指出问题。保持专业，不做人身攻击，不嘲讽。",
  warm: "温和面：语气温和、先肯定再追问，追问点到为止，给候选人思考空间。",
  encouraging: "鼓励面：多给肯定与鼓励，追问偏引导性，帮候选人建立信心。",
};

export default function PracticePage() {
  const id = useTargetId();
  const [bundle, setBundle] = useState<TargetBundle | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [minutes, setMinutes] = useState(30);
  const [styleKey, setStyleKey] = useState("standard");
  const [styleText, setStyleText] = useState(STYLE_PRESETS.standard);
  const [regenPaper, setRegenPaper] = useState(false);
  // 非空 = 模拟进行中（全屏层挂载）
  const [running, setRunning] = useState<{ minutes: number; style: string; voice: boolean } | null>(null);
  const [reviewSid, setReviewSid] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    fetch(`/api/targets/${id}/sessions`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetch(`/api/targets/${id}`).then((r) => r.json()).then(setBundle);
    loadSessions();
  }, [id, loadSessions]);

  if (!bundle) return <p className="text-sm text-gray-500">加载中…</p>;

  const title = bundle.meta.title || bundle.meta.name;
  const hasAnalysis = !!bundle.analysis;
  const bankCount = bundle.bank?.questions.filter((q) => q.status !== "archived").length ?? 0;
  const fullMocks = sessions.filter((s) => s.mode !== "single" && (s.active || s.finishedAt));

  return (
    <div className="space-y-4">
      <TargetNav
        id={id}
        title={title}
        onTitleChange={(t) => setBundle((prev) => (prev ? { ...prev, meta: { ...prev.meta, title: t } } : prev))}
      />

      {running && (
        <MockLayer
          id={id}
          minutes={running.minutes}
          styleText={running.style}
          voice={running.voice}
          regeneratePaper={regenPaper}
          onClose={() => {
            setRunning(null);
            setRegenPaper(false);
          }}
        />
      )}

      <div className="rounded-lg border bg-white p-8 text-center">
        <h2 className="font-medium">开始一场模拟面试</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
          这是一场<b>完整的模拟面试</b>：从你的题库直接抽题，AI 面试官逐题提问、追问并把控时间；结束后生成评分复盘，看清好与不好的地方。
        </p>

        <div className="mx-auto mt-4 flex max-w-xl flex-col items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">时长档</span>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-md border px-2 py-1 text-sm"
            >
              <option value={15}>15 分钟 · 约 5 题</option>
              <option value={30}>30 分钟 · 约 10 题</option>
              <option value={45}>45 分钟 · 约 15 题</option>
              <option value={60}>60 分钟 · 约 20 题</option>
              <option value={0}>不限时（约 10 题）</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">面试官风格</span>
            <select
              value={styleKey}
              onChange={(e) => {
                setStyleKey(e.target.value);
                if (e.target.value !== "custom") setStyleText(STYLE_PRESETS[e.target.value] ?? "");
              }}
              className="rounded-md border px-2 py-1 text-sm"
            >
              <option value="standard">标准</option>
              <option value="pressure">压力面</option>
              <option value="warm">温和面</option>
              <option value="encouraging">鼓励面</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <textarea
            className="h-16 w-full rounded-md border px-3 py-2 text-xs text-gray-600"
            value={styleText}
            onChange={(e) => {
              setStyleText(e.target.value);
              setStyleKey("custom");
            }}
            placeholder="面试官风格提示（本场生效，语音模式同样遵守）"
          />
        </div>

        {!hasAnalysis && bankCount === 0 ? (
          <p className="mt-3 text-sm text-red-600">题库还没有题，也没有岗位拆解——先去「拆解」页生成拆解（会自动备题），再回来开模拟。</p>
        ) : (
          <>
            {bankCount === 0 && (
              <p className="mt-3 text-xs text-gray-400">
                题库还是空的：开始时会现场出题（约 1-2 分钟）；完成拆解后平台会自动备题
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setRunning({ minutes, style: styleText, voice: true })}
                className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
              >
                🎙️ 开始语音模拟
              </button>
              <button
                onClick={() => setRunning({ minutes, style: styleText, voice: false })}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
              >
                文字模拟
              </button>
              <button
                onClick={() => setRegenPaper((v) => !v)}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  regenPaper ? "border-amber-400 bg-amber-50 text-amber-800" : "hover:bg-gray-100"
                }`}
                title="开场抽题时避开刚用过的题，换一批"
              >
                {regenPaper ? "✓ 下次开始换一批题" : "换一批题"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 模拟记录 */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">模拟记录（{fullMocks.length}）</h2>
        {fullMocks.length === 0 ? (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">还没有模拟记录。开一场试试。</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {fullMocks.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setReviewSid(s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-50"
                >
                  <span className="w-40 shrink-0 text-gray-500">
                    {new Date(s.startedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-gray-500">
                    {s.finishedAt ? "已结束" : "进行中"}
                    {s.questionIds.length > 0 && ` · ${s.questionIds.length} 题`}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {s.overall !== undefined && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">{s.overall} / 5</span>
                    )}
                    <span className="text-xs font-medium text-blue-700">{s.finishedAt ? "查看复盘 ›" : "查看记录 ›"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {reviewSid && (
        <SessionReviewModal
          id={id}
          sid={reviewSid}
          onClose={() => {
            setReviewSid(null);
            loadSessions();
          }}
        />
      )}
    </div>
  );
}
