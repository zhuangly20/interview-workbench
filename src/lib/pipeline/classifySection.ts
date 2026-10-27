import type { BankQuestion, QuestionSection, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asObject, asString, brainJson } from "./json";

const SCHEMA_HINT = `{"assignments":[{"id":"原样返回的题目ID","section":"intro|motivation|resume|role|knowledge|other"}]}`;

export interface SectionAssignment {
  id: string;
  section: QuestionSection;
}

/** 给没打板块标签的题做一次 AI 归类（不动已归类的题） */
export async function runClassifySection(
  questions: BankQuestion[],
  targetId?: string,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal },
): Promise<SectionAssignment[]> {
  const prompt = renderPrompt("classify-section", {
    lang: langLabel(lang),
    list: questions.map((q) => `- ${q.id} · ${q.question}`).join("\n"),
  });
  if (targetId) archivePrompt(targetId, "classify-section", prompt);

  const data = await brainJson<{ assignments: { id: string; section: unknown }[] }>(
    "classify-section",
    prompt,
    (raw) => {
      const arr = asObject(raw).assignments;
      if (!Array.isArray(arr)) throw new Error("缺少 assignments 数组");
      return {
        assignments: arr
          .map((a) => {
            const ao = asObject(a);
            return { id: asString(ao.id), section: ao.section };
          })
          .filter((a) => a.id && typeof a.section === "string"),
      };
    },
    SCHEMA_HINT,
    opts?.signal,
  );
  return data.assignments as SectionAssignment[];
}
