// 新流程 e2e（mock 大脑）：
//   三分栏文件导入（暂存追加/跨批去重/确认建目标）→ 建目标（无手打名 + 后台提取岗位名 + 手改）
//   → 拆解 + 单卡预览/重生成 → 共享提示词 override → 题目生成（确认统计 + 锁定保护 + 手改警示）
//   → 单题重跑（预览/执行）→ AI 归类 → 文件面板 API → 岗位名路由
//   → 出卷（按拆解现新卷 + 缓存 + 换一套卷）→ 试卷题 turn（快照兜底走大脑）→ 时长档强制切题
//   → 整场逐字稿按题切分 → finish 评分 + 题库匹配 + 手动改选 + 采纳建议 → 教学陪练（文字 + 语音结算 + 蒸馏缓存）
//   → 题库导出 md（锁定标记）→ 场次列表 → inputs 时间戳 → 语音/大脑自检
// 用 node 发请求（不用 curl -d，避免 GBK 乱码）。运行前把 provider 切到 mock，结束后还原。node >= 20（File 全局）。
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
let failures = 0;

async function j(method, path_, body) {
  const res = await fetch(BASE + path_, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function upload(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await fetch(BASE + "/api/targets/import", { method: "POST", body: form });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 0. 备份设置并切到 mock 大脑
  const settingsBefore = (await j("GET", "/api/settings")).data.settings;
  await j("PUT", "/api/settings", { ...settingsBefore, provider: "mock" });

  let id = null;
  let id2 = null;
  try {
    // ============ 1. 三分栏导入：暂存追加 + 跨批去重 + 确认建目标 ============
    const jdText = "AI 项目专员（e2e 文件）：负责知识管理与工具落地。\n- 跨部门协作\n- 信息安全意识";
    const up1 = await upload({
      files: new File([jdText], "jd.txt", { type: "text/plain" }),
      roles: JSON.stringify({ "jd.txt": "jd" }),
    });
    const stagingId = up1.data.stagingId;
    check("导入批次1：返回 stagingId + 角色认领", /^imp_[\w]+$/.test(stagingId ?? "") && up1.data.files?.[0]?.role === "jd", JSON.stringify(up1.data).slice(0, 150));

    const up2 = await upload({
      stagingId,
      files: new File(["心理学博士（e2e 简历文件），100 小时 AI 工具教学。"], "resume.txt", { type: "text/plain" }),
      roles: JSON.stringify({ "resume.txt": "resume" }),
    });
    check("导入批次2：同暂存区追加", up2.data.stagingId === stagingId && up2.data.files?.length === 1 && up2.data.files[0].role === "resume", JSON.stringify(up2.data).slice(0, 150));

    const up3 = await upload({
      stagingId,
      files: new File(["重复文件名的第二份"], "jd.txt", { type: "text/plain" }),
      roles: JSON.stringify({ "jd.txt": "jd" }),
    });
    check("导入批次3：跨批重名自动加序号", up3.data.files?.[0]?.name === "jd-2.txt", JSON.stringify(up3.data.files?.map((f) => f.name)));

    const conf = await j("POST", "/api/targets/import/confirm", {
      stagingId,
      files: [
        { name: "jd.txt", role: "jd" },
        { name: "resume.txt", role: "resume" },
      ],
      texts: { jd: "（e2e）粘贴的一行 JD" },
      language: "zh",
    });
    id2 = conf.data.meta?.id;
    check("确认建目标（粘贴 + 文件合并，移除的文件不入档）", !!id2 && conf.data.meta?.name === "（e2e）粘贴的一行 JD", JSON.stringify(conf.data).slice(0, 150));
    const inputs2 = (await j("GET", `/api/targets/${id2}/inputs`)).data;
    check("JD 文本 = 粘贴 + 解析文件拼接", inputs2.inputs?.jd?.includes("----") && inputs2.inputs.jd.includes("知识管理"), JSON.stringify(inputs2.inputs?.jd).slice(0, 120));
    check(
      "原件归档只含确认清单里的文件",
      inputs2.rawFiles?.length === 2 && inputs2.rawFiles.some((f) => f.name === "jd.txt") && inputs2.rawFiles.some((f) => f.name === "resume.txt"),
      JSON.stringify(inputs2.rawFiles),
    );
    const confGone = await j("POST", "/api/targets/import/confirm", { stagingId, files: [{ name: "jd.txt", role: "jd" }] });
    check("确认后暂存区清除（重复确认 400）", confGone.status === 400, `got ${confGone.status}`);

    // ============ 2. 建目标：无手打名，占位名 + 后台提取岗位名 + 手改 ============
    const created = await j("POST", "/api/targets", {
      jd: "AI 项目专员（e2e 主目标）：负责 AI 工具落地、数据分析与知识管理，要求跨部门协作与信息安全意识。",
      background: "国际组织数字化转型团队。",
      resume: "心理学博士，100 小时 AI 工具教学，志愿服务 200 小时。",
      language: "zh",
    });
    id = created.data.meta?.id;
    check("创建目标（不收 name，JD 首行占位）", !!id && created.data.meta?.name?.startsWith("AI 项目专员") && created.data.meta?.language === "zh", JSON.stringify(created.data).slice(0, 150));

    let title = "";
    for (let i = 0; i < 12 && !title; i++) {
      await sleep(500);
      title = (await j("GET", `/api/targets/${id}`)).data.meta?.title ?? "";
    }
    check("创建后后台提取岗位名（mock）", title === "（Mock 岗位）AI 项目专员", `got "${title}"`);

    const manual = await j("PATCH", `/api/targets/${id}`, { title: "e2e 手改岗位名" });
    check("手改岗位名落盘", manual.data.meta?.title === "e2e 手改岗位名", JSON.stringify(manual.data).slice(0, 120));
    const reExtract = await j("POST", `/api/targets/${id}/title`);
    check("岗位名重新提取路由", reExtract.status === 200 && reExtract.data.meta?.title === "（Mock 岗位）AI 项目专员", JSON.stringify(reExtract.data).slice(0, 120));

    // ============ 3. 拆解 + 单卡预览/重生成 ============
    const ana = await j("POST", `/api/targets/${id}/analyze`, {});
    const analysis = ana.data.analysis;
    check(
      "整体拆解（mock）：画像 + 4 张卡 + 风险",
      typeof analysis?.roleSummary === "string" && analysis.mapping?.length === 4 && Array.isArray(analysis.riskNotes),
      JSON.stringify(ana.data).slice(0, 150),
    );
    const analysisVersion = analysis.generatedAt;

    // 拆解成功会自动后台补题（注册表任务 generate）——等它跑完，后面题库计数才有确定值
    for (let i = 0; i < 120; i++) {
      const runs = (await j("GET", `/api/targets/${id}/runs`)).data.runs ?? [];
      if (!runs.length) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const cardMeta = await j("GET", `/api/targets/${id}/analyze/card`);
    check("单卡提示词 GET：默认模板 + 无改写", cardMeta.status === 200 && cardMeta.data.instruction?.length > 0 && cardMeta.data.override === null, JSON.stringify(cardMeta.data).slice(0, 120));

    const cardPreview = await j("POST", `/api/targets/${id}/analyze/card`, { index: 0, preview: true });
    check(
      "单卡提示词预览含职责与材料",
      typeof cardPreview.data.rendered === "string" && cardPreview.data.rendered.includes("日常文书与协调") && cardPreview.data.rendered.includes("心理学博士"),
      JSON.stringify(cardPreview.data).slice(0, 120),
    );

    const cardRegen = await j("POST", `/api/targets/${id}/analyze/card`, { index: 0 });
    const card0 = cardRegen.data.analysis?.mapping?.[0];
    check(
      "单卡重生成：jdEvidence/matchLevel/matchEvidence/sampleQuestions",
      card0?.jdEvidence?.includes("Mock") && card0?.matchLevel === "medium" && typeof card0?.matchEvidence === "string" && card0.sampleQuestions?.length >= 1,
      JSON.stringify(card0).slice(0, 200),
    );
    check("单卡重生成后拆解版本更新", cardRegen.data.analysis?.generatedAt !== analysisVersion, JSON.stringify(cardRegen.data.analysis?.generatedAt));

    // ============ 4. 共享提示词 override（5 个 key 通用路由） ============
    let overrideOk = true;
    for (const key of ["analysis", "analysis-card", "regen-question", "score", "paper"]) {
      const g = await j("GET", `/api/targets/${id}/prompt-override?key=${key}`);
      if (g.status !== 200 || typeof g.data.instruction !== "string" || g.data.override !== null) overrideOk = false;
    }
    check("5 个提示词 key 全部可读默认", overrideOk);
    const putOv = await j("PUT", `/api/targets/${id}/prompt-override`, { key: "score", instruction: "（e2e）自定义评分指令" });
    const getOv = await j("GET", `/api/targets/${id}/prompt-override?key=score`);
    const resetOv = await j("PUT", `/api/targets/${id}/prompt-override`, { key: "score", reset: true });
    check("提示词改写/读取/恢复默认", putOv.data.override === "（e2e）自定义评分指令" && getOv.data.override === "（e2e）自定义评分指令" && resetOv.data.override === null);

    // ============ 5. 题目生成：拆解后自动分批补到 50；达标后手动生成不再追加 ============
    const gen = await j("POST", `/api/targets/${id}/bank/generate`, {});
    const bank1 = gen.data.bank;
    check(
      "拆解后已自动分批补到 50 题（全 ai-draft 自动锁定带板块），达标时手动生成不追加",
      bank1?.questions?.length === 50 &&
        gen.data.added === 0 &&
        bank1.questions.every((q) => q.locked === true && q.source === "ai-draft" && q.section && typeof q.rubric === "string"),
      JSON.stringify([bank1?.questions?.length, gen.data.added]).slice(0, 120),
    );
    check("生成记录 generatedAt + analysisVersion（对齐当前拆解）", typeof bank1?.generatedAt === "string" && bank1.analysisVersion === cardRegen.data.analysis.generatedAt, `${bank1?.analysisVersion} vs ${cardRegen.data.analysis?.generatedAt}`);

    // 手改一题题面 → 再生成：已有题一律原样保留（含手改），且达标后不追加
    const bankEdit = JSON.parse(JSON.stringify(bank1));
    bankEdit.questions[0].question += "（手改）";
    await j("PUT", `/api/targets/${id}/bank`, { bank: bankEdit });

    const gen2 = await j("POST", `/api/targets/${id}/bank/generate`, {});
    const bank2 = gen2.data.bank;
    check(
      "再生成：手改题原样保留、总量不变（已达标不再补）",
      bank2?.questions?.length === 50 &&
        gen2.data.added === 0 &&
        bank2.questions.slice(0, 10).every((q, i) => q.id === bankEdit.questions[i].id && q.question === bankEdit.questions[i].question),
      JSON.stringify([bank2?.questions?.length, gen2.data.added]).slice(0, 60),
    );

    // ============ 6. 单题重跑：预览 + 执行 ============
    const qRegen = bank2.questions[2];
    const qMeta = await j("GET", `/api/targets/${id}/bank/regen-question`);
    check("单题提示词 GET", qMeta.status === 200 && qMeta.data.instruction?.length > 0 && qMeta.data.override === null);
    const qPreview = await j("POST", `/api/targets/${id}/bank/regen-question`, { qid: qRegen.id, preview: true });
    check(
      "单题提示词预览含 QID 与题干",
      typeof qPreview.data.rendered === "string" && qPreview.data.rendered.includes(`QID: ${qRegen.id}`) && qPreview.data.rendered.includes(qRegen.question.slice(0, 10)),
      JSON.stringify(qPreview.data).slice(0, 150),
    );
    const qRun = await j("POST", `/api/targets/${id}/bank/regen-question`, { qid: qRegen.id });
    const regenQ = qRun.data.question;
    check(
      "单题重跑：题面替换、id/来源保留",
      regenQ?.question?.includes("（Mock 重写）") && regenQ.id === qRegen.id && regenQ.source === qRegen.source && typeof regenQ.lastEdited === "string",
      JSON.stringify(regenQ).slice(0, 200),
    );

    // ============ 7. AI 归类（未分类的补上，已归类保留） ============
    const bank3 = (await j("GET", `/api/targets/${id}/bank`)).data.bank;
    bank3.questions[4].section = undefined;
    bank3.questions[3].section = "role";
    await j("PUT", `/api/targets/${id}/bank`, { bank: bank3 });
    const cls = await j("POST", `/api/targets/${id}/bank/classify`);
    check("AI 归类板块（mock）只补未分类", cls.status === 200 && cls.data.assigned === 1, JSON.stringify(cls.data).slice(0, 120));
    const bank4 = (await j("GET", `/api/targets/${id}/bank`)).data.bank;
    check("归类后全部有板块且已归类未被覆盖", bank4.questions.every((q) => q.section) && bank4.questions.find((q) => q.id === bank3.questions[3].id).section === "role");
    const cls2 = await j("POST", `/api/targets/${id}/bank/classify`);
    check("无未分类题时归类返回 400", cls2.status === 400, `got ${cls2.status}`);

    // ============ 8. 文件面板 API ============
    const files = await j("GET", `/api/targets/${id}/files`);
    check(
      "文件清单返回绝对路径 + 存在标记",
      files.status === 200 && files.data.items.length >= 8 && path.isAbsolute(files.data.items[0].path) && files.data.items.find((i) => i.relPath === "bank.json")?.exists === true,
      JSON.stringify(files.data.items?.[0]),
    );
    const openBad = await j("POST", `/api/targets/${id}/files/open`, { relPath: "../settings.json" });
    check("open 拒绝越界路径", openBad.status === 400, `got ${openBad.status}`);
    const openMissing = await j("POST", `/api/targets/${id}/files/open`, { relPath: "does-not-exist.md" });
    check("open 对不存在文件返回 404", openMissing.status === 404, `got ${openMissing.status}`);
    const openOk = await j("POST", `/api/targets/${id}/files/open`, { relPath: "bank.json" });
    check("open 真实文件（会弹出资源管理器）", openOk.status === 200, `got ${openOk.status}`);

    // ============ 9. 抽题：题库有题 → 本地抽题秒开；「换一批」避开上一场 ============
    const styled = await j("POST", `/api/targets/${id}/sessions`, { minutes: 9, style: "压力面：追问尖锐，节奏紧凑。" });
    const sFull = styled.data.session;
    check(
      "9 分钟 → 3 道抽题（题库 id + rubric + 板块 + 开场即带题库对应与参考答案）",
      sFull?.questions?.length === 3 &&
        sFull.questions.every(
          (q) =>
            q.id.startsWith("q_") &&
            q.rubric &&
            q.section &&
            q.matchedBankQuestionId === q.id &&
            q.matchedReason === "题库抽题" &&
            typeof q.referenceAnswer === "string" &&
            q.referenceAnswer.length > 0,
        ),
      JSON.stringify(sFull?.questions?.map((q) => [q.id, q.section])).slice(0, 200),
    );
    check("风格写入场次 + plannedMinutes", sFull?.interviewerStyle === "压力面：追问尖锐，节奏紧凑。" && sFull?.plannedMinutes === 9);

    const again = await j("POST", `/api/targets/${id}/sessions`, { minutes: 9 });
    check(
      "再次开场仍从题库抽题（题库 id 都真实存在）",
      again.data.session?.questions?.length === 3 &&
        again.data.session.questions.every((q) => bank4.questions.some((b) => b.id === q.id)),
      JSON.stringify(again.data.session?.questions?.map((q) => q.id)),
    );

    const regenPaper = await j("POST", `/api/targets/${id}/sessions`, { minutes: 9, regeneratePaper: true });
    const rpIds = regenPaper.data.session?.questions?.map((q) => q.id) ?? [];
    check("换一批题：避开上一场（上一场 3 题全不出现）", rpIds.length === 3 && !rpIds.some((x) => sFull.questions.some((q) => q.id === x)), JSON.stringify(rpIds));

    // ============ 10. 试卷题 turn：快照兜底走大脑 + 时长档强制切题 ============
    const turn1 = await j("POST", `/api/targets/${id}/sessions/${sFull.id}/turn`, {
      questionId: sFull.questions[0].id,
      answer: "（e2e）短回答，试卷题不在题库里，mock 应照常追问。",
      durationSec: 60,
    });
    check(
      "试卷题短回答 → 追问（快照兜底）",
      turn1.data.action === "followup" && turn1.data.followUp?.includes("（Mock 追问）"),
      JSON.stringify(turn1.data).slice(0, 150),
    );
    const tight = await j("POST", `/api/targets/${id}/sessions/${sFull.id}/turn`, {
      questionId: sFull.questions[0].id,
      answer: "（e2e）补一句。",
      durationSec: 60,
      elapsedSec: 480,
    });
    check("全场剩 <15% 强制 next 不追问", tight.data.action === "next" && !tight.data.followUp, JSON.stringify(tight.data).slice(0, 150));
    const overq = await j("POST", `/api/targets/${id}/sessions/${sFull.id}/turn`, {
      questionId: sFull.questions[1].id,
      answer: "（e2e）另一题短回答。",
      durationSec: 300,
      elapsedSec: 60,
    });
    check("本题超预算 20% 强制 next", overq.data.action === "next" && !overq.data.followUp, JSON.stringify(overq.data).slice(0, 150));
    const tUp = await j("POST", `/api/targets/${id}/sessions/${sFull.id}/turn`, {
      questionId: sFull.questions[2].id,
      answer: "（e2e）时间到了还没答完。",
      durationSec: 30,
      elapsedSec: 560,
    });
    check("全场时间到 → timeup 收尾", tUp.data.action === "timeup" && typeof tUp.data.comment === "string" && tUp.data.comment.length > 0, JSON.stringify(tUp.data).slice(0, 150));

    // ============ 11. 整场连续逐字稿：按试卷原题文本切分 ============
    const wholeS = await j("POST", `/api/targets/${id}/sessions`, { minutes: 15 });
    const wq = wholeS.data.session.questions;
    check("15 分钟 → 5 道试卷题", wq.length === 5, `got ${wq.length}`);
    const wTurn = await j("POST", `/api/targets/${id}/sessions/${wholeS.data.session.id}/turn`, {
      transcript: {
        agentUserId: "interviewer",
        segments: [
          { userId: "interviewer", text: `你好，欢迎参加今天的面试，我们直接开始。第一个问题：${wq[0].question}`, definite: true },
          { userId: "u_1", text: "我先讲情境，再讲行动，最后讲一个量化的结果。", definite: true },
          { userId: "interviewer", text: "能给一个具体数字吗？", definite: true },
          { userId: "u_1", text: "覆盖了 100 个同学，上手时间从两周缩到三天。", definite: true },
          { userId: "interviewer", text: `好的，下一个问题：${wq[1].question}`, definite: true },
          { userId: "u_1", text: "第二题我讲跨部门协作，拉了三个部门对齐模板。", definite: true },
          { userId: "interviewer", text: "今天的面试就到这里，谢谢你的时间。", definite: true },
        ],
        durationSec: 300,
      },
    });
    check("整场逐字稿落盘返回场次", wTurn.status === 200 && Array.isArray(wTurn.data.session?.turns), JSON.stringify(wTurn.data).slice(0, 150));
    const wSess = (await j("GET", `/api/targets/${id}/sessions/${wholeS.data.session.id}`)).data.session;
    const wT0 = wSess.turns.find((t) => t.questionId === wq[0].id);
    const wT1 = wSess.turns.find((t) => t.questionId === wq[1].id);
    check(
      "按原题切分：第 1 题答案 + 全角问号追问成对",
      wT0 && wT0.answer.includes("情境") && wT0.followUpQA.length === 1 && wT0.followUpQA[0].a.includes("100"),
      JSON.stringify(wT0).slice(0, 200),
    );
    check("按原题切分：第 2 题独立成 turn", wT1 && wT1.answer.includes("跨部门") && wT1.followUpQA.length === 0, JSON.stringify(wT1).slice(0, 200));
    check("整场时长按题分摊", (wT0?.durationSec ?? 0) > 0 && (wT1?.durationSec ?? 0) > 0, `d0=${wT0?.durationSec} d1=${wT1?.durationSec}`);

    // ============ 12. 全场 finish：五维评分 + 题库匹配 + 手动改选 + 采纳建议 ============
    for (const q of regenPaper.data.session.questions) {
      const r = await j("POST", `/api/targets/${id}/sessions/${regenPaper.data.session.id}/turn`, {
        questionId: q.id,
        answer: "（e2e）我按现在的框架回答这道题：先讲情境，再讲我采取的行动，最后给一个量化的结果和复盘。",
        durationSec: 90,
      });
      check(`模拟作答 ${q.id.slice(0, 10)}…`, r.status === 200, JSON.stringify(r.data).slice(0, 120));
    }
    const fin = await j("POST", `/api/targets/${id}/sessions/${regenPaper.data.session.id}/finish`);
    const finSess = fin.data.session;
    const sc = finSess?.scorecard;
    check(
      "全场评分：总分 + 应变维度 + 板块热力图 + 逐题 missed",
      typeof sc?.overall === "number" && typeof sc?.dimensions?.adaptability?.score === "number" && Array.isArray(sc?.sections) && sc.sections.length >= 1 && Array.isArray(sc?.perQuestion?.[0]?.missed),
      JSON.stringify(sc?.dimensions).slice(0, 200),
    );
    check(
      "评分后逐题快照带上题库匹配（mock 顺序配对）",
      finSess.questions.every((q) => typeof q.matchedBankQuestionId === "string" && bank4.questions.some((b) => b.id === q.matchedBankQuestionId)),
      JSON.stringify(finSess.questions.map((q) => [q.id, q.matchedBankQuestionId])).slice(0, 200),
    );
    check("评分建议存在且指向试卷题", sc?.suggestions?.length >= 1 && sc.suggestions[0].questionId === finSess.questions[0].id, JSON.stringify(sc?.suggestions?.[0]).slice(0, 150));

    const manualBankId = bank4.questions[1].id;
    const setMatch = await j("PATCH", `/api/targets/${id}/sessions/${finSess.id}/match`, {
      questionId: finSess.questions[0].id,
      bankQuestionId: manualBankId,
    });
    const m0 = setMatch.data.session?.questions?.find((q) => q.id === finSess.questions[0].id);
    check("手动改选题库匹配", m0?.matchedBankQuestionId === manualBankId && m0?.matchedReason === "手动指定", JSON.stringify(m0).slice(0, 150));

    const apply1 = await j("POST", `/api/targets/${id}/bank/apply-suggestion`, { sessionId: finSess.id, index: 0 });
    check("采纳建议：试卷题 id 经快照解析到题库题", apply1.status === 200 && apply1.data.session?.scorecard?.suggestions?.[0]?.applied === true, JSON.stringify(apply1.data).slice(0, 150));
    const bankAfterApply = (await j("GET", `/api/targets/${id}/bank`)).data.bank;
    const patchedQ = bankAfterApply.questions.find((q) => q.id === manualBankId);
    check("建议写入手动指定题的 notes", patchedQ?.notes?.includes("[复盘建议"), JSON.stringify(patchedQ?.notes).slice(0, 150));
    const apply2 = await j("POST", `/api/targets/${id}/bank/apply-suggestion`, { sessionId: finSess.id, index: 0 });
    check("同一建议不可重复采纳（409）", apply2.status === 409, `got ${apply2.status}`);

    const clearMatch = await j("PATCH", `/api/targets/${id}/sessions/${finSess.id}/match`, {
      questionId: finSess.questions[0].id,
      bankQuestionId: null,
    });
    const m1 = clearMatch.data.session?.questions?.find((q) => q.id === finSess.questions[0].id);
    check("清空手动匹配", m1?.matchedBankQuestionId === undefined && m1?.matchedReason === undefined, JSON.stringify(m1).slice(0, 120));

    // 评分提示词改写后再评一次（复盘弹窗「重新评分」链路）
    await j("PUT", `/api/targets/${id}/prompt-override`, { key: "score", instruction: "（e2e）评分指令" });
    const reFin = await j("POST", `/api/targets/${id}/sessions/${finSess.id}/finish`);
    check("改写评分提示词后可重新评分", reFin.status === 200 && !!reFin.data.session?.scorecard, JSON.stringify(reFin.data).slice(0, 120));
    await j("PUT", `/api/targets/${id}/prompt-override`, { key: "score", reset: true });

    // ============ 13. 教学陪练（单题）：快照带参考答案 + 文字轮 + 语音结算 + 蒸馏缓存 ============
    const singleQ = bank4.questions[0];
    const single = await j("POST", `/api/targets/${id}/sessions`, { questionId: singleQ.id, style: "温和面。" });
    const sSingle = single.data.session;
    check(
      "单题场次 mode=single + 快照带 rubric/参考答案",
      sSingle?.mode === "single" && sSingle.questions?.[0]?.id === singleQ.id && sSingle.questions[0].rubric && sSingle.questions[0].referenceAnswer?.includes("（Mock 参考答案）") && sSingle.questions[0].matchedBankQuestionId === singleQ.id,
      JSON.stringify(sSingle?.questions?.[0]).slice(0, 200),
    );

    const t1 = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/turn`, {
      questionId: singleQ.id,
      mode: "teach",
      answer: "我想长期在国际组织做 AI 落地，帮团队把工具真正用起来，不过说实话我现在还有点紧张。",
    });
    check("教学轮1：教练回复", typeof t1.data.reply === "string" && t1.data.reply.length > 0, JSON.stringify(t1.data).slice(0, 180));
    check("教学轮1带覆盖账本（missing）", Array.isArray(t1.data.coverage?.missing) && t1.data.coverage.missing.length > 0);
    check("教学轮1收集金句", Array.isArray(t1.data.gold) && t1.data.gold.length === 1, `gold=${JSON.stringify(t1.data.gold)}`);
    check("教学轮1不主动结束", t1.data.ended === false);

    const t2 = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/turn`, {
      questionId: singleQ.id,
      mode: "teach",
      answer: "好了，就到这吧。",
    });
    check("教学轮2：说停 → ended", t2.data.ended === true, JSON.stringify(t2.data).slice(0, 180));
    const sAfterText = (await j("GET", `/api/targets/${id}/sessions/${sSingle.id}`)).data.session;
    const textTurn = sAfterText?.turns?.[0];
    check("文字教学聊天流落盘（2 用户 + 2 教练）", textTurn?.chat?.length === 4, `chat=${textTurn?.chat?.length}`);
    check("账本服务端合并（covered 并集去重）", Array.isArray(textTurn?.coverage?.covered) && textTurn.coverage.covered.length === 1, JSON.stringify(textTurn?.coverage));

    const teachTranscript = {
      agentUserId: "agent_uid",
      segments: [
        { userId: "agent_uid", text: "来，咱们接着练——刚才说到哪了？", definite: true },
        { userId: "user_uid", text: "我教过 100 小时 AI 工具，同学上手时间从两周缩到三天。", definite: true },
        { userId: "agent_uid", text: "很好，再说一个你协调跨部门的例子？", definite: true },
        { userId: "user_uid", text: "我组织过实验室的知识库迁移，拉了三个部门对齐模板。", definite: true },
      ],
      durationSec: 95,
    };
    const settle = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/turn`, {
      questionId: singleQ.id,
      mode: "teach",
      transcript: teachTranscript,
    });
    check(
      "教学语音结算返回覆盖账本",
      settle.status === 200 && Array.isArray(settle.data.coverage?.covered) && settle.data.coverage.covered.length >= 2,
      JSON.stringify(settle.data).slice(0, 200),
    );
    const sAfterSettle = (await j("GET", `/api/targets/${id}/sessions/${sSingle.id}`)).data.session;
    const t0 = sAfterSettle?.turns?.[0];
    check("语音逐字稿全量入聊天流（双方都在）", (t0?.chat?.length ?? 0) >= 8, `chat=${t0?.chat?.length}`);
    check("结算金句落盘", (t0?.gold?.length ?? 0) >= 1, `gold=${JSON.stringify(t0?.gold)}`);
    check("语音保存即归档（finishedAt 落盘，不依赖客户端补发 finish）", typeof sAfterSettle?.finishedAt === "string", `finishedAt=${sAfterSettle?.finishedAt}`);

    // 重发同一段逐字稿（结算失败后的重试路径）：不重复入聊天流，覆盖账本照常返回
    const settleRetry = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/turn`, {
      questionId: singleQ.id,
      mode: "teach",
      transcript: teachTranscript,
    });
    const sAfterRetry = (await j("GET", `/api/targets/${id}/sessions/${sSingle.id}`)).data.session;
    check(
      "结算重试幂等：聊天流不重复追加",
      settleRetry.status === 200 && sAfterRetry?.turns?.[0]?.chat?.length === t0?.chat?.length,
      `before=${t0?.chat?.length} after=${sAfterRetry?.turns?.[0]?.chat?.length} resp=${JSON.stringify(settleRetry.data).slice(0, 120)}`,
    );

    // settle 补算路由：抹掉覆盖清单与归档（模拟保存期间关掉页面的残局）→ 从已存聊天流补算
    const sessPath = path.join("data", "targets", id, "sessions", `${sSingle.id}.json`);
    const sessRaw = JSON.parse(fs.readFileSync(sessPath, "utf8"));
    delete sessRaw.turns[0].coverage;
    delete sessRaw.finishedAt;
    fs.writeFileSync(sessPath, JSON.stringify(sessRaw, null, 2));
    const resettle = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/settle`);
    check(
      "settle 路由补算覆盖清单+归档",
      resettle.status === 200 && Array.isArray(resettle.data.coverage?.covered) && resettle.data.coverage.covered.length >= 2 && typeof resettle.data.session?.finishedAt === "string",
      JSON.stringify(resettle.data).slice(0, 180),
    );
    check("settle 路由幂等：已有覆盖清单原样返回", (await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/settle`)).status === 200);

    const d1 = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/distill`);
    const draft = d1.data.distill;
    check("蒸馏草稿带 ✨ 金句标记", typeof draft?.referenceDraft === "string" && draft.referenceDraft.includes("✨"), JSON.stringify(d1.data).slice(0, 180));
    check("蒸馏带未覆盖要点提示", Array.isArray(draft?.uncovered) && draft.uncovered.length > 0);
    const d2 = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/distill`);
    check("再次蒸馏命中缓存", d2.data.cached === true && d2.data.distill?.referenceDraft === draft.referenceDraft, JSON.stringify(d2.data).slice(0, 120));

    const finS = await j("POST", `/api/targets/${id}/sessions/${sSingle.id}/finish`);
    check("教学场次收尾不出评分", finS.status === 200 && !!finS.data.session?.finishedAt && !finS.data.session?.scorecard, JSON.stringify(finS.data).slice(0, 150));

    // ============ 14. 题库导出 md：锁定标记 ============
    const mdRes = await fetch(`${BASE}/api/targets/${id}/bank?export=md`);
    const md = await mdRes.text();
    check("导出 md 含锁定标记与题干", mdRes.status === 200 && md.includes("已锁定") && md.includes("**Q：**"), md.slice(0, 120));

    // ============ 15. 场次列表 + inputs 时间戳 ============
    const ls = (await j("GET", `/api/targets/${id}/sessions`)).data.sessions;
    const singles = ls.filter((x) => x.mode === "single" && x.questionIds.includes(singleQ.id));
    const fullMocks = ls.filter((x) => x.mode !== "single");
    check(
      "场次列表带 mode/questionIds/active",
      ls.length >= 5 && singles.length === 1 && fullMocks.length >= 4 && ls.every((x) => Array.isArray(x.questionIds) && typeof x.active === "boolean"),
      JSON.stringify(ls.map((x) => [x.mode, x.active])).slice(0, 200),
    );

    await j("PUT", `/api/targets/${id}/inputs`, { jd: "AI 项目专员（e2e 主目标）：负责 AI 工具落地（e2e 更新）。" });
    const inputsAfter = (await j("GET", `/api/targets/${id}/inputs`)).data;
    check("inputs 记录 updatedAt + rawFiles 清单", typeof inputsAfter.inputs?.updatedAt === "string" && Array.isArray(inputsAfter.rawFiles), JSON.stringify(inputsAfter.inputs?.updatedAt));

    // ============ 16. 大脑/语音自检 ============
    const brain = await j("GET", "/api/brain/check");
    check("大脑自检（mock）ok", brain.status === 200 && brain.data.ok === true && brain.data.provider === "mock", JSON.stringify(brain.data));
    await j("PUT", "/api/settings", {
      ...settingsBefore,
      voice: {
        ...settingsBefore.voice,
        volcengine: { appId: "", appKey: "", accessKeyId: "", secretKey: "", llmModel: "", voiceType: "" },
      },
    });
    const vcEmpty = await j("GET", "/api/voice/check");
    check("voice check 缺配置时列出缺失项", vcEmpty.status === 200 && vcEmpty.data.ok === false && (vcEmpty.data.missing ?? []).length === 6, JSON.stringify(vcEmpty.data));
    await j("PUT", "/api/settings", settingsBefore);
    const vcOk = await j("GET", "/api/voice/check");
    check("voice check 配置齐时 ok（真实凭证已填）", vcOk.status === 200 && vcOk.data.ok === true, JSON.stringify(vcOk.data));
    const ttsGone = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "测试" }),
    });
    check("已删除的 /api/tts 返回 404", ttsGone.status === 404, `got ${ttsGone.status}`);
  } finally {
    if (id) await j("DELETE", `/api/targets/${id}`);
    if (id2) await j("DELETE", `/api/targets/${id2}`);
    // 还原设置（含 provider 与全部密钥）
    if (settingsBefore) await j("PUT", "/api/settings", settingsBefore);
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
