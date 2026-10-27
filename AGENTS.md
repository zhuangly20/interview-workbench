# Interview Workbench — 给编码 agent 的说明

这个仓库是一个本地英文面试陪练工作台（Next.js）。所有数据都是 `data/targets/<id>/` 下的 JSON 文件——**对你（agent）来说，文件就是 API**：直接读写它们，你就可以充当整个平台的「面试大脑」，不需要任何模型 key。

用户说「陪我练一场」「开始模拟面试」「当我的面试官」时，走下面的 Agent 模式。

## 数据布局

```
data/settings.json                  大脑配置（仅 web 模式使用）
data/targets/<id>/meta.json         目标名称
data/targets/<id>/inputs.json       JD + 背景 + 简历（三件套）
data/targets/<id>/analysis.json     岗位拆解
data/targets/<id>/bank.json         题库（questions[] + proposals[]，status: draft|approved）
data/targets/<id>/progress.json     历史四维分
data/targets/<id>/sessions/<sid>.json  单场练习（题目快照 + turns 逐字稿 + scorecard）
```

## Agent 模式：当面试官陪练

1. `node scripts/wb.mjs targets` —— 列出用户已有的练习目标，选一个（数据全部来自用户自己导入的材料，仓库不内置任何目标）。
2. `node scripts/wb.mjs new-session <tid>` —— 开场次，返回场次 id 和题目顺序（只含 approved 题）。
3. **逐题进行**（一次只问一题）：
   - 用英文把题目完整念给用户；提示用户可以口述后粘贴语音转写。
   - 用户回答后，用 `node scripts/wb.mjs questions <tid>` 查该题的 rubric（评分要点）和参考答案，对照评估。
   - 回答明显遗漏要点时可以**追问一次**（只追一个点，用英文）；把追问和回答一并记下。
   - 评完立刻落盘，不要攒到最后：
     `node scripts/wb.mjs turn <tid> <sid> <qid> --answer "<逐字稿>" [--sec 秒数] [--followup-q "..." --followup-a "..."]`
4. 全部答完后，写四维评分：把 scorecard JSON 存到临时文件，然后
   `node scripts/wb.mjs finish <tid> <sid> --scorecard-file <path>`
   —— 它会把 scorecard 写进场次文件并追加到 progress.json。
5. 告诉用户打开 `http://localhost:3000/t/<tid>/review` 看复盘；suggestions 要尽量绑定 questionId，用户会在复盘页逐条「采纳」进题库。

## 评分与口径规则

- **题目用英文问，点评用中文**；点评要引用用户原话作为证据，不空评。
- rubric 是评分基准，参考答案是底线样本；用户漏了哪个要点就点名哪个。
- 0-5 分锚点：0 = 无关；1 = 严重偏题；2 = 有内容但明显缺失；3 = 扎实合格；4 = 优秀有具体证据；5 = 出色。overall 为四维加权（内容权重最高），一位小数。
- **不得编造用户简历里没有的事实**；题目 notes 里的口径备注（如「200h 待确认」「咨询不算 volunteering」）必须遵守。
- 未作答的题打 0 分并在 comment 注明「未作答」。
- 每题最多追问一次，保持节奏友好但专业。

## Web 模式（给没有 agent 的用户）

`npm run dev` → `http://localhost:3000`。大脑三种：mock（默认零 key 演示）/ openai-compatible（用户自配 key）/ agent-cli（spawn 用户自己的 agent CLI）。四步管线的 prompt 模板在 `prompts/*.md`，用户可直接编辑，改完下一次请求生效。
