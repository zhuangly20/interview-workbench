"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import LanguageField from "./LanguageField";
import { guessLanguage } from "@/lib/lang";
import { IconTrash } from "@/components/icons";
import type { InputRole, TargetLanguage } from "@/lib/types";

interface StagedFile {
  name: string;
  role: InputRole;
  chars: number;
  text: string;
}

const JUNK = /(^|\/)(Thumbs\.db|\.DS_Store|desktop\.ini)$/i;
const SUPPORTED = /\.(pdf|docx|txt|md|markdown)$/i;

const SECTIONS: {
  role: InputRole;
  title: string;
  hint?: string;
  placeholder: string;
}[] = [
  {
    role: "jd",
    title: "岗位 JD",
    placeholder: "粘贴完整的岗位描述……",
  },
  {
    role: "resume",
    title: "简历",
    hint: "拆解的匹配度评估和参考答案都基于这里的内容",
    placeholder: "纯文本简历……",
  },
  {
    role: "background",
    title: "其他 / 行业背景",
    placeholder: "可留空",
  },
];

/** 从拖拽事件里递归收集文件（支持整个文件夹），必须在事件回调内同步拿到 entry */
async function collectFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  const out: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
      if (file) out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const kid of batch) await walk(kid);
      }
    }
  }
  await Promise.all(entries.map((e) => walk(e)));
  return out;
}

/** 新建目标：JD / 简历 / 其他 三栏，每栏可拖文件也可粘贴文本；岗位名不手填（创建后 AI 提取 + 可手改）。 */
export default function NewTargetPage() {
  const router = useRouter();
  const [text, setText] = useState<Record<InputRole, string>>({ jd: "", background: "", resume: "" });
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [stagingId, setStagingId] = useState("");
  const [dragOver, setDragOver] = useState<InputRole | null>(null);
  const [langChoice, setLangChoice] = useState<TargetLanguage | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputsRef = useRef<Record<InputRole, HTMLInputElement | null>>({ jd: null, background: null, resume: null });

  const jdBody = [text.jd, ...staged.filter((f) => f.role === "jd").map((f) => f.text)].join("\n");
  const lang = langChoice ?? guessLanguage(jdBody);

  async function upload(list: File[], role: InputRole) {
    const picked = list.filter(
      (f) => !JUNK.test((f as File & { relativePath?: string }).relativePath ?? f.name) && SUPPORTED.test(f.name),
    );
    if (!picked.length) {
      setError("没有可解析的文件（支持 PDF / docx / txt / md）");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of picked) {
        const rel = (f as File & { relativePath?: string }).relativePath ?? f.name;
        fd.append("files", f, rel);
        fd.append("roles", JSON.stringify({ [f.name]: role })); // 逐个文件指定板块
      }
      if (stagingId) fd.append("stagingId", stagingId);
      const res = await fetch("/api/targets/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解析失败");
      setStagingId(data.stagingId);
      setStaged((prev) => [...prev, ...(data.files as StagedFile[])]);
      if (data.errors?.length) setError(data.errors.join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const hasJd = text.jd.trim() || staged.some((f) => f.role === "jd" && f.text.trim());
    if (!hasJd) {
      setError("JD 不能为空：请在 JD 栏粘贴文字或拖入文件");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = stagingId
        ? await fetch("/api/targets/import/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stagingId,
              files: staged.map((f) => ({ name: f.name, role: f.role })),
              texts: text,
              language: lang,
            }),
          })
        : await fetch("/api/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...text, language: lang }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      router.push(`/t/${data.meta.id}`); // 只创建不自动拆解，拆解在目标页手动触发
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">新建练习目标</h1>

      {SECTIONS.map((s) => {
        const files = staged.filter((f) => f.role === s.role);
        return (
          <section key={s.role} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-gray-700">
                {s.title}
                {s.role === "jd" && <span className="ml-1 text-red-500">*</span>}
              </h2>
              {s.hint && <span className="text-xs text-gray-400">{s.hint}</span>}
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s.role);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(null);
                await upload(await collectFiles(e.dataTransfer), s.role);
              }}
              onClick={() => inputsRef.current[s.role]?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs transition-colors ${
                dragOver === s.role ? "border-gray-900 bg-gray-50" : "border-gray-300 hover:border-gray-400"
              }`}
            >
              {uploading ? "正在解析…" : "拖文件到这里（支持多个 / 整个文件夹），或点击选择 · PDF / Word / txt / md"}
              <input
                ref={(el) => {
                  inputsRef.current[s.role] = el;
                }}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown"
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) await upload(Array.from(e.target.files), s.role);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1 text-xs">
                    <span className="truncate" title={f.name}>
                      📄 {f.name}
                    </span>
                    <span className="shrink-0 text-gray-400">{f.chars} 字符</span>
                    <button
                      className="ml-auto shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setStaged((prev) => prev.filter((x) => x.name !== f.name))}
                      title="移除"
                      aria-label="移除"
                    >
                      <IconTrash />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              className="h-28 w-full rounded-md border px-3 py-2 text-sm"
              value={text[s.role]}
              onChange={(e) => setText((t) => ({ ...t, [s.role]: e.target.value }))}
              placeholder={s.placeholder}
            />
          </section>
        );
      })}

      <LanguageField value={lang} onChange={setLangChoice} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || uploading}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? "创建中…" : "创建目标"}
      </button>
    </div>
  );
}
