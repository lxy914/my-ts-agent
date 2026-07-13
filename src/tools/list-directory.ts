/**
 * list_directory 工具 —— 让 Agent 浏览本地文件系统
 *
 * 为什么需要这个工具？
 *   Agent 在对项目做操作之前，往往需要先了解项目结构。
 *   这个工具就像终端里的 ls 命令，让 Agent 可以"看看"目录里有什么。
 *
 * 与 bash 工具（ls）的区别：
 *   - bash 工具的 ls 输出是纯文本，Agent 需要自己解析
 *   - 这个工具直接返回结构化的结果，区分了文件和目录，更省 token
 *
 * 输出格式：
 *   [目录] subdir/
 *   [文件] index.ts (1.2 KB)
 *   [文件] README.md (345 B)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool } from "../types";

/**
 * 将字节数转为人类可读的大小
 *
 * @param bytes  文件字节数
 * @returns      带单位的字符串，如 "1.5 KB"
 *
 * 转换规则：
 *   < 1 KB   → 显示 "xxx B"
 *   < 1 MB   → 显示 "x.x KB"（保留一位小数）
 *   >= 1 MB  → 显示 "x.x MB"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const listDirectoryTool: Tool = {
  name: "list_directory",
  description:
    "列出指定目录下的所有文件和子目录，返回结构化的列表（区分文件/目录类型，显示文件大小）。",
  parameters: {
    type: "object",
    properties: {
      dirPath: {
        type: "string",
        description: "要列出的目录路径，可以是绝对路径或相对路径",
      },
    },
    required: ["dirPath"],
  },
  /**
   * 执行：读取目录内容并返回格式化列表
   *
   * @param args.dirPath  要浏览的目录路径
   * @returns             文件和子目录的列表，每行一个条目
   *
   * 处理流程：
   *   1. 用 readdir 获取目录下的所有条目（withFileTypes 可区分文件和子目录）
   *   2. 对每个文件获取它的 stat 信息（主要是文件大小）
   *   3. 按类型格式化输出：
   *      - 目录 → "[目录] 名称/"（末尾加 / 表示目录）
   *      - 文件 → "[文件] 名称 (大小)"
   *   4. 按字母顺序排序，目录排在文件前面
   *
   * 为什么不直接调 bash ls？
   *   readdir 不依赖 Shell，跨平台一致性好，
   *   且 result 格式统一，LLM 更容易理解。
   */
  execute: async (args) => {
    const dirPath = args.dirPath as string;

    try {
      // withFileTypes: true → 返回 Dirent 对象，可以直接调 .isDirectory()
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      if (entries.length === 0) {
        return `目录为空: ${dirPath}`;
      }

      const lines: { type: "dir" | "file"; text: string }[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          if (entry.isDirectory()) {
            lines.push({ type: "dir", text: `[目录] ${entry.name}/` });
          } else if (entry.isFile()) {
            // 获取文件大小（stat 返回文件元数据）
            const stat = await fs.stat(fullPath);
            lines.push({
              type: "file",
              text: `[文件] ${entry.name} (${formatSize(stat.size)})`,
            });
          } else {
            // 符号链接、socket 等特殊类型
            lines.push({ type: "file", text: `[其他] ${entry.name}` });
          }
        } catch {
          // 某些文件可能无权访问 stat（极少见），跳过大小显示
          if (entry.isDirectory()) {
            lines.push({ type: "dir", text: `[目录] ${entry.name}/` });
          } else {
            lines.push({ type: "file", text: `[文件] ${entry.name}` });
          }
        }
      }

      // 排序：目录排在文件前面，同类按字母顺序
      lines.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.text.localeCompare(b.text, "zh-CN");
      });

      const list = lines.map((l) => l.text).join("\n");
      return `路径: ${dirPath}\n共 ${lines.length} 个条目\n\n${list}`;
    } catch (err: any) {
      return `列出目录失败: ${err.message}`;
    }
  },
};
