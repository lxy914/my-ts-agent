/**
 * edit 工具 —— 让 Agent 精确地修改文件中的某一段文本
 *
 * 与 write 工具的区别：
 *   write 是"整体替换"整个文件，适合创建新文件或完全重写。
 *   edit  是"局部替换"某一段文本，适合小范围修改已有文件。
 *
 * 匹配规则：
 *   - oldString 必须与文件中的内容完全一致（包括空格和缩进）
 *   - 如果 oldString 在文件中出现了多次，工具会拒绝修改并提示
 *   - 解决方案是：提供更多上下文，让 oldString 足够长，使文件里只有一处匹配
 */

import * as fs from "node:fs/promises";
import type { Tool } from "../types";

export const editTool: Tool = {
  name: "edit",
  description:
    "编辑文件，将文件中的指定文本替换为新文本。oldString 必须与文件中的内容精确匹配（包括缩进和空格）。如果有多处匹配则会报错，请提供更多上下文以确保唯一匹配。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "要编辑的文件绝对路径",
      },
      oldString: {
        type: "string",
        description: "要被替换的原始文本，必须精确匹配",
      },
      newString: {
        type: "string",
        description: "替换后的新文本",
      },
    },
    required: ["filePath", "oldString", "newString"],
  },
  /**
   * 执行：在文件中精确替换文本
   *
   * @param args.filePath  要编辑的文件路径
   * @param args.oldString 要被替换的原文（必须精确匹配）
   * @param args.newString 替换后的新文本
   * @returns              成功或失败的消息
   *
   * 处理流程：
   *   1. 读取文件全部内容
   *   2. 统计 oldString 在文件中出现了几次
   *      - 0 次 → 返回错误，说明目标文本没找到
   *      - >1 次 → 返回错误，要求提供更多上下文来唯一定位
   *      - 1 次 → 执行替换并写回文件
   */
  execute: async (args) => {
    const filePath = args.filePath as string;
    const oldStr = args.oldString as string;
    const newStr = args.newString as string;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      // 用 split 统计 oldString 出现的次数
      // 例如 "hello hello" 按 "hello" 分割得到 ["", " ", ""]，length-1=2，即出现了 2 次
      const count = content.split(oldStr).length - 1;

      if (count === 0) {
        return `编辑失败: 未找到要替换的文本`;
      }
      if (count > 1) {
        return `编辑失败: 匹配到 ${count} 处，请提供更多上下文使其唯一`;
      }

      // 只匹配一次，放心替换
      const updated = content.replace(oldStr, newStr);
      await fs.writeFile(filePath, updated, "utf-8");
      return `编辑成功: ${filePath}`;
    } catch (err: any) {
      return `编辑失败: ${err.message}`;
    }
  },
};
