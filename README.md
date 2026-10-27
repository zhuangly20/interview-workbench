# Interview Workbench · AI 面试陪练工作台

把岗位 JD、行业背景、个人简历三份材料，变成一套完整的面试准备系统：**岗位拆解 → 定制题库 → AI 陪练 / 全场模拟 → 评分复盘**。中英双语，全部数据只存在你自己的电脑上。

## 它能做什么

- **材料导入**：三件套（JD / 行业背景 / 简历）拖文件、拖整个文件夹或直接粘贴，支持 PDF / Word / txt / md
- **岗位拆解**：职责 → 能力 → 考察点映射，每张卡带简历匹配度（高/中/低）与匹配理由；提示词可 DIY，可单卡重跑、版本回滚
- **定制题库**：按拆解结果批量出题（每题带考察点与参考答案），自动分批补到 50 道；只加新题不覆盖现有题；支持手动加题、改题、排序、删除，可导出 Markdown
- **单题陪练**：教练式引导把一道题的得分点说全，跨场次记住练过什么，结束后可让 AI 起草参考答案
- **全场模拟**：从题库抽题秒开，可选时长（15/30/45/60 分钟）与面试官风格（标准 / 压力 / 温和 / 鼓励）；文字问答或整场连续语音通话，面试官自动追问、把控时间、说结束语自动挂断；逐字稿自动按题切分
- **评分复盘**：整体五维评分（内容/结构/语言/节奏/应变）+ 板块热力图 + 逐题漏掉要点，可回看每场记录
- **双语**：创建目标时选定中文或英文面试，题目、追问、语音、评分全跟随

## 快速开始

需要 Node.js ≥ 20。

```bash
git clone https://github.com/zhuangly20/interview-workbench.git
cd interview-workbench
npm install
npm run dev
```

打开 http://localhost:3000 即可。默认使用内置「模拟数据」模式，**不需要任何 API key** 就能走通全部流程——适合先体验再决定是否接自己的模型。

生产运行用 `npm run build && npm run start`。

## 接入真实模型（推荐）

模拟数据只能验证流程，真实的出题、追问与评分需要一个 OpenAI 兼容的对话模型（智谱 GLM、DeepSeek、或任何 openai-compatible 网关均可）：

1. 打开「模型设置」页
2. 模型服务选「OpenAI 兼容接口」
3. 填入 Base URL、API Key、模型名，保存后自动做连通自检

Key 只保存在本机 `data/settings.json`（已被 `.gitignore` 排除），不会进入 git，也不会上传。

## 语音面试（可选）

语音模式基于火山引擎「AI 音视频互动」方案，需要在火山控制台开通后填入 4 项凭证：RTC AppId、RTC AppKey、API 访问密钥 AK / SK。设置页支持选择音色、就绪自检与试音。未配置时语音入口会给出引导，文字模式完全不受影响。语音按火山官方计费（约 12 元/百万 tokens，按量后付费）。

## 数据与隐私

- 所有材料、题库、练习记录都在 `data/targets/<id>/` 目录下，文件即真相：直接备份、修改、删除目录即可
- API Key 等敏感配置只在本机 `data/settings.json`，`data/` 整体被 `.gitignore` 排除，不会进入 git
- 删除练习目标会连带删除其全部题库与记录（界面有二次确认）

## 进阶：让编码 Agent 当大脑

除了在设置页填 API，你也可以让自己的编码 Agent 直接驱动陪练：`scripts/wb.mjs` 提供读写 `data/` 的完整命令集，`AGENTS.md` 是面试官行为协议，两者配合即可在无任何 API key 的情况下跑通闭环。

## 技术栈与致谢

Next.js 15（App Router）+ TypeScript + Tailwind，无数据库。所有提示词模板在 `prompts/*.md`，可直接编辑。

架构与提示词设计参考了 [DeepInterview](https://github.com/ngoanpv/DeepInterview)（Apache-2.0），在此致谢。
