/**
 * get_current_time 工具 —— 让 Agent 知道当前日期和时间
 *
 * 为什么需要这个工具？
 *   LLM 模型本身只知道训练截止日期之前的信息，不知道"现在"是什么时候。
 *   有了这个工具，Agent 就可以在需要时获取实时时间。
 *
 * 使用场景：
 *   - 用户问"今天是星期几"
 *   - 计算相对日期（如"三天后是什么日期"）
 *   - 文件操作中需要记录时间戳
 */

import type { Tool } from "../types";

export const getCurrentTimeTool: Tool = {
  name: "get_current_time",
  description: "获取当前日期和时间",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  /**
   * 执行：返回 ISO 8601 格式的当前时间字符串
   *
   * ISO 8601 格式示例：2025-07-13T07:30:00.000Z
   * - 这是一种国际标准时间格式，全球通用
   * - LLM 可以轻松解析这种格式并转换成用户所在时区的时间
   * - 精确到毫秒，满足绝大多数场景
   */
  execute: async () => {
    return new Date().toISOString();
  },
};
