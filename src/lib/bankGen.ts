import { readAnalysis, readBank, readInputs, readLanguage, writeBank } from "./store";
import { runGenerateBank } from "./pipeline/generateBank";
import { startRun, endRun } from "./runRegistry";

/** 出一批新题追加进题库（纯追加：现有题一律不动，新题自动锁定）。signal 由外层的运行注册传入。 */
async function appendOneBatch(id: string, signal: AbortSignal): Promise<number> {
  const bank = readBank(id);
  const avoid = bank.questions
    .filter((q) => q.status !== "archived")
    .map((q) => q.question)
    .slice(0, 80);
  const fresh = await runGenerateBank(readInputs(id), readAnalysis(id), avoid, id, readLanguage(id), { signal });
  bank.questions = [...bank.questions, ...fresh.map((q) => ({ ...q, locked: true }))];
  bank.proposals = [];
  bank.revisions = [];
  bank.retires = [];
  bank.generatedAt = new Date().toISOString();
  bank.analysisVersion = readAnalysis(id)?.generatedAt;
  bank.version += 1;
  writeBank(id, bank);
  return fresh.length;
}

/**
 * 把题库补到至少 minQuestions 道题（默认 50）：一批一批出题（每批 10-15 道——
 * 单次输出过长会被截断，分批也逼着模型每批换新角度），直到达标或批次数用完。
 * 每批出完立即落盘，中途中断/停止不丢已完成的部分。
 * 运行登记在注册表（任务 generate）——题库页/拆解页据此显示「出题中」；「⏹停止」掐掉整个补题过程。
 * 拆解成功后自动调用它备题，题库页手动「题目生成」也走这里。
 */
export async function ensureBankFilled(id: string, minQuestions = 50, maxBatches = 10): Promise<number> {
  const signal = startRun(id, "generate");
  let added = 0;
  try {
    for (let i = 0; i < maxBatches; i++) {
      const have = readBank(id).questions.filter((q) => q.status !== "archived").length;
      if (have >= minQuestions) break;
      added += await appendOneBatch(id, signal);
    }
    if (added === 0) {
      // 已达标、这批没出题：仍然把对齐记录刷新到当前拆解，否则「拆解已更新」的提示永远清不掉
      const bank = readBank(id);
      bank.generatedAt = new Date().toISOString();
      bank.analysisVersion = readAnalysis(id)?.generatedAt;
      writeBank(id, bank);
    }
  } finally {
    endRun(id, "generate");
  }
  return added;
}
