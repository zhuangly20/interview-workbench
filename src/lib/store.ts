import fs from "node:fs";
import path from "node:path";
import { dataDir, promptsDir, settingsPath, targetDir, targetsDir } from "./paths";
import { normalizeLanguage } from "./lang";
import type {
  Analysis,
  Bank,
  Paper,
  PracticeSession,
  Progress,
  SessionSummary,
  Settings,
  TargetBundle,
  TargetInputs,
  TargetLanguage,
  TargetMeta,
} from "./types";

// ---------- 低层读写 ----------

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    // 临时诊断：陪练 404 案——区分「文件真不在」和「读失败（EBUSY/EPERM 等）」
    if (file.includes(`${path.sep}sessions${path.sep}`)) {
      console.error("[readJson FAIL]", file, e instanceof Error ? e.message : e);
    }
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function newId(prefix: string): string {
  const hex = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return `${prefix}_${hex}`;
}

// ---------- 首跑初始化 ----------

const defaultSettings: Settings = {
  provider: "mock",
  openai: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "", model: "glm-4-flash" },
  agentCli: { command: "", timeoutSec: 120 },
  voice: {
    ttsEnabled: true,
    sttEnabled: true,
    volcengine: {
      appId: "",
      appKey: "",
      accessKeyId: "",
      secretKey: "",
      llmModel: "doubao-seed-2-1-turbo-260628",
      voiceType: "zh_female_yuanqinvyou_moon_bigtts",
    },
  },
};

let initialized = false;

/** 首次调用时创建 data/（幂等）。不内置任何演示目标：用户数据一律由用户自己导入 */
export function ensureData(): void {
  if (initialized) return;
  fs.mkdirSync(targetsDir(), { recursive: true });
  if (!fs.existsSync(settingsPath())) {
    writeJson(settingsPath(), defaultSettings);
  }
  initialized = true;
}

// ---------- Settings ----------

export function getSettings(): Settings {
  ensureData();
  const s = readJson<Settings>(settingsPath()) ?? defaultSettings;
  // 老的 settings.json 可能缺新增字段：逐层补默认值（文件值优先）
  return {
    ...defaultSettings,
    ...s,
    voice: {
      ...defaultSettings.voice,
      ...s.voice,
      volcengine: { ...defaultSettings.voice.volcengine, ...s.voice?.volcengine },
    },
  };
}

export function saveSettings(s: Settings): void {
  ensureData();
  writeJson(settingsPath(), s);
}

// ---------- Targets ----------

export function listTargets(): TargetMeta[] {
  ensureData();
  const out: TargetMeta[] = [];
  for (const id of fs.existsSync(targetsDir()) ? fs.readdirSync(targetsDir()) : []) {
    const meta = readJson<TargetMeta>(path.join(targetsDir(), id, "meta.json"));
    if (meta) out.push(meta);
  }
  // 新建的目标排最前
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createTarget(meta: TargetMeta, inputs: TargetInputs, sources?: TargetInputs["sources"]): void {
  const dir = targetDir(meta.id);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  writeJson(path.join(dir, "meta.json"), meta);
  writeJson(path.join(dir, "inputs.json"), sources ? { ...inputs, sources } : inputs);
  writeJson(path.join(dir, "progress.json"), {
    updatedAt: new Date().toISOString(),
    history: [],
  } satisfies Progress);
}

export function deleteTarget(id: string): void {
  fs.rmSync(targetDir(id), { recursive: true, force: true });
}

export function readInputs(id: string): TargetInputs {
  return readJson<TargetInputs>(path.join(targetDir(id), "inputs.json")) ?? { jd: "", background: "", resume: "" };
}

export function readMeta(id: string): TargetMeta | undefined {
  return readJson<TargetMeta>(path.join(targetDir(id), "meta.json"));
}

/** 更新 meta（岗位名称等）；不存在则忽略 */
export function updateMeta(id: string, patch: Partial<TargetMeta>): TargetMeta | undefined {
  const meta = readMeta(id);
  if (!meta) return undefined;
  const next = { ...meta, ...patch };
  writeJson(path.join(targetDir(id), "meta.json"), next);
  return next;
}

/** 目标的面试语言（创建时定死；老目标无该字段按 en 处理） */
export function readLanguage(id: string): TargetLanguage {
  return normalizeLanguage(readMeta(id)?.language);
}

export function readAnalysis(id: string): Analysis | undefined {
  return readJson<Analysis>(path.join(targetDir(id), "analysis.json"));
}

export function writeAnalysis(id: string, a: Analysis): void {
  writeJson(path.join(targetDir(id), "analysis.json"), a);
}

/** 写入新拆解前把当前版自动归档到 analysis/versions/，任何改写都可回滚 */
export function saveAnalysisWithHistory(id: string, a: Analysis): void {
  const cur = readAnalysis(id);
  if (cur) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeJson(path.join(targetDir(id), "analysis", "versions", `${stamp}.json`), cur);
  }
  writeAnalysis(id, a);
}

