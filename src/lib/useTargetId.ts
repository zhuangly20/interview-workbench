"use client";

import { useParams } from "next/navigation";

/**
 * useParams 返回的是 URL 编码态的路由段（中文目标 id 是 %xx 字面量，不是原字符）。
 * 拼进 fetch URL 无妨（浏览器原样发送、服务端解码一次），但放进请求 body 的字段
 * （如 voice/start 的 targetId）不经过任何解码层，必须先用这里解回原值。
 */
export function useTargetId(): string {
  const { id } = useParams<{ id: string }>();
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
