import type { Bank, QuestionSection, SessionQuestionSnap } from "../types";

/** 板块顺序 = 面试自然推进：开场 → 简历深挖 → 动机 → 岗位理解 → 知识 → 其他 */
const SECTION_ORDER: QuestionSection[] = ["intro", "resume", "motivation", "role", "knowledge", "other"];

/** 常规场的板块构成袋（约一半是简历深挖，其余动机/岗位理解/知识分摊）——循环填充凑满题数 */
const NORMAL_BAG: QuestionSection[] = [
  "resume",
  "resume",
  "resume",
  "resume",
  "resume",
  "knowledge",
  "role",
  "motivation",
  "knowledge",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 模拟面试抽题：从题库按真实面试的结构抽一套题（不调模型、秒出）。
 * 真面试官一定会对照岗位信息刨根问底——所以自我介绍保底开场、简历深挖是主体；
 * 极速场（≤20 分钟）除开场外全部压在简历匹配的核心题上。
 * 各板块内部随机抽；板块不足时按面试推进顺序就近兜底，题库太小最后随机补齐。
 * avoidIds = 尽量避开的题库 id（「换一套」时传上一场的题）；避开后不够时有多少用多少。
 */
export function drawQuestions(bank: Bank, minutes: number, avoidIds: string[]): SessionQuestionSnap[] {
  const count = minutes > 0 ? Math.max(1, Math.round(minutes / 3)) : 10;
  const active = bank.questions.filter((q) => q.status !== "archived");
  const pool = active.filter((q) => !avoidIds.includes(q.id));
  const usable = pool.length >= Math.min(count, active.length) ? pool : active;

  // 先排板块计划：自我介绍保底 1 道（题库没有就跳过）；极速场其余全给简历深挖，
  // 常规场从构成袋循环填充。抽完按 SECTION_ORDER 摆出推进感
  const express = minutes > 0 && minutes <= 20;
  const plan: QuestionSection[] = [];
  if (count >= 2 && usable.some((q) => q.section === "intro")) plan.push("intro");
  if (express) {
    while (plan.length < count) plan.push("resume");
  } else {
    const bag = shuffle(NORMAL_BAG);
    for (let i = 0; plan.length < count; i++) plan.push(bag[i % bag.length]);
  }

  const picked = new Set<string>();
  const takeSection = (sec: QuestionSection) => {
    const cand = shuffle(usable.filter((q) => q.section === sec && !picked.has(q.id)))[0];
    if (cand) picked.add(cand.id);
    return cand;
  };
  // 计划板块没题时按推进顺序就近兜底，最后才随机补，保证题数足额
  const takeAny = () => {
    for (const s of SECTION_ORDER) {
      const q = takeSection(s);
      if (q) return q;
    }
    return shuffle(usable.filter((q) => !picked.has(q.id)))[0];
  };
  const snaps = plan.map((sec) => takeSection(sec) ?? takeAny());

  return snaps
    .filter((q): q is NonNullable<typeof q> => !!q)
    .sort((a, b) => SECTION_ORDER.indexOf(a.section ?? "other") - SECTION_ORDER.indexOf(b.section ?? "other"))
    .map((q) => ({
      id: q.id,
      question: q.question,
      section: q.section,
      rubric: q.rubric,
      referenceAnswer: q.answer || undefined,
      notes: q.notes,
      matchedBankQuestionId: q.id,
      matchedReason: "题库抽题",
    }));
}
