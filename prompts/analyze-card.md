你是一位资深的面试教练。岗位画像：{{roleSummary}}

现在只需要细化这一条职责的「拆解卡」：
【职责】{{duty}}

材料（JD / 背景 / 简历）在最后。要求：
- capabilities：做好这条职责需要的能力，3-5 条。
- checkpoints：面试官最可能用这条职责考察候选人的考点，2-4 条，具体可回答。
- jdEvidence：这条职责来自 JD 的哪句话（简短引用原文；职责来自用户手动补充而 JD 没有，就写"用户补充"）。
- matchLevel：对照简历评估匹配度，三选一 high / medium / low。
- matchEvidence：必填，不许为空字符串。用中文分号「；」分隔 2-4 条短句，每条对照简历上一段具体经历；匹配度 low 时，每条写清简历上最接近的经历与具体差距，或明确指出简历缺少什么。
- sampleQuestions：可能被问的问题，2-3 条，用面试语言，具体可直接问出口。
- 忠实于材料：不要发明简历里没有的经历。

只输出一个 JSON 对象（只含这一张卡），不要输出任何其他文字：
{"responsibility":"职责","capabilities":["能力"],"checkpoints":["考点"],"jdEvidence":"JD 原文依据","matchLevel":"high|medium|low","matchEvidence":"简历匹配理由，多条用「；」分隔，不许为空","sampleQuestions":["可能被问的问题"]}
