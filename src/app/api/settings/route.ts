import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/store";
import type { ProviderKind, Settings } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<Settings>;
  const current = getSettings();
  const next: Settings = {
    provider: (["mock", "openai-compatible", "agent-cli"] as ProviderKind[]).includes(
      body.provider as ProviderKind,
    )
      ? (body.provider as ProviderKind)
      : current.provider,
    openai: {
      baseUrl: body.openai?.baseUrl ?? current.openai.baseUrl,
      apiKey: body.openai?.apiKey ?? current.openai.apiKey,
      model: body.openai?.model ?? current.openai.model,
    },
    agentCli: {
      command: body.agentCli?.command ?? current.agentCli.command,
      timeoutSec: body.agentCli?.timeoutSec ?? current.agentCli.timeoutSec,
    },
    voice: {
      ttsEnabled: body.voice?.ttsEnabled ?? current.voice.ttsEnabled,
      sttEnabled: body.voice?.sttEnabled ?? current.voice.sttEnabled,
      volcengine: {
        appId: body.voice?.volcengine?.appId ?? current.voice.volcengine.appId,
        appKey: body.voice?.volcengine?.appKey ?? current.voice.volcengine.appKey,
        accessKeyId: body.voice?.volcengine?.accessKeyId ?? current.voice.volcengine.accessKeyId,
        secretKey: body.voice?.volcengine?.secretKey ?? current.voice.volcengine.secretKey,
        llmModel: body.voice?.volcengine?.llmModel ?? current.voice.volcengine.llmModel,
        voiceType: body.voice?.volcengine?.voiceType ?? current.voice.volcengine.voiceType,
      },
    },
  };
  saveSettings(next);
  return NextResponse.json({ settings: next });
}
