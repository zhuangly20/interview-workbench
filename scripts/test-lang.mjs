// 语言功能 e2e：创建路径（自动猜/手动指定）+ 真实大脑中文出题与追问
const BASE = "http://localhost:3000";

const zhJd = `岗位职责：
- 负责联合国儿童基金会在华青少年数字素养项目的日常协调与执行
- 起草项目进度报告、简报与对外材料，确保事实准确
- 与合作伙伴、学校和教育部门沟通，组织培训与交流活动
任职要求：
- 本科以上学历，教育、公共管理、社会学等相关专业
- 优秀的中文写作能力，熟练使用办公软件
- 有志愿服务或项目执行经验者优先`;

const enJd = `Responsibilities:
- Support daily coordination of digital literacy programmes for adolescents
- Draft progress reports and briefing notes with accuracy
- Liaise with partners, schools and education authorities
Requirements:
- Bachelor degree in education, public administration or related fields
- Excellent English writing skills`;

function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function j(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// 1. 中文 JD 不传 language → 自动判 zh
let r = await j(`${BASE}/api/targets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "语言测试-自动猜中文", jd: zhJd }),
});
check("中文 JD 自动猜 zh", r.body.meta?.language === "zh", `got ${r.body.meta?.language}`);
const autoZhId = r.body.meta?.id;

// 2. 英文 JD 不传 language → 自动判 en
r = await j(`${BASE}/api/targets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "语言测试-自动猜英文", jd: enJd }),
});
check("英文 JD 自动猜 en", r.body.meta?.language === "en", `got ${r.body.meta?.language}`);
const autoEnId = r.body.meta?.id;

// 3. 中文 JD 但用户手动指定 en → 尊重用户
r = await j(`${BASE}/api/targets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "语言测试-手动指定", jd: zhJd, language: "en" }),
});
check("手动指定覆盖猜测", r.body.meta?.language === "en", `got ${r.body.meta?.language}`);
const manualId = r.body.meta?.id;

// 清掉三个只测创建的目标
for (const id of [autoZhId, autoEnId, manualId]) {
  await fetch(`${BASE}/api/targets/${id}`, { method: "DELETE" });
}

// 4. 真实大脑：建一个中文目标，直接出题（不拆解，走「直接根据 JD 判断」分支）
const zhTarget = `职责：
- 支持青少年数字素养项目的日常协调，起草进度报告与简报
- 组织合作伙伴培训，维护项目档案
- 汇总项目数据，撰写月度总结
要求：
- 教育或公共管理相关专业，中文写作扎实
- 有志愿服务或项目执行经验`;

r = await j(`${BASE}/api/targets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "中文陪练端到端", jd: zhTarget, language: "zh" }),
});
const tid = r.body.meta?.id;
console.log("目标:", tid, "language:", r.body.meta?.language);

console.log("出题中（真实大脑，约 1-2 分钟）…");
r = await j(`${BASE}/api/targets/${tid}/bank/generate`, { method: "POST" });
if (r.status !== 200) {
  console.log("出题失败", r.status, JSON.stringify(r.body).slice(0, 500));
  process.exit(1);
}
const qs = r.body.proposals ?? [];
const allZh = qs.length > 0 && qs.every((q) => /[\u4e00-\u9fff]/.test(q.question));
check(`出题 ${qs.length} 条且题干全为中文`, allZh, qs.map((q) => q.question).join(" | ").slice(0, 200));
const answersZh = qs.every((q) => /[\u4e00-\u9fff]/.test(q.answer));
check("参考答案为中文", answersZh);

// 5. 中文追问：采纳第一题提案 → 批准为 approved → 开场次 → 给一个泛泛的回答
const q0 = qs[0];
r = await j(`${BASE}/api/targets/${tid}/bank/proposal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "accept", ids: [q0.id] }),
});
check("提案已采纳进题库", r.status === 200);
r = await j(`${BASE}/api/targets/${tid}/bank`);
const bank = r.body.bank;
bank.questions.find((q) => q.id === q0.id).status = "approved";
r = await j(`${BASE}/api/targets/${tid}/bank`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bank }),
});
check("已批准", r.status === 200);
r = await j(`${BASE}/api/targets/${tid}/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const sid = r.body.session?.id;
console.log("场次:", sid);

console.log("陪练 turn（真实大脑，约 1 分钟）…");
r = await j(`${BASE}/api/targets/${tid}/sessions/${sid}/turn`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ questionId: q0.id, answer: "我之前参与过一些志愿服务活动，做了很多协调和沟通的工作，也写过一些报告和材料，积累了不少经验，学到了很多东西。", durationSec: 45 }),
});
if (r.status !== 200) {
  console.log("turn 失败", r.status, JSON.stringify(r.body).slice(0, 500));
  process.exit(1);
}
console.log("决策:", r.body.action, "| 追问:", r.body.followUp);
check(
  "泛泛回答触发追问且追问为中文",
  r.body.action === "followup" && /[\u4e00-\u9fff]/.test(r.body.followUp ?? ""),
);

// 6. 清理：删除测试目标
const del = await fetch(`${BASE}/api/targets/${tid}`, { method: "DELETE" });
check("测试目标已删除", del.ok);
