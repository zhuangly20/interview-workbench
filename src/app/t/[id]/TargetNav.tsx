"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TABS = [
  ["", "拆解"],
  ["bank", "题库"],
  ["practice", "模拟"],
] as const;

/** 目标页顶部：岗位名（可手改，AI 提取的也在这里改）+ 三个页签 */
export default function TargetNav({
  id,
  title,
  onTitleChange,
}: {
  id: string;
  title: string;
  onTitleChange?: (t: string) => void;
}) {
  const pathname = usePathname();
  const base = `/t/${id}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    const t = draft.trim().slice(0, 60);
    if (!t || t === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/targets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      if (res.ok) onTitleChange?.(t);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <input
              ref={inputRef}
              className="w-96 rounded-md border px-2 py-1 text-lg font-semibold"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button className="text-xs text-gray-600 underline disabled:opacity-50" onClick={save} disabled={saving}>
              保存
            </button>
            <button className="text-xs text-gray-400 underline" onClick={() => setEditing(false)}>
              取消
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{title}</h1>
            <button
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              onClick={() => setEditing(true)}
              title="改名"
              aria-label="改名"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          </>
        )}
      </div>
      <nav className="flex gap-1 rounded-lg border bg-white p-1 text-sm">
        {TABS.map(([suffix, label]) => {
          const href = suffix ? `${base}/${suffix}` : base;
          const active = suffix ? pathname.startsWith(href) : pathname === base;
          return (
            <Link
              key={suffix}
              href={href}
              className={`rounded-md px-4 py-1.5 transition ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
