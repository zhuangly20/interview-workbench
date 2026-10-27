"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TargetMeta } from "@/lib/types";

export default function HomePage() {
  const [targets, setTargets] = useState<TargetMeta[] | null>(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TargetMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/targets")
      .then((r) => r.json())
      .then((d) => setTargets(d.targets ?? []))
      .catch(() => setError("加载失败，请确认 dev 服务已启动"));
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/targets/${pendingDelete.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setTargets((prev) => prev?.filter((t) => t.id !== pendingDelete.id) ?? prev);
      setPendingDelete(null);
    } catch {
      setError("删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">练习目标</h1>
        </div>
        <Link
          href="/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + 新建目标
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {targets === null && !error && <p className="text-sm text-gray-500">加载中…</p>}

      {targets && targets.length === 0 && (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
          <p>还没有练习目标。</p>
          <p className="mt-2">
            点右上角「新建目标」——把 JD、简历、背景资料的文件<b>拖进去</b>
            （支持 PDF / Word / txt / md，整个文件夹也行），或手动粘贴。所有数据只保存在你本机 data/ 目录。
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {targets?.map((t) => (
          <div
            key={t.id}
            className="relative rounded-lg border bg-white p-4 transition hover:border-gray-400 hover:shadow-sm"
          >
            <Link href={`/t/${t.id}`} className="block pr-14">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.title || t.name}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {t.language === "zh" ? "中文面试" : "英文面试"}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                创建于 {new Date(t.createdAt).toLocaleDateString("zh-CN")}
              </div>
            </Link>
            <button
              onClick={() => setPendingDelete(t)}
              className="absolute right-3 top-3 text-xs text-gray-300 transition hover:text-red-600"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold">删除「{pendingDelete.title || pendingDelete.name}」？</h2>
            <p className="mt-2 text-xs text-gray-500">题库、练习记录和复盘会一并删除，无法恢复。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
