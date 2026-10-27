import path from "node:path";

/** 数据根目录：默认项目下 data/，可用 DATA_DIR 环境变量覆盖（npx 全局安装时有用） */
export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function targetsDir(): string {
  return path.join(dataDir(), "targets");
}

/** 拖拽导入的暂存区：解析完成后由 confirm 步骤搬进正式目标目录并清空 */
export function stagingDir(): string {
  return path.join(dataDir(), "staging");
}

export function targetDir(id: string): string {
  return path.join(targetsDir(), id);
}

export function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

export function promptsDir(): string {
  // prompts/ 跟代码放在一起，用户可编辑后重启生效
  return path.join(process.cwd(), "prompts");
}
