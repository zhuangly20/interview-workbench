// 火山引擎 OpenAPI 调用器：用 @volcengine/openapi 的 Signer 做 v4 签名，
// 调 StartVoiceChat / StopVoiceChat（参考官方 rtc-aigc-demo/server/app.js）。

// CJS 兼容导入（Signer 是 CommonJS 导出）
import openapiPkg from "@volcengine/openapi";
import type { Settings } from "@/lib/types";

const { Signer } = openapiPkg as unknown as {
  Signer: new (requestData: Record<string, unknown>, service: string) => {
    addAuthorization: (cred: { accessKeyId: string; secretKey: string }) => void;
  };
};

const RTC_ENDPOINT = "https://rtc.volcengineapi.com";
const RTC_REGION = "cn-north-1";
const RTC_SERVICE = "rtc";
const RTC_API_VERSION = "2025-06-01";

export type VolcVoiceConfig = NonNullable<Settings["voice"]["volcengine"]>;

export function missingVoiceCredentials(v: Partial<VolcVoiceConfig> | undefined): string[] {
  const need: [keyof VolcVoiceConfig, string][] = [
    ["appId", "RTC AppId"],
    ["appKey", "RTC AppKey"],
    ["accessKeyId", "API 访问密钥 AK"],
    ["secretKey", "API 访问密钥 SK"],
  ];
  return need.filter(([k]) => !v?.[k]?.trim()).map(([, label]) => label);
}

/** 签名并调用 RTC OpenAPI；返回解析后的 JSON。失败时抛错（含服务端 Error 信息）。 */
export async function invokeRtcApi(
  cred: { accessKeyId: string; secretKey: string },
  action: "StartVoiceChat" | "StopVoiceChat",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestData = {
    region: RTC_REGION,
    method: "POST",
    params: { Action: action, Version: RTC_API_VERSION },
    headers: {
      Host: new URL(RTC_ENDPOINT).host,
      "Content-type": "application/json",
    },
    body,
  };
  const signer = new Signer(requestData, RTC_SERVICE);
  signer.addAuthorization(cred);

  const url = new URL(RTC_ENDPOINT);
  url.searchParams.set("Action", action);
  url.searchParams.set("Version", RTC_API_VERSION);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: requestData.headers,
      body: JSON.stringify(body),
      // 火山接口万一不响应，15 秒兜底，别让语音启动请求无限挂着
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
      Result?: unknown;
    };
    const err = data.ResponseMetadata?.Error;
    if (err) {
      throw new Error(`火山 OpenAPI ${action} 失败: ${err.Code ?? ""} ${err.Message ?? ""}`.trim());
    }
    return data as Record<string, unknown>;
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error("火山 OpenAPI 15 秒无响应（连接超时），请检查网络后重试");
    }
    throw e;
  }
}

export interface StartVoiceChatOptions {
  appId: string;
  roomId: string;
  taskId: string;
  /** AI 在房间里的 UserId */
  agentUserId: string;
  /** 用户（候选人）进房 UserId */
  targetUserId: string;
  /** 面试官协议（整段作为 SystemMessage） */
  systemMessage: string;
  /** 进房即播报的开场白（直接 TTS，不走 LLM）——我们用题目原文 */
  welcomeMessage: string;
  llmModel: string;
  voiceType: string;
  /** 静默判定毫秒数（默认 800，面试思考停顿；压力面传更小值让 AI 反应更快） */
  silenceMs?: number;
  /** 房间 LLM 的对话记忆轮数（默认 6；整场连续面试要记住前面所有问答，传更大值） */
  historyLength?: number;
}

/**
 * 组装 StartVoiceChat 请求体。
 * 结构以控制台智能体「代码示例」生成的请求体为基准（模块化方案：
 * 火山 ASR(bigmodel) + 方舟豆包 LLM + 火山双向流式 TTS，公共模型资源）。
 * 与控制台默认值的刻意偏差（均为文档允许的调参，非结构差异）：
 * - VADConfig.SilenceTime 800（面试允许思考停顿，控制台 600）
 * - LLM Temperature 0.4 / TopP 0.5 / HistoryLength 6 / MaxTokens 200
 *   （面试官每轮应短且稳定，也压 TTS 成本；任务按题创建，上下文本就不长）
 * - EnableConversationStateCallback true（前端状态指示灯需要 Stage 回调）
 */
export function buildStartVoiceChatBody(o: StartVoiceChatOptions): Record<string, unknown> {
  return {
    AppId: o.appId,
    RoomId: o.roomId,
    TaskId: o.taskId,
    Config: {
      ASRConfig: {
        Provider: "volcano",
        ProviderParams: {
          Mode: "bigmodel",
          Credential: { ApiResourceId: "volc.bigasr.sauc.duration" },
        },
        VADConfig: {
          SilenceTime: o.silenceMs ?? 800,
        },
        InterruptConfig: { InterruptKeywords: [] },
      },
      LLMConfig: {
        Mode: "ArkV3",
        ModelName: o.llmModel,
        SystemMessages: [o.systemMessage],
        ThinkingType: "disabled",
        Prefill: false,
        VisionConfig: {},
        HistoryLength: o.historyLength ?? 6,
        Temperature: 0.4,
        MaxTokens: 200,
        TopP: 0.5,
      },
      TTSConfig: {
        Provider: "volcano_bidirection",
        ProviderParams: {
          Credential: { ResourceId: "seed-tts-1.0" },
          VolcanoTTSParameters: JSON.stringify({
            req_params: {
              speaker: o.voiceType,
              audio_params: { speech_rate: 0, loudness_rate: 0 },
              additions: { post_process: { pitch: 0 } },
            },
          }),
        },
      },
      SubtitleConfig: { SubtitleMode: 1 },
      InterruptMode: 0,
      FunctionCallingConfig: {},
      WebSearchAgentConfig: {},
      MemoryConfig: {},
      MusicAgentConfig: {},
    },
    AgentConfig: {
      TargetUserId: [o.targetUserId],
      UserId: o.agentUserId,
      WelcomeMessage: o.welcomeMessage,
      EnableConversationStateCallback: true,
      VoicePrint: { Mode: 0 },
    },
  };
}
