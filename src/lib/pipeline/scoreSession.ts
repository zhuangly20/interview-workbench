import type { Bank, PracticeSession, QuestionSection, Scorecard, Suggestion, TargetLanguage } from "../types";
import { langLabel } from "../lang";
import { archivePrompt } from "../promptArchive";
import { renderPrompt } from "../promptLoader";
import { asNumber, asObject, asString, asStringArray, brainJson } from "./json";

const SCHEMA_HINT = `{"overall":0-5,"dimensions":{"content":{"score":0-5,"comment":""},"structure":{},"language":{},"timing":{},"adaptability":{}},"perQuestion":[{"questionId":"原样返回的题目ID","score":0-5,"comment":"","missed":["漏掉的得分点"]}],"strengths":["亮点"],"suggestions":[{"questionId":"题目ID或null","text":"对参考答案或笔记的具体修改建议"}],"summary":"总体点评"}`;

/** 第四步：反馈 —— 逐字稿 + 评分要点 → 四维评分 + 建议（建议以提案形式呈现）。
 * 评分依据优先用本场题目快照自带的 rubric/参考答案（试卷题评分不依赖题库匹配），老场次快照缺字段时回退题库。 */
export async function runScoreSession(
  session: PracticeSession,
  bank: Bank,
  lang: TargetLanguage = "en",
  opts?: { signal?: AbortSignal; riskNotes?: string[]; override?: string },
): Promise<Scorecard> {
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const blocks = session.questions.map((snapshot, i) => {
    const turn = session.turns.find((t) => t.questionId === snapshot.id);
    const q = byId.get(snapshot.id);
    const answered = turn && (turn.answer.trim() || turn.followUpQA.length);
    const dur = turn?.durationSec ? `（用时约 ${Math.round(turn.durationSec)} 秒）` : "";
    return [
      `QID: ${snapshot.id}`,
      `问题：${snapshot.question}`,
      `参考答案：${(snapshot.referenceAnswer ?? q?.answer) || "（无）"}`,
      `评分要点：${(snapshot.rubric ?? q?.rubric) || "（无）"}`,
      `候选人回答：${answered ? turn!.answer || "（只回答了追问）" : "（未作答）"}${dur}`,
      turn?.followUpQA.length
        ? `追问记录：${turn.followUpQA.map((f) => `问：${f.q} / 答：${f.a}`).join("；")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const prompt =
    opts?.override?.trim() ||
    renderPrompt("score-session", {
      transcript: blocks.join("\n\n"),
      questionIds: session.questions.map((q) => q.id).join(","),
      riskNotes: opts?.riskNotes?.length ? opts.riskNotes.join("；") : "（无）",
      lang: langLabel(lang),
    });
  archivePrompt(session.targetId, "score", prompt);

  const data = await brainJson<Scorecard>(
    "score",
    prompt,
    (raw) => {
      const o = asObject(raw);
      const dims = asObject(o.dimensions);
      const dim = (k: string) => {
        const d = asObject(dims[k]);
        return { score: asNumber(d.score, 0), comment: asString(d.comment) };
      };
      const perQuestion = Array.isArray(o.perQuestion)
        ? o.perQuestion.map((p) => {
            const po = asObject(p);
            return {
              questionId: asString(po.questionId),
              score: asNumber(po.score, 0),
              comment: asString(po.comment),
              missed: asStringArray(po.missed),
            };
          })
        : [];
      const suggestions: Suggestion[] = Array.isArray(o.suggestions)
        ? o.suggestions.map((s) => {
            const so = asObject(s);
            return {
              questionId: typeof so.questionId === "string" && so.questionId !== "null" ? so.questionId : null,
              text: asString(so.text),
              applied: false,
            };
          })
        : [];
      return {
        overall: asNumber(o.overall, 0),
        dimensions: {
          content: dim("content"),
          structure: dim("structure"),
          language: dim("language"),
          timing: dim("timing"),
          adaptability: dim("adaptability"),
        },
        perQuestion,
        strengths: asStringArray(o.strengths),
        suggestions,
        summary: asString(o.summary),
        generatedAt: new Date().toISOString(),
      };
    },
    SCHEMA_HINT,
    opts?.signal,
  );

  // 只保留本次 session 里真实存在的题目
  const known = new Set(session.questions.map((q) => q.id));
  data.perQuestion = data.perQuestion.filter((p) => known.has(p.questionId));
  data.suggestions = data.suggestions.filter((s) => !s.questionId || known.has(s.questionId));

  // 板块热力图：逐题分按板块聚合（优先快照板块；老场次题目不在题库且无板块的跳过）
  const secMap = new Map<string, { sum: number; count: number }>();
  for (const p of data.perQuestion) {
    const snap = session.questions.find((q) => q.id === p.questionId);
    const sec = snap?.section ?? byId.get(p.questionId)?.section;
    if (!sec) continue;
    const cur = secMap.get(sec) ?? { sum: 0, count: 0 };
    cur.sum += p.score;
    cur.count += 1;
    secMap.set(sec, cur);
  }
  data.sections = [...secMap.entries()].map(([section, { sum, count }]) => ({
    section: section as QuestionSection,
    avg: Math.round((sum / count) * 10) / 10,
    count,
  }));
  return data;
}
