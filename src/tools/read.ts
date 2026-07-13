/**
 * read 工具 —— 让 Agent 读取本地文件内容
 *
 * 为什么需要分段读取？
 *   大文件可能有几千行，一次性全部发给 LLM 会超出上下文窗口限制。
 *   分段读取可以让 Agent 先看开头，再根据需要逐段读取，既省 token 又高效。
 *
 * 返回格式：
 *   每行前面带有行号，方便 Agent 定位和引用具体代码位置。
 *   例如 "42: const x = 1" 表示这是文件的第 42 行。
 */

import * as fs from "node:fs/promises";
import type { Tool } from "../types";

export const readTool: Tool = {
  name: "read",
  description: "读取文件内容。支持指定起始行和读取行数来分段读取大文件。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "文件绝对路径",
      },
      offset: {
        type: "number",
        description: "从第几行开始读取，默认为 1",
      },
      limit: {
        type: "number",
        description: "最多读取行数，默认 200",
      },
    },
    required: ["filePath"],
  },
  /**
   * 执行：读取文件指定范围的内容
   *
   * @param args.filePath  要读取的文件的绝对路径（必需）
   * @param args.offset    从第几行开始读（可选，默认第 1 行）
   * @param args.limit     最多读多少行（可选，默认 200 行）
   * @returns              带行号前缀的文件内容
   *
   * 例如 offset=10, limit=5 表示读取第 10~14 行。
   */
  execute: async (args) => {
    const filePath = args.filePath as string;
    const offset = (args.offset as number) || 1;
    const limit = (args.limit as number) || 200;

    try {
      // 读取整个文件为字符串
      const content = await fs.readFile(filePath, "utf-8");
      // 按换行符拆分成行数组
      const lines = content.split("\n");

      // 计算读取范围
      // offset 从 1 开始计数（用户友好的习惯），所以要减 1 转为数组下标
      const start = Math.max(0, offset - 1);
      const end = Math.min(lines.length, start + limit);

      // 截取指定范围，并给每行加上行号前缀
      const result = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}: ${line}`)
        .join("\n");

      return result || "(文件为空)";
    } catch (err: any) {
      // 文件不存在、无权限等情况
      return `读取失败: ${err.message}`;
    }
  },
};
