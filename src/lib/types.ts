// 核心数据模型 —— 文件即真相，全部可被用户直接编辑
// data/settings.json                 -> Settings
// data/targets/<id>/meta.json        -> TargetMeta
// data/targets/<id>/inputs.json      -> TargetInputs
// data/targets/<id>/analysis.json    -> Analysis
// data/targets/<id>/bank.json        -> Bank
// data/targets/<id>/progress.json    -> Progress
// data/targets/<id>/sessions/<sid>.json -> PracticeSession

export type ProviderKind = "mock" | "openai-compatible" | "agent-cli";

export interface Settings {
  provider: ProviderKind;
  openai: { baseUrl: string; apiKey: string; model: string };
  agentCli: { command: string; timeoutSec: number };
  voice: {
    ttsEnabled: boolean;
    sttEnabled: boolean;
    /** 火山引擎「AI 音视频互动」实时语音模式（豆包全双工，独立于上面两项） */
    volcengine: {
      /** RTC AppId（控制台-应用管理，24 位） */
      appId: string;
      /** RTC AppKey（服务端签发进房 Token 用，不出服务端） */
      appKey: string;
      /** 火山引擎账号 API 访问密钥 AK（调用 StartVoiceChat 签名用） */
      accessKeyId: string;
      /** 对应 SK */
      secretKey: string;
      /** 语音模式大脑（豆包模型名） */
      llmModel: string;
      /** TTS 音色 voice_type */
      voiceType: string;
    };
  };
}

/** 题目板块：AI 出题时建议，归类给筛选/统计用，不强制 */
export type QuestionSection = "intro" | "motivation" | "resume" | "role" | "knowledge" | "other";

/** 面试语言：创建目标时定死，之后不可切换（换语言 = 另建目标） */
export type TargetLanguage = "en" | "zh";

export interface TargetMeta {
  id: string;
  name: string;
  createdAt: string;
  /** 缺省视为 en（老目标兼容），见 src/lib/lang.ts */
  language?: TargetLanguage;
  /** 岗位名称：创建后 AI 从 JD 提取（用户可改，改过就不再被覆盖），显示在顶部导航 */
  title?: string;
}

export type InputRole = "jd" | "background" | "resume";

export interface TargetInputs {
  jd: string;
  background: string;
  resume: string;
  /** 任一材料最后一次改动的时间，供以后做「材料比拆解/题库新」的过期提示 */
  updatedAt?: string;
  /** 每个板块来自哪些原始文件（文件导入建目标时记录，材料区展示用） */
  sources?: Partial<Record<InputRole, string[]>>;
}

/** 一条职责 -> 需要的能力 -> 面试考察点（拆解卡；含简历匹配与可能被问的问题） */
export interface CapabilityMap {
  responsibility: string;
  capabilities: string[];
  checkpoints: string[];
  /** JD 原文依据（这条职责来自 JD 哪句话） */
  jdEvidence?: string;
  /** 简历匹配度：high/medium/low（AI 评估或用户改） */
  matchLevel?: "high" | "medium" | "low";
  /** 简历上匹配的地方（引用具体经历；没匹配就留空） */
  matchEvidence?: string;
  /** 可能被问的问题 */
  sampleQuestions?: string[];
}

export interface Analysis {
  roleSummary: string;
  mapping: CapabilityMap[];
  riskNotes: string[];
  generatedAt: string;
  source: "ai" | "seed" | "user-edited";
  /** 用户在拆解页手动编辑过的区块 -> 编辑时间（重新生成会整体覆盖，历史版本可回滚） */
  editedSections?: Record<string, string>;
}

export type QuestionStatus = "draft" | "approved" | "archived";
export type QuestionSource = "ai-draft" | "user-written" | "mixed";

export interface BankQuestion {
  id: string;
  question: string;
  followUps: string[];
  rubric: string;
  answer: string;
  notes: string;
  /** 已废弃的批准制残留（老数据兼容字段，新代码一律用 locked；approved 会在读取时迁移成 locked） */
  status: QuestionStatus;
  source: QuestionSource;
  lastEdited: string;
  /** 板块（AI 建议或手动选择；缺省 = 未分类） */
  section?: QuestionSection;
  /** 🔒 锁定：AI 重新生成题目时完全不动此题（锁定 = 绿，未锁 = 红，未锁的会被重新生成覆盖） */
  locked?: boolean;
}

/** 材料更新对账：已有题目的修订提案（采纳才写入） */
export interface RevisionProposal {
  id: string;
  questionId: string;
  reason: string;
  patch: { question?: string; followUps?: string[]; rubric?: string; answer?: string; notes?: string };
}

/** 材料更新对账：建议退役（归档）的题目 */
export interface RetireProposal {
  id: string;
  questionId: string;
  reason: string;
}

export interface Bank {
  questions: BankQuestion[];
  /** 以下三个是「提案制」时代的遗留字段：现模型 = 锁定保护 + 直接重新生成，提案区已退役，仅老数据文件兼容 */
  proposals?: BankQuestion[];
  revisions?: RevisionProposal[];
  retires?: RetireProposal[];
  version: number;
  /** 最近一次「题目生成」时间（与 analysis.generatedAt 比对 → 题库页显示「有新的岗位信息」提示） */
  generatedAt?: string;
  /** 题目生成时基于的拆解版本（analysis.generatedAt 快照） */
  analysisVersion?: string;
}

