import type { QuestionSection } from "./types";

export const QUESTION_SECTIONS: { key: QuestionSection; label: string }[] = [
  { key: "intro", label: "开场 / 自我介绍" },
  { key: "motivation", label: "动机与意愿" },
  { key: "resume", label: "简历深挖" },
  { key: "role", label: "岗位理解" },
  { key: "knowledge", label: "知识 / 技能" },
  { key: "other", label: "其他" },
];

/** 板块标签配色（题库页 chip 展示用） */
export const SECTION_COLORS: Record<QuestionSection, string> = {
  intro: "bg-sky-100 text-sky-700",
  motivation: "bg-violet-100 text-violet-700",
  resume: "bg-emerald-100 text-emerald-700",
  role: "bg-amber-100 text-amber-700",
  knowledge: "bg-rose-100 text-rose-700",
  other: "bg-gray-100 text-gray-600",
};

const KEYS = QUESTION_SECTIONS.map((s) => s.key);

export function sectionLabel(s: QuestionSection | undefined): string {
  return QUESTION_SECTIONS.find((x) => x.key === s)?.label ?? "未分类";
}

/** 出题/归类结果里的 section 字段宽容解析：不认识的一律落到 other */
export function toSection(v: unknown): QuestionSection {
  return typeof v === "string" && (KEYS as string[]).includes(v) ? (v as QuestionSection) : "other";
}
