"use client";

import type { TargetLanguage } from "@/lib/types";

/** 面试语言选择器：创建时定死，之后不可改。value 已含自动判断结果（父组件负责 guess 与 fallback）。 */
export default function LanguageField({
  value,
  onChange,
}: {
  value: TargetLanguage;
  onChange: (v: TargetLanguage) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">面试语言（创建后不可更改）</span>
      <select
        className="w-full rounded-md border bg-white px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as TargetLanguage)}
      >
        <option value="en">英文面试</option>
        <option value="zh">中文面试</option>
      </select>
    </label>
  );
}