/** 教学模式聊天记录（单题教学专用；全量保留双方发言，与 followUpQA 的"问-答"对区分） */
export interface ChatMsg {
  role: "user" | "coach";
  text: string;
  at?: string;
}

/** 覆盖账本：服务端代码记账（不靠模型记忆），逐轮/逐场更新 */
export interface Coverage {
  covered: string[];
  missing: string[];
}

/** 蒸馏结果：纯展示（不写题库），用户自己复制进参考答案 */
export interface DistillResult {
  /** 带 ✨ 金句标记的参考答案全文（草稿） */
  referenceDraft: string;
  gold: string[];
  /** 还没聊到的得分要点（有遗漏才非空） */
  uncovered: string[];
  generatedAt: string;
}

export interface SessionTurn {
  questionId: string;
  question: string;
  answer: string;
  followUpQA: { q: string; a: string }[];
  durationSec?: number;
  /** 教学模式聊天流（语音逐字稿与文字输入都落到这里） */
  chat?: ChatMsg[];
  /** 教学模式覆盖账本 */
  coverage?: Coverage;
  /** 教学模式累计金句（蒸馏的原材料） */
  gold?: string[];
}

export interface DimensionScore {
  score: number; // 0-5
  comment: string;
}

export interface Suggestion {
  questionId: string | null;
  text: string;
  applied: boolean;
}

export interface Scorecard {
  overall: number;
  dimensions: {
    content: DimensionScore;
    structure: DimensionScore;
    language: DimensionScore;
    timing: DimensionScore;
    /** 应变：面对追问、不确定问题的应对（T7 三层评分新增） */
    adaptability: DimensionScore;
  };
  /** 逐题细评：missed = 该题漏掉的得分点（按 rubric） */
  perQuestion: { questionId: string; score: number; comment: string; missed?: string[] }[];
  /** 板块热力图：按题目板块聚合的均分（服务端计算，非大脑产出） */
  sections?: { section: QuestionSection; avg: number; count: number }[];
  strengths: string[];
  suggestions: Suggestion[];
  summary: string;
  generatedAt: string;
}

/** 场次题目快照：开场时固化（试卷题自带 rubric/考察点；单题陪练从题库抄），评分与语音协议优先用快照，不回头查题库 */
export interface SessionQuestionSnap {
  id: string;
  question: string;
  section?: QuestionSection;
  /** 评分要点（signals/pitfalls/权重） */
  rubric?: string;
  /** 参考答案（复盘对照用） */
  referenceAnswer?: string;
  /** 出题理由 / 考察重点（语音协议的内部提示） */
  notes?: string;
  /** 复盘时对应的题库题：AI 匹配建议，用户可在复盘里改选 */
  matchedBankQuestionId?: string;
  /** AI 给出的匹配理由 */
  matchedReason?: string;
}

/** 模拟面试试卷：按拆解重新出题（题面与题库不同表述），按 时长+拆解版本 缓存 */
export interface PaperQuestion {
  id: string;
  question: string;
  section: QuestionSection;
  /** 考察点（从拆解卡生成） */
  focus: string[];
  /** 评分要点 */
  rubric: string;
  /** 考的是哪条职责/能力（中文备注） */
  notes?: string;
}

export interface Paper {
  id: string;
  targetId: string;
  /** 分钟数；0 = 不限时 */
  minutes: number;
  /** 生成时基于的拆解版本 */
  analysisVersion: string;
  createdAt: string;
  questions: PaperQuestion[];
}

export interface PracticeSession {
  id: string;
  targetId: string;
  startedAt: string;
  finishedAt?: string;
  /** full = 正式模拟（试卷出题）；single = 题库单题教学陪练 */
  mode?: "full" | "single";
  /** 开场选的时长档（分钟）；0/缺省 = 不限时 */
  plannedMinutes?: number;
  /** 开场可改的面试官风格提示（注入追问与语音协议） */
  interviewerStyle?: string;
  /** 本场用的试卷缓存键（换一套卷时重出） */
  paperKey?: string;
  /** 开场时固化的题目快照（试卷题或题库题） */
  questions: SessionQuestionSnap[];
  turns: SessionTurn[];
  scorecard?: Scorecard;
  /** 教学场次的蒸馏结果（缓存：生成一次后直接复用，用户随时查看） */
  distill?: DistillResult;
}

export interface Progress {
  updatedAt: string;
  history: {
    sessionId: string;
    date: string;
    overall: number;
    content: number;
    structure: number;
    language: number;
    timing: number;
  }[];
}

/** 场次列表条目（sessions/ 目录的摘要，题库「练过 N 次」与模拟页记录都用它） */
export interface SessionSummary {
  id: string;
  startedAt: string;
  finishedAt?: string;
  overall?: number;
  mode?: "full" | "single";
  /** 本场包含的题目 id（供题库页推导每题练习记录） */
  questionIds: string[];
  /** 是否真的练过（有任何带内容的 turn）；空开场不算 */
  active: boolean;
}

export interface TargetBundle {
  meta: TargetMeta;
  inputs: TargetInputs;
  analysis?: Analysis;
  bank?: Bank;
  progress?: Progress;
  sessions: SessionSummary[];
}
