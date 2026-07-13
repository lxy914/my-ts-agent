/**
 * calculate 工具 —— 让 Agent 执行数学计算
 *
 * 为什么需要这个工具？
 *   LLM 是语言模型，数学计算并不精确。直接让 LLM 算 12345 * 67890
 *   可能得到接近但不准确的结果。通过工具来做计算可以保证精确性。
 *
 * 支持的运算：
 *   + - * / （加减乘除）
 *   ( )   （括号控制优先级）
 *   %     （取模/取余）
 *   .     （小数）
 *
 * 安全说明：
 *   计算前会过滤掉所有非法字符（比如字母、特殊符号），
 *   防止通过数学表达式注入恶意代码。
 */

import type { Tool } from "../types";

export const calculateTool: Tool = {
  name: "calculate",
  description: "执行数学计算，支持加减乘除",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "数学表达式，例如 '2 + 3 * 4'",
      },
    },
    required: ["expression"],
  },
  /**
   * 执行：解析并计算数学表达式
   *
   * @param args.expression  用户（或 LLM）传入的数学表达式字符串
   * @returns                计算结果，以字符串形式返回
   *
   * 处理步骤：
   *   1. 过滤非法字符（只保留数字、运算符、点号、百分号、空格）
   *   2. 用 JavaScript 的 Function 构造器执行
   *      - 为什么用 Function 而不是 eval？Function 在严格模式下运行，
   *        且无权访问当前作用域的变量，比 eval 稍微安全一些
   *      - 配合步骤 1 的字符过滤，可以防止绝大多数代码注入
   */
  execute: async (args) => {
    const expr = args.expression as string;
    // 过滤非法字符：保留 0-9、加减乘除、括号、点号、百分号、空格
    // 任何不在这个范围里的字符都会被移除，比如字母、分号等
    const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, "");
    // "use strict" 声明严格模式，防止意外访问全局变量
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  },
};
