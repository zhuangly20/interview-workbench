import type { BrainCall } from "./index";

/**
 * Mock 大脑：不需要任何 key，首次启动即可体验全流程。
 * 从 prompt 的结构化段落（【候选人刚给出的回答】/ QID: 行）做确定性回放。
 */

export function mockBrain(call: BrainCall): string {
  switch (call.task) {
    case "analyze":
      return JSON.stringify({
        roleSummary:
          "（Mock 示例）这是一个综合型岗位，要求把 AI 工具落到日常协作、分析与知识管理里，并对输出质量与信息安全负责。",
        mapping: [
          {
            responsibility: "日常文书与协调",
            capabilities: ["结构化写作", "会议纪要与行动清单", "流程协调"],
            checkpoints: ["能否按模板快速成稿", "是否建立人工把关习惯"],
            jdEvidence: "（Mock）负责 AI 工具落地与跨部门协作",
            matchLevel: "medium",
            matchEvidence: "（Mock）简历上 100 小时 AI 工具教学经历",
            sampleQuestions: ["（Mock）讲一个你把工具流程落地的例子？"],
          },
          {
            responsibility: "数据分析支持",
            capabilities: ["证据收集与整理", "基础数据梳理", "报告结构设计"],
            checkpoints: ["会不会用 AI 辅助归纳", "能否说明信息来源"],
            jdEvidence: "（Mock）负责数据分析与报告产出",
            matchLevel: "high",
            matchEvidence: "（Mock）博士期间的定量研究经历",
            sampleQuestions: ["（Mock）举一个你用数据支撑决策的例子？"],
          },
          {
            responsibility: "沟通与信息完整性",
            capabilities: ["对外写作", "多语言翻译把关", "事实核查"],
            checkpoints: ["是否逐条核对来源", "能否描述核查流程"],
            jdEvidence: "（Mock）要求信息安全意识与多语言沟通",
            matchLevel: "low",
            matchEvidence: "",
            sampleQuestions: [],
          },
          {
            responsibility: "知识管理",
            capabilities: ["文档组织", "模板沉淀", "经验文档化"],
            checkpoints: ["有无知识库使用经验", "能否举出复用案例"],
            jdEvidence: "（Mock）负责知识管理与经验沉淀",
            matchLevel: "medium",
            matchEvidence: "（Mock）实验室知识库迁移经历",
            sampleQuestions: ["（Mock）举一个你沉淀模板供他人复用的例子？"],
          },
        ],
        riskNotes: [
          "Mock 数据：在 Settings 里配置真实模型后重新生成可获得针对你 JD 的拆解。",
          "信息完整性与保密是这类岗位的通用红线。",
        ],
      });

    case "extract-title":
      return JSON.stringify({ title: "（Mock 岗位）AI 项目专员" });

    case "analyze-card": {
      // 从【职责】段取当前职责，回一张确定性卡片
      const i = call.prompt.indexOf("【职责】");
      const duty = i === -1 ? "（Mock 职责）" : call.prompt.slice(i + 4, call.prompt.indexOf("\n", i)).trim();
      return JSON.stringify({
        responsibility: duty || "（Mock 职责）",
        capabilities: ["（Mock）结构化表达", "（Mock）证据意识"],
        checkpoints: ["（Mock）能否给出带数字的例子", "（Mock）是否说明信息来源"],
        jdEvidence: "（Mock）JD 原文依据",
        matchLevel: "medium",
        matchEvidence: "（Mock）简历上最接近的一段经历",
        sampleQuestions: ["（Mock）讲一个你做这件事的具体例子？"],
      });
    }

    case "generate-bank": {
      // Mock 出题跟随面试语言（目标语言创建时定死，prompt 里会写明「中文/英文面试陪练」）
      const zh = call.prompt.includes("「中文面试陪练」");
      const qs: [string, string[]][] = zh
        ? [
            ["请先做一个自我介绍，并说说你为什么适合这个岗位。", ["这些优势里哪一个在日常工作中最常用到？"]],
            ["你为什么想做这个岗位？为什么是现在？", ["如果入职后发现和预期不符，你会怎么办？"]],
            ["讲一段你在高压下拿到结果的经历。", ["现在回头看，你会做哪些不同的决定？"]],
            ["你如何保证 AI 生成内容的质量？", ["举一个你设计过的具体核查流程。"]],
            ["入职头三个月你想学会什么？", ["你怎么衡量自己学没学会？"]],
          ]
        : [
            ["Tell me about yourself and what makes you a fit for this role.", ["Which of these strengths is most relevant day to day?"]],
            ["Why do you want this position, and why now?", ["What would make you regret taking it?"]],
            ["Describe a time you delivered results under pressure.", ["What would you do differently now?"]],
            ["How do you ensure quality when using AI-generated content?", ["Give a concrete example of a check you built."]],
            ["What would you want to learn in your first three months?", ["How would you measure that learning?"]],
          ];
      const rubrics = [
        "内容 40%：与 JD 对应的 2-3 条证据；结构 30%：现在-过去-未来；语言 30%：简洁无误。",
        "内容 40%：动机具体、与岗位绑定；结构 30%：三段式；语言 30%：口语流畅。",
        "内容 40%：情境-任务-行动-结果齐全；结构 30%：一条主线；语言 30%：时间控制 90 秒内。",
        "内容 40%：核查流程具体；结构 30%：分层论述；语言 30%：术语解释清楚。",
        "内容 40%：学习目标可执行；结构 30%：分阶段；语言 30%：表达自然。",
      ];
      const sections = ["intro", "motivation", "resume", "knowledge", "role"];
      return JSON.stringify({
        questions: qs.map(([question, followUps], i) => ({
          question,
          followUps,
          rubric: rubrics[i],
          answer: "（Mock 参考答案）请配置真实模型后重新生成，或直接在题库中自己撰写。",
          notes: i === 0 ? "Mock 生成的草稿，请编辑后批准。" : "",
          section: sections[i],
        })),
      });
    }

    case "regen-question": {
      // 从 QID 行取题目 id，回一个确定性重写结果
      const qid = call.prompt.match(/QID:\s*(\S+)/)?.[1] ?? "q_mock";
      const zh = call.prompt.includes("「中文面试陪练」");
      return JSON.stringify({
        question: zh
          ? "（Mock 重写）请结合一段真实经历，说明你如何把一个工具或流程真正落地？"
          : "(Mock regen) Walk me through a specific time you actually put a tool or process into practice.",
        followUps: ["（Mock 追问）结果怎么量化？"],
        rubric: "内容 40%：真实经历 + 量化结果；结构 30%；语言 30%。",
        answer: "（Mock 参考答案）请配置真实模型后重新生成本题。",
        notes: "（Mock）重写理由：题面更聚焦落地能力。",
        section: "resume",
      });
    }

    case "make-paper": {
      // 出卷：跟着 prompt 里「共 N 道题」的量给确定性试卷（中英随语言标记）
      const count = Math.max(1, Math.min(30, Number(call.prompt.match(/共\s*(\d+)\s*道题/)?.[1] ?? 5)));
      const zh = call.prompt.includes("「中文面试」");
      const bank: [string, string][] = zh
        ? [
            ["先用两分钟介绍一下你自己，以及你和这个岗位的匹配点。", "intro"],
            ["说说你最近一次在时间很紧的情况下交付任务的经历。", "resume"],
            ["这个岗位要协调多方，你举一个说服别人的例子。", "role"],
            ["你如何保证交付内容的质量？讲讲你的检查流程。", "knowledge"],
            ["如果入职后发现实际工作和预期差别很大，你会怎么办？", "motivation"],
          ]
        : [
            ["Take two minutes to introduce yourself and why you fit this role.", "intro"],
            ["Tell me about a recent time you delivered under a tight deadline.", "resume"],
            ["This role coordinates many stakeholders — give an example of persuading someone.", "role"],
            ["How do you ensure the quality of what you deliver? Walk me through your checks.", "knowledge"],
            ["What if the job turns out very different from what you expected?", "motivation"],
          ];
      return JSON.stringify({
        questions: Array.from({ length: count }, (_, i) => {
          const [question, section] = bank[i % bank.length];
          return {
            question: `${question}${i >= bank.length ? `（变体 ${Math.floor(i / bank.length) + 1}）` : ""}`,
            section,
            focus: ["（Mock）考察点一", "（Mock）考察点二"],
            rubric: "内容 40%：具体证据；结构 30%：一条主线；语言 30%。",
            notes: "（Mock）对应拆解卡第 1 条职责。",
          };
        }),
      });
    }

    case "match-questions": {
      // 从 PQID 行取试卷题、从题库清单行取题库 id，按顺序确定性配对
      const paperIds = [...call.prompt.matchAll(/PQID:\s*(\S+)/g)].map((m) => m[1]);
      const bankIds = [...call.prompt.matchAll(/^- (q_[A-Za-z0-9_]+) ·/gm)].map((m) => m[1]);
      return JSON.stringify({
        matches: paperIds.map((pid, i) => ({
          paperQuestionId: pid,
          bankQuestionId: bankIds[i % Math.max(1, bankIds.length)] ?? null,
          reason: "（Mock）考察点与题干最接近。",
        })),
      });
    }

    case "practice-turn": {
      // 从模板段落里取候选人回答：短回答（<200 字符）触发 mock 追问，否则下一题
      const section = (start: string, end: string) => {
        const i = call.prompt.indexOf(start);
        const j = i === -1 ? -1 : call.prompt.indexOf(end, i);
        return i === -1 || j === -1 ? "" : call.prompt.slice(i + start.length, j).trim();
      };
      const rule = section("【追问规则】", "决策要求");
      const answer = section("【候选人刚给出的回答】", "【追问规则】");
      const forcedNext = rule.includes("必须 action=next") || answer.length >= 200;
      if (forcedNext) {
        return JSON.stringify({ action: "next", followUp: "", comment: "（Mock）回答完整，进入下一题。" });
      }
      // 追问语言跟随面试语言（模板首句会写明「中文/英文面试中的面试官」）
      const zhTurn = call.prompt.includes("中文面试中的面试官");
      return JSON.stringify({
        action: "followup",
        followUp: zhTurn
          ? "（Mock 追问）能举一个具体的例子说明吗？"
          : "（Mock 追问）Can you make that concrete with one specific example?",
        comment: "",
      });
    }

    case "brain-check":
      return JSON.stringify({ ok: true });

    case "teach-turn": {
      // 教学陪练：候选人消息含「停/结束/下一题」→ ended 收尾；否则陪聊并把长消息记为已覆盖
      const grab = (start: string, end: string) => {
        const i = call.prompt.indexOf(start);
        const j = i === -1 ? -1 : call.prompt.indexOf(end, i);
        return i === -1 || j === -1 ? "" : call.prompt.slice(i + start.length, j).trim();
      };
      const msg = grab("【候选人刚说的话】", "【当前轮数】");
      const zh = call.prompt.includes("中文面试的");
      if (/停|就到这|结束|下一题|stop|next question/i.test(msg)) {
        return JSON.stringify({
          reply: zh
            ? "（Mock）好，这题就练到这——点「结束练习」就能看到覆盖清单和沉淀参考答案。"
            : "(Mock) Alright, let's wrap this one up here — tap End to see your coverage list.",
          covered: ["（Mock）练习过的要点一"],
          missing: ["（Mock）还没练到的要点二"],
          gold: [],
          ended: true,
        });
      }
      const covered = msg.length >= 120 ? ["（Mock）练习过的要点一"] : [];
      return JSON.stringify({
        reply: zh
          ? "（Mock 陪练）说得不错！评分要点里还差一个带数字的例子——试着补一句「我把上手时间从两周压到了三天」这样的？"
          : "(Mock coach) Good! One rubric point still lacks numbers — try adding something like \"I cut onboarding time from two weeks to three days\"?",
        covered,
        missing: ["（Mock）还没练到的要点二"],
        gold: msg.length >= 40 ? [msg.slice(0, 60)] : [],
        ended: false,
      });
    }

    case "settle-teach": {
      return JSON.stringify({
        covered: ["（Mock）自我介绍框架完整", "（Mock）岗位动机清晰"],
        missing: ["（Mock）缺一个量化的结果句"],
        gold: ["(Mock gold) I cut onboarding time from two weeks to three days."],
      });
    }

    case "distill-answer": {
      const zh = call.prompt.includes("中文）参考答案草稿") || call.prompt.includes("骨架");
      return JSON.stringify({
        referenceDraft: zh
          ? "（Mock 草稿）我具备把 AI 工具落进真实工作流的能力——在实验室教学里，✨我把同学的工具上手时间从两周压缩到三天✨，并沉淀了一套 200 小时打磨出的操作手册。"
          : "(Mock draft) I turn AI tools into working workflows — while teaching, ✨I cut my students' onboarding time from two weeks to three days✨, backed by a handbook refined over 200 hours.",
        gold: [],
        uncovered: ["（Mock）还没聊到的要点"],
      });
    }

    case "classify-section": {
      // 从「- q_xxx · 题干」清单里抽 id，轮流给出确定性板块
      const ids = [...call.prompt.matchAll(/^- (q_[A-Za-z0-9_]+) · /gm)].map((m) => m[1]);
      const rotate = ["resume", "motivation", "role", "knowledge", "intro", "other"];
      return JSON.stringify({
        assignments: ids.map((qid, i) => ({ id: qid, section: rotate[i % rotate.length] })),
      });
    }

    case "score": {
      // 从逐字稿的 "QID: <id>" 行提取题目（对模板措辞编辑稳健）
      const ids = [...call.prompt.matchAll(/QID:\s*(\S+)/g)].map((m) => m[1]);
      return JSON.stringify({
        overall: 3.6,
        dimensions: {
          content: { score: 3.5, comment: "（Mock）要点基本覆盖，个别论点缺具体证据。" },
          structure: { score: 4, comment: "（Mock）整体有清晰主线。" },
          language: { score: 3.5, comment: "（Mock）表达清楚，可再口语化。" },
          timing: { score: 3.5, comment: "（Mock）时长接近目标，个别题超时。" },
          adaptability: { score: 3, comment: "（Mock）追问基本接得住，承认不知道时略生硬。" },
        },
        perQuestion: ids.map((id, i) => ({
          questionId: id,
          score: 3 + ((i % 3) * 0.5),
          comment: "（Mock）评分",
          missed: i % 2 === 0 ? ["（Mock）缺一个量化的结果句"] : [],
        })),
        strengths: ["（Mock）结构感好", "（Mock）证据意识强"],
        suggestions: ids.slice(0, 2).map((id) => ({
          questionId: id,
          text: "（Mock 建议）可以在这题参考答案里补充一个量化结果。",
        })),
        summary: "（Mock 评分）配置真实模型后，这里会出现针对你逐字稿的详细点评。",
      });
    }
  }
}
