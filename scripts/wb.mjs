#!/usr/bin/env node
// wb.mjs — agent 驱动模式的命令行。
// 让编码 agent（ZCode / Codex / Claude Code…）直接以 data/ 下的 JSON 文件为 API
// 充当面试大脑：开场次、落逐字稿、写评分，全程不需要任何模型 key。
// 用法见仓库根目录 AGENTS.md。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
};
const targetDir = (id) => path.join(DATA_DIR, "targets", id);
const out = (v) => console.log(JSON.stringify(v, null, 2));
const die = (msg) => {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

function readTarget(tid) {
  const dir = targetDir(tid);
  if (!fs.existsSync(path.join(dir, "meta.json"))) die(`目标不存在：${tid}`);
  return dir;
}

function readBank(tid) {
  return readJson(path.join(readTarget(tid), "bank.json"));
}

function readSession(tid, sid) {
  const file = path.join(targetDir(tid), "sessions", `${sid}.json`);
  if (!fs.existsSync(file)) die(`场次不存在：${sid}`);
  return { file, session: readJson(file) };
}

const [cmd, ...positional] = process.argv.slice(2);

switch (cmd) {
  case "targets": {
    const root = path.join(DATA_DIR, "targets");
    const targets = fs.existsSync(root)
      ? fs
          .readdirSync(root)
          .map((id) => {
            const f = path.join(root, id, "meta.json");
            return fs.existsSync(f) ? readJson(f) : null;
          })
          .filter(Boolean)
      : [];
    out({ targets });
    break;
  }

  case "questions": {
    const [tid] = positional;
    if (!tid) die("用法：questions <targetId> [--approved]");
    const bank = readBank(tid);
    const onlyApproved = process.argv.includes("--approved");
    const questions = onlyApproved
      ? bank.questions.filter((q) => q.status === "approved")
      : bank.questions;
    out({ questions, proposals: bank.proposals.length });
    break;
  }

  case "new-session": {
    const [tid] = positional;
    if (!tid) die("用法：new-session <targetId>");
    const bank = readBank(tid);
    const approved = bank.questions.filter((q) => q.status === "approved");
    if (approved.length === 0) die("题库里没有 approved 题目");
    const session = {
      id: `s_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
      targetId: tid,
      startedAt: new Date().toISOString(),
      questions: approved.map((q) => ({ id: q.id, question: q.question })),
      turns: [],
    };
    writeJson(path.join(targetDir(tid), "sessions", `${session.id}.json`), session);
    out({ id: session.id, count: session.questions.length, questions: session.questions });
    break;
  }

  case "session": {
    const [tid, sid] = positional;
    if (!tid || !sid) die("用法：session <targetId> <sessionId>");
    out(readSession(tid, sid).session);
    break;
  }

  case "turn": {
    const [tid, sid, qid] = positional;
    if (!tid || !sid || !qid) die("用法：turn <targetId> <sessionId> <questionId> --answer \"...\" [--sec N] [--followup-q \"...\" --followup-a \"...\"]");
    const { file, session } = readSession(tid, sid);
    if (session.finishedAt) die("本场已结束");
    const snapshot = session.questions.find((q) => q.id === qid);
    if (!snapshot) die(`题目 ${qid} 不在本场清单里`);
    const answer = arg("--answer") ?? "";
    const sec = arg("--sec") ? Number(arg("--sec")) : undefined;
    const fq = arg("--followup-q");
    const fa = arg("--followup-a");

    let turn = session.turns.find((t) => t.questionId === qid);
    if (!turn) {
      turn = { questionId: qid, question: snapshot.question, answer: "", followUpQA: [] };
      session.turns.push(turn);
    }
    if (answer) turn.answer = answer;
    if (sec !== undefined && Number.isFinite(sec)) turn.durationSec = sec;
    if (fq) turn.followUpQA.push({ q: fq, a: fa ?? "" });
    writeJson(file, session);
    out({ ok: true, turnsRecorded: session.turns.length });
    break;
  }

  case "finish": {
    const [tid, sid] = positional;
    if (!tid || !sid) die("用法：finish <targetId> <sessionId> --scorecard-file <path> （或 --scorecard '<json>'）");
    const { file, session } = readSession(tid, sid);
    if (session.scorecard) die("本场已有评分");
    if (session.turns.length === 0) die("本场没有任何回答，无法评分");

    const rawText = arg("--scorecard-file")
      ? fs.readFileSync(arg("--scorecard-file"), "utf8")
      : arg("--scorecard");
    if (!rawText) die("缺少 --scorecard-file 或 --scorecard");
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end <= start) die("scorecard 里没有找到 JSON 对象");
    const raw = JSON.parse(rawText.slice(start, end + 1));

    const known = new Set(session.questions.map((q) => q.id));
    const dim = (k) => {
      const d = raw?.dimensions?.[k] ?? {};
      return { score: Number(d.score) || 0, comment: String(d.comment ?? "") };
    };
    const scorecard = {
      overall: Math.round((Number(raw.overall) || 0) * 10) / 10,
      dimensions: {
        content: dim("content"),
        structure: dim("structure"),
        language: dim("language"),
        timing: dim("timing"),
      },
      perQuestion: (Array.isArray(raw.perQuestion) ? raw.perQuestion : [])
        .map((p) => ({
          questionId: String(p.questionId ?? ""),
          score: Number(p.score) || 0,
          comment: String(p.comment ?? ""),
        }))
        .filter((p) => known.has(p.questionId)),
      strengths: (Array.isArray(raw.strengths) ? raw.strengths : []).map(String),
      suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : [])
        .map((s) => ({
          questionId: typeof s.questionId === "string" && known.has(s.questionId) ? s.questionId : null,
          text: String(s.text ?? ""),
          applied: false,
        }))
        .filter((s) => s.text),
      summary: String(raw.summary ?? ""),
      generatedAt: new Date().toISOString(),
    };

    session.scorecard = scorecard;
    session.finishedAt = new Date().toISOString();
    writeJson(file, session);

    const progressFile = path.join(targetDir(tid), "progress.json");
    const progress = fs.existsSync(progressFile)
      ? readJson(progressFile)
      : { updatedAt: new Date().toISOString(), history: [] };
    progress.history.push({
      sessionId: session.id,
      date: session.finishedAt,
      overall: scorecard.overall,
      content: scorecard.dimensions.content.score,
      structure: scorecard.dimensions.structure.score,
      language: scorecard.dimensions.language.score,
      timing: scorecard.dimensions.timing.score,
    });
    progress.updatedAt = session.finishedAt;
    writeJson(progressFile, progress);
    out({ ok: true, overall: scorecard.overall, perQuestion: scorecard.perQuestion.length, suggestions: scorecard.suggestions.length });
    break;
  }

  default:
    die(
      "未知命令。可用：targets / questions <tid> [--approved] / new-session <tid> / session <tid> <sid> / turn <tid> <sid> <qid> ... / finish <tid> <sid> --scorecard-file <path>",
    );
}
