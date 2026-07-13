/**
 * 类型定义 —— 项目中所有共享的数据结构
 */

/**
 * Agent 可调用的工具
 *
 * 每个工具包含四个部分：
 *   name        — 工具的唯一名称，LLM 通过这个名字决定调用哪个工具
 *   description — 告诉 LLM 这个工具是干什么用的，写得好坏直接影响 LLM 是否会正确调用
 *   parameters  — JSON Schema 格式的参数定义，描述工具接收哪些参数及其类型
 *   execute     — 具体执行函数，收到 LLM 的调用请求后真正干活的地方
 *
 * 示例：一个加法工具
 *   name: "add"
 *   description: "计算两个数字的和"
 *   parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } }
 *   execute: (args) => { return String(args.a + args.b) }
 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * 技能的元数据
 *
 * 从 SKILL.md 文件头部的 YAML 区域解析得到。
 * 例如下面的 YAML 会得到 name="代码审查"、description="审查代码质量"
 *
 *   ---
 *   name: 代码审查
 *   description: 审查代码质量
 *   ---
 */
export interface SkillMeta {
  name: string;
  description: string;
}
