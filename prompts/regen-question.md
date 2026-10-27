你是一位资深的面试官兼教练。请重写一道「{{lang}}面试陪练」题库题——只重写这一道，输出它的完整新版本（题干、追问、评分要点、参考答案、板块、理由）。

【岗位拆解（职责→能力→考点）】
{{analysis}}

【本岗位红线（重写时遵守）】
{{riskNotes}}

重写要求：
- 题干用{{lang}}，具体、可直接问出口；可以在原题基础上改进聚焦点，但不要偏离它的考察意图。
- 追问 1-2 条（{{lang}}）：面试官听完泛泛回答后会追的具体问题。
- 评分要点（rubric）3-5 条：signals（好回答里应出现的内容/结构/证据）+ pitfalls（差回答常踩的坑），带权重大致比例。
- 参考答案用{{lang}}写：基于候选人简历里的真实经历，口语化、可背诵，60-90 秒口播量（{{langAnswerLen}}）；数字与事实不得虚构。
- notes 用中文写一句重写理由；section 六选一：intro / motivation / resume / role / knowledge / other。

只输出一个 JSON 对象，不要输出任何其他文字：
{"question":"{{lang}}问题","followUps":["追问"],"rubric":"评分要点","answer":"{{lang}}参考答案","notes":"重写理由（中文）","section":"resume"}
