// RTC 进房 Token 签发 —— 移植自火山引擎官方示例 rtc-aigc-demo/server/token.js
// 原始代码 Copyright 2025 Beijing Volcano Engine Technology Co., Ltd. (BSD-3-Clause)
// 仅保留签发路径：ByteBuf 序列化 + HMAC-SHA256 签名 + "001" 前缀，算法与官方一致。

import crypto from "node:crypto";

export const privileges = {
  PrivPublishStream: 0,
  privPublishAudioStream: 1,
  privPublishVideoStream: 2,
  privPublishDataStream: 3,
  PrivSubscribeStream: 4,
} as const;

const VERSION = "001";

class ByteBuf {
  private buffer = Buffer.alloc(1024);
  private position = 0;

  pack(): Buffer {
    const out = Buffer.alloc(this.position);
    this.buffer.copy(out, 0, 0, out.length);
    return out;
  }
  putUint16(v: number): this {
    this.buffer.writeUInt16LE(v, this.position);
    this.position += 2;
    return this;
  }
  putUint32(v: number): this {
    this.buffer.writeUInt32LE(v, this.position);
    this.position += 4;
    return this;
  }
  putBytes(bytes: Buffer): this {
    this.putUint16(bytes.length);
    bytes.copy(this.buffer, this.position);
    this.position += bytes.length;
    return this;
  }
  putString(str: string): this {
    return this.putBytes(Buffer.from(str));
  }
  putTreeMapUInt32(map: Record<number, number>): this {
    const keys = Object.keys(map ?? {});
    this.putUint16(keys.length);
    for (const k of keys) {
      this.putUint16(Number(k));
      this.putUint32(map[Number(k)]);
    }
    return this;
  }
}

function hmac(key: string, message: Buffer): Buffer {
  return crypto.createHmac("sha256", key).update(message).digest();
}

/**
 * 生成 RTC 正式 Token：进房用的 roomId/userId 必须与此处一致，否则进房失败。
 * expireSec 相对当前时间的秒数，建议 24h。
 */
export function createRtcToken(
  appId: string,
  appKey: string,
  roomId: string,
  userId: string,
  expireSec = 24 * 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const privilegesMap: Record<number, number> = {};
  // 发布 + 订阅权限；0 表示权限随主 expireTime 过期
  privilegesMap[privileges.PrivSubscribeStream] = 0;
  privilegesMap[privileges.PrivPublishStream] = 0;
  privilegesMap[privileges.privPublishAudioStream] = 0;
  privilegesMap[privileges.privPublishVideoStream] = 0;
  privilegesMap[privileges.privPublishDataStream] = 0;

  const msg = new ByteBuf()
    .putUint32(Math.floor(Math.random() * 0xffffffff))
    .putUint32(now)
    .putUint32(now + expireSec)
    .putString(roomId)
    .putString(userId)
    .putTreeMapUInt32(privilegesMap)
    .pack();

  const signature = hmac(appKey, msg);
  const content = new ByteBuf().putBytes(msg).putBytes(signature).pack();
  return VERSION + appId + content.toString("base64");
}
