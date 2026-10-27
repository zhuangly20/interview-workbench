import { NextResponse } from "next/server";
import { getSettings } from "@/lib/store";
import { invokeRtcApi, missingVoiceCredentials } from "@/lib/voice/rtcApi";

interface StopBody {
  appId?: string;
  roomId?: string;
  taskId?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as StopBody;
  if (!body.appId || !body.roomId || !body.taskId) {
    return NextResponse.json({ error: "缺少 appId / roomId / taskId" }, { status: 400 });
  }
  const v = getSettings().voice.volcengine;
  const missing = missingVoiceCredentials(v);
  if (missing.length) {
    return NextResponse.json({ error: `火山语音未配置：${missing.join("、")}` }, { status: 400 });
  }

  try {
    await invokeRtcApi(
      { accessKeyId: v.accessKeyId, secretKey: v.secretKey },
      "StopVoiceChat",
      { AppId: body.appId, RoomId: body.roomId, TaskId: body.taskId },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 任务已停/不存在视为成功（重复 stop、宽限期过期等场景）
    const message = e instanceof Error ? e.message : "StopVoiceChat 调用失败";
    return NextResponse.json({ ok: false, error: message });
  }
}