export function listAnalysisVersions(id: string): { file: string; at: string }[] {
  const dir = path.join(targetDir(id), "analysis", "versions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => ({ file: f, at: f.replace(/\.json$/, "") }));
}

export function readAnalysisVersion(id: string, file: string): Analysis | undefined {
  if (!/^[\dT-]+Z\.json$/.test(file) || file.includes("/") || file.includes("\\")) return undefined;
  return readJson<Analysis>(path.join(targetDir(id), "analysis", "versions", file));
}

// ---------- 拆解/各管线提示词改写（按目标保存；key 见 OVERRIDE_KEYS） ----------

/** 各管线共享模板的覆盖文件位置（相对目标目录） */
export const OVERRIDE_KEYS = {
  analysis: "analysis/prompt-override.md",
  "analysis-card": "analysis/card-prompt-override.md",
  "regen-question": "bank/question-prompt-override.md",
  score: "mock/score-prompt-override.md",
  paper: "mock/paper-prompt-override.md",
} as const;

export type OverrideKey = keyof typeof OVERRIDE_KEYS;

const overridePath = (id: string, key: OverrideKey) => path.join(targetDir(id), OVERRIDE_KEYS[key]);

export function isOverrideKey(v: string): v is OverrideKey {
  return Object.prototype.hasOwnProperty.call(OVERRIDE_KEYS, v);
}

export function readPromptOverrideAt(id: string, key: OverrideKey): string | undefined {
  try {
    const t = fs.readFileSync(overridePath(id, key), "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function writePromptOverrideAt(id: string, key: OverrideKey, text: string): void {
  const file = overridePath(id, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

export function clearPromptOverrideAt(id: string, key: OverrideKey): void {
  try {
    fs.rmSync(overridePath(id, key), { force: true });
  } catch {
    /* 忽略 */
  }
}

// 兼容旧调用：拆解主模板
export function readPromptOverride(id: string): string | undefined {
  return readPromptOverrideAt(id, "analysis");
}

export function writePromptOverride(id: string, text: string): void {
  writePromptOverrideAt(id, "analysis", text);
}

export function clearPromptOverride(id: string): void {
  clearPromptOverrideAt(id, "analysis");
}

export function defaultAnalyzeInstruction(): string {
  try {
    return fs.readFileSync(path.join(promptsDir(), "analyze.md"), "utf8");
  } catch {
    return "";
  }
}

export function defaultInstruction(name: string): string {
  try {
    return fs.readFileSync(path.join(promptsDir(), `${name}.md`), "utf8");
  } catch {
    return "";
  }
}

// ---------- 材料更新（inputs 版本化） ----------

export function updateInput(id: string, role: "jd" | "background" | "resume", text: string): void {
  const inputs = readInputs(id);
  const old = inputs[role];
  if (old.trim()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(path.join(targetDir(id), "inputs", "versions"), { recursive: true });
    fs.writeFileSync(path.join(targetDir(id), "inputs", "versions", `${role}-${stamp}.txt`), old, "utf8");
  }
  inputs[role] = text;
  inputs.updatedAt = new Date().toISOString();
  writeJson(path.join(targetDir(id), "inputs.json"), inputs);
}

export function listInputVersions(id: string): { file: string; role: string; at: string }[] {
  const dir = path.join(targetDir(id), "inputs", "versions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .reverse()
    .map((f) => ({ file: f, role: f.split("-")[0], at: f.replace(/\.txt$/, "") }));
}

export function readBank(id: string): Bank {
  const bank =
    readJson<Bank>(path.join(targetDir(id), "bank.json")) ?? {
      questions: [],
      version: 1,
    };
  // 批准制 → 锁定制迁移：老数据里 approved 的题在读取时转为 locked（锁定语义 = AI 重新生成时不动它）
  let migrated = false;
  for (const q of bank.questions) {
    if (q.status === "approved" && !q.locked) {
      q.locked = true;
      migrated = true;
    }
  }
  if (migrated) writeBank(id, bank);
  return bank;
}

export function writeBank(id: string, bank: Bank): void {
  writeJson(path.join(targetDir(id), "bank.json"), bank);
}

export function readProgress(id: string): Progress {
  return readJson<Progress>(path.join(targetDir(id), "progress.json")) ?? {
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

// ---------- 试卷缓存（模拟面试出卷；键 = 时长 + 拆解版本） ----------

export function paperKey(minutes: number, analysisVersion: string): string {
  return `${minutes > 0 ? minutes : "open"}-${analysisVersion.replace(/[:.]/g, "-")}.json`;
}

export function readPaper(id: string, key: string): Paper | undefined {
  if (!/^[\w-]+\.json$/.test(key)) return undefined;
  return readJson<Paper>(path.join(targetDir(id), "papers", key));
}

export function writePaper(id: string, key: string, paper: Paper): void {
  writeJson(path.join(targetDir(id), "papers", key), paper);
}

// ---------- Sessions ----------

export function createSession(session: PracticeSession): void {
  writeJson(path.join(targetDir(session.targetId), "sessions", `${session.id}.json`), session);
}

export function readSession(targetId: string, sessionId: string): PracticeSession | undefined {
  const s = readJson<PracticeSession>(path.join(targetDir(targetId), "sessions", `${sessionId}.json`));
  if (!s) {
    // 临时诊断：陪练 404 案——打印请求的 id/sid 与当时磁盘上真实存在的场次
    const dir = path.join(targetDir(targetId), "sessions");
    console.error(
      "[readSession MISS]",
      JSON.stringify(targetId),
      sessionId,
      "dirExists:",
      fs.existsSync(dir),
      fs.existsSync(dir) ? fs.readdirSync(dir).sort().join(",") : "-",
    );
  }
  return s;
}

export function writeSession(session: PracticeSession): void {
  createSession(session);
}

export function listSessions(targetId: string): SessionSummary[] {
  const dir = path.join(targetDir(targetId), "sessions");
  if (!fs.existsSync(dir)) return [];
  const out: SessionSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    const s = readJson<PracticeSession>(path.join(dir, f));
    if (s) {
      out.push({
        id: s.id,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        overall: s.scorecard?.overall,
        mode: s.mode,
        questionIds: s.questions.map((q) => q.id),
        active: s.turns.some(
          (t) => t.answer.trim() || (t.chat?.length ?? 0) > 0 || t.followUpQA.length > 0,
        ),
      });
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function appendProgress(targetId: string, sc: PracticeSession["scorecard"], sessionId: string): void {
  if (!sc) return;
  const p = readProgress(targetId);
  p.history.push({
    sessionId,
    date: new Date().toISOString(),
    overall: sc.overall,
    content: sc.dimensions.content.score,
    structure: sc.dimensions.structure.score,
    language: sc.dimensions.language.score,
    timing: sc.dimensions.timing.score,
  });
  p.updatedAt = new Date().toISOString();
  writeJson(path.join(targetDir(targetId), "progress.json"), p);
}

export function readBundle(id: string): TargetBundle | undefined {
  ensureData();
  const meta = readMeta(id);
  if (!meta) return undefined;
  return {
    meta,
    inputs: readInputs(id),
    analysis: readAnalysis(id),
    bank: readBank(id),
    progress: readProgress(id),
    sessions: listSessions(id),
  };
}
