"use client";

import { useState } from "react";

type FileItem = { label: string; relPath: string; path: string; exists: boolean };

/** 本地文件面板：固定清单 + 用户上传的原始文件，可复制路径、可在资源管理器中打开所在位置 */
export default function LocalFiles({ id }: { id: string }) {
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [raw, setRaw] = useState<FileItem[]>([]);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  function load() {
    if (items) return;
    fetch(`/api/targets/${id}/files`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setRaw(d.rawFiles ?? []);
      })
      .catch(() => setError("加载失败"));
  }

  function copy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(text);
        setTimeout(() => setCopied(""), 1500);
      })
      .catch(() => setError("复制失败（浏览器不允许访问剪贴板）"));
  }

  async function openFolder(relPath: string) {
    setError("");
    const res = await fetch(`/api/targets/${id}/files/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relPath }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "打开失败");
    }
  }

  function row(it: FileItem) {
    return (
      <li key={it.relPath} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-56 shrink-0 truncate text-gray-500" title={it.label}>
          {it.label}
        </span>
        <code className={`min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 ${it.exists ? "text-gray-700" : "text-gray-300"}`}>
          {it.path}
        </code>
        <button onClick={() => copy(it.path)} className="shrink-0 underline hover:text-gray-900">
          {copied === it.path ? "已复制" : "复制"}
        </button>
        <button
          onClick={() => openFolder(it.relPath)}
          disabled={!it.exists}
          className="shrink-0 underline hover:text-gray-900 disabled:opacity-30"
        >
          打开所在文件夹
        </button>
      </li>
    );
  }

  return (
    <details
      className="rounded-lg border bg-white p-4 text-sm"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) load();
      }}
    >
      <summary className="cursor-pointer font-medium text-gray-600">本地文件（路径 / 复制 / 打开所在文件夹）</summary>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {!items ? (
        <p className="mt-2 text-xs text-gray-400">展开即加载…</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">{items.map(row)}</ul>
          {raw.length > 0 ? (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium text-gray-500">上传的原始文件（inputs/raw/）</p>
              <ul className="mt-2 space-y-1.5">{raw.map(row)}</ul>
            </div>
          ) : (
            <p className="mt-3 border-t pt-3 text-xs text-gray-400">
              还没有存档的原始文件。新建目标时用拖拽上传，原件会自动存到 inputs/raw/；这个目标是用粘贴文本建的，想要原件也在这里列出，可把 JD
              /简历等文件手动放进 data/targets/{id}/inputs/raw/。
            </p>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-gray-400">数据都在本地 data/ 目录，任何文件都可以直接查看、备份或手工修改。</p>
    </details>
  );
}
