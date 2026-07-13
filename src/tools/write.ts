/**
 * write 工具 —— 让 Agent 向本地文件写入内容
 *
 * 行为说明：
 *   - 文件不存在 → 自动创建
 *   - 文件已存在 → 覆盖原有内容（旧内容会丢失）
 *   - 父目录不存在 → 自动递归创建所有缺失的目录
 *
 * 安全提醒：
 *   这个工具可以覆盖任何文件，使用时应注意目标路径是否正确。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool } from "../types";

export const writeTool: Tool = {
  name: "write",
  description: "将内容写入文件。如果文件不存在则创建，已存在则覆盖。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "文件绝对路径",
      },
      content: {
        type: "string",
        description: "要写入的内容",
      },
    },
    required: ["filePath", "content"],
  },
  /**
   * 执行：将指定内容写入文件
   *
   * @param args.filePath  目标文件的绝对路径
   * @param args.content   要写入的文本内容
   * @returns              成功或失败的消息
   *
   * 实现细节：
   *   - 使用 path.dirname() 提取文件路径中的目录部分
   *   - recursive: true 确保嵌套目录一次性创建（如 a/b/c/ 即使 a 不存在也能创建）
   *   - 编码统一使用 UTF-8
   */
  execute: async (args) => {
    const filePath = args.filePath as string;
    const content = args.content as string;

    try {
      // 自动创建不存在的父目录（recursive: true 像 mkdir -p 命令）
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // 以 UTF-8 编码写入文件
      await fs.writeFile(filePath, content, "utf-8");
      return `写入成功: ${filePath}`;
    } catch (err: any) {
      return `写入失败: ${err.message}`;
    }
  },
};
