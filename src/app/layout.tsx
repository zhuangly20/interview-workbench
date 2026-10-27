import type { Metadata } from "next";
import Link from "next/link";
import RunWatcherProvider from "@/components/RunWatcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Workbench · AI 面试陪练（中英）",
  description: "本地面试陪练工作台：拆解 → 出题 → 陪练 → 反馈",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold">
              🎙️ Interview Workbench
            </Link>
            <nav className="flex gap-5 text-sm text-gray-600">
              <Link href="/" className="hover:text-gray-900">
                练习目标
              </Link>
              <Link href="/settings" className="hover:text-gray-900">
                模型设置
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">
          <RunWatcherProvider>{children}</RunWatcherProvider>
        </main>
      </body>
    </html>
  );
}
