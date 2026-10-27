"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type RunTaskName = "analyze" | "generate" | "classify";

export interface ActiveRun {
  targetId: string;
  targetName: string;
  task: RunTaskName;
  startedAt: string;
}

const TASK_LABEL: Record<RunTaskName, string> = { analyze: "拆解", generate: "出题", classify: "归类" };

const RunWatcherContext = createContext<{ runs: ActiveRun[] }>({ runs: [] });

/** 全站在跑任务列表：页面里用它驱动运行中状态与真实已耗时 */
export function useActiveRuns() {
  return useContext(RunWatcherContext);
}

function fmtElapsed(startedAt: string, now: number): string {
  let s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  s %= 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * 全局运行状态：3 秒轮询 /api/runs，驱动右下角常驻运行条。
 * 组件挂在 layout，React 客户端路由切换页面不会卸载它——
 * 任务从发起到结束计时连续，切页面 / 刷新（按服务端 startedAt 重算）都不归零。
 */
export default function RunWatcherProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [toast, setToast] = useState("");
  const prevRef = useRef<Map<string, ActiveRun>>(new Map());
  // 自己在运行条上按的停止不弹「完成」提示
  const suppressedRef = useRef<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRun = useCallback((targetId: string, task: RunTaskName) => {
    suppressedRef.current.add(`${targetId}:${task}`);
    fetch(`/api/targets/${targetId}/runs/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const d = await fetch("/api/runs").then((r) => r.json());
          if (!alive) return;
          const next: ActiveRun[] = d.runs ?? [];
          const nextKeys = new Set(next.map((r) => `${r.targetId}:${r.task}`));
          for (const [k, prev] of prevRef.current) {
            if (nextKeys.has(k)) continue;
            if (suppressedRef.current.delete(k)) continue;
            setToast(`「${prev.targetName}」${TASK_LABEL[prev.task]}完成`);
          }
          prevRef.current = new Map(next.map((r) => [`${r.targetId}:${r.task}`, r]));
          setRuns(next);
        } catch {}
      }
      timer = setTimeout(poll, 3000);
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    toastTimer.current = setTimeout(() => setToast(""), 4000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  return (
    <RunWatcherContext.Provider value={{ runs }}>
      {children}
      <GlobalRunBar runs={runs} onStop={stopRun} />
      {toast && (
        <div
          className={`fixed right-4 z-50 rounded-lg bg-gray-900 px-4 py-2 text-xs text-white shadow-lg ${
            runs.length ? "bottom-16" : "bottom-4"
          }`}
        >
          ✅ {toast}
        </div>
      )}
    </RunWatcherContext.Provider>
  );
}

function GlobalRunBar({ runs, onStop }: { runs: ActiveRun[]; onStop: (t: string, k: RunTaskName) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!runs.length) return null;
  const now = Date.now();
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {runs.map((r) => (
        <div
          key={`${r.targetId}:${r.task}`}
          className="flex items-center gap-2 rounded-full bg-gray-900/90 py-1.5 pl-3.5 pr-2 text-xs text-white shadow-lg"
        >
          <Link href={`/t/${r.targetId}`} className="hover:underline">
            {r.targetName} · {TASK_LABEL[r.task]}中 ·{" "}
            <span className="font-mono">{fmtElapsed(r.startedAt, now)}</span>
          </Link>
          <button
            onClick={() => onStop(r.targetId, r.task)}
            title="停止"
            className="rounded-full px-1 text-white/50 transition hover:text-white"
          >
            ⏹
          </button>
        </div>
      ))}
    </div>
  );
}
