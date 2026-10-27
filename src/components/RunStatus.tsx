"use client";

import { useEffect, useState } from "react";

/**
 * AI 长任务的运行状态条：已运行秒数 + 预估时长小字 + 停止按钮。
 * 停止 = 中断本次调用（后端会杀掉子进程/请求），不产生结果，也不会续跑。
 * 传 startedAt（服务端注册表的真实开始时间）时从真实起点续计，切页面/刷新不归零。
 */
export default function RunStatus({
  estimate,
  startedAt,
  onStop,
}: {
  estimate: string;
  startedAt?: string;
  onStop: () => void;
}) {
  const initSec = () =>
    startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0;
  const [sec, setSec] = useState(initSec);
  useEffect(() => {
    setSec(initSec());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500">
      <span>
        调用模型中… 已运行{" "}
        <span className="font-mono text-gray-700">
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
        </span>
        <span className="ml-2 text-xs text-gray-400">（通常 {estimate}，可先去干别的，页面会自动更新）</span>
      </span>
      <button onClick={onStop} className="shrink-0 rounded-md border px-3 py-1 text-xs hover:bg-gray-100">
        ⏹ 停止
      </button>
    </div>
  );
}
