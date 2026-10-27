import { NextResponse } from "next/server";
import { getSettings, newId } from "@/lib/store";
import { createRtcToken } from "@/lib/voice/token";
import { buildStartVoiceChatBody, invokeRtcApi, missingVoiceCredentials } from "@/lib/voice/rtcApi";

/** 语音模式就绪自检：只查六项配置是否填齐，不发起任何网络调用、零费用。
 * 真正的音色连通用 POST（试音）实测。 */
export async function GET() {
  const v = getSettings().voice.volcengine;
  const need: [keyof typeof v, string][] = [
    ["appId", "RTC AppId"],
    ["appKey", "RTC AppKey"],
    ["accessKeyId", "API 访问密钥 AK"],
    ["secretKey", "API 访问密钥 SK"],
    ["llmModel", "语音模型（豆包）"],
    ["voiceType", "音色 voice_type"],
  ];
  const missing = need.filter(([k]) => !v[k]?.trim()).map(([, label]) => label);
  return NextResponse.json({ ok: missing.length === 0, missing });
}

/** 试音：起一个最小 AIGC 任务（只播一句固定开场白），返回进房信息；
 * 前端进房实测振幅、无论结果如何都要调 POST /api/voice/stop 收尾。一次试音约 15 秒。 */
export async function POST(req: Request) {
  const { voiceType } = (await req.json()) as { voiceType?: string };
  const v = getSettings().voice.volcengine;
  const missing = missingVoiceCredentials(v);
  if (missing.length) {
    return NextResponse.json({ error: `火山语音未配置，请在设置页补齐：${missing.join("、")}` }, { status: 400 });
  }
  const speaker = voiceType?.trim() || v.voiceType;

  const roomId = `wb_${newId("r").slice(2)}`;
  const userId = `u_${newId("u").slice(2)}`;
  const taskId = `task_${newId("t").slice(2)}`;
  try {
    await invokeRtcApi(
      { accessKeyId: v.accessKeyId, secretKey: v.secretKey },
      "StartVoiceChat",
      buildStartVoiceChatBody({
        appId: v.appId,
        roomId,
        taskId,
        agentUserId: "interviewer",
        targetUserId: userId,
        // 只当探针：播完开场白就闭嘴，避免 LLM 自说自话拉长计费
        systemMessage:
          "You are a voice connectivity probe. Say the welcome sentence exactly, then stay silent. Never answer or ask anything.",
        welcomeMessage: "你好，这是一次语音连通测试。",
        llmModel: v.llmModel,
        voiceType: speaker,
        historyLength: 2,
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "StartVoiceChat 调用失败" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    appId: v.appId,
    roomId,
    userId,
    taskId,
    token: createRtcToken(v.appId, v.appKey, roomId, userId),
  });
}
