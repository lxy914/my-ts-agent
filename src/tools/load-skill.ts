/**
 * load_skill 工具 —— 让 Agent 动态加载技能的详细指令
 *
 * 为什么需要这个工具？
 *   system prompt 里只列出了技能的名称和一句话描述（节省 token）。
 *   当 Agent 需要真正执行某个技能时，才通过这个工具加载完整指令。
 *   这是一种"懒加载"策略：不用的时候不占上下文，用到的时候再拿详细说明。
 *
 * 防止路径穿越：
 *   用户或 LLM 传入的技能名称可能是恶意的，比如 "../../etc/passwd"。
 *   使用 path.basename() 可以只取文件名的最后一部分，防止跳出技能目录。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SKILLS_DIR } from "../config";
import { parseFrontMatter } from "../skills";
import type { Tool } from "../types";

export const loadSkillTool: Tool = {
  name: "load_skill",
  description:
    "加载指定技能的完整说明文档。调用后将获取该技能的详细工作流程和指令，Agent 应该在后续对话中遵循这些指令。",
  parameters: {
    type: "object",
    properties: {
      skillName: {
        type: "string",
        description: "技能名称，与 system prompt 中列出的可用技能名称一致",
      },
    },
    required: ["skillName"],
  },
  /**
   * 执行：读取并返回某个技能的完整说明
   *
   * @param args.skillName  技能名称，例如 "code-review"
   * @returns               技能的元信息 + 完整指令正文，供 Agent 参考
   *
   * 处理流程：
   *   1. 用 path.basename() 清洗 skillName，防止路径穿越攻击
   *      - 例如 "../../secret" 会被清洗为 "secret"
   *   2. 拼出技能文件路径：{SKILLS_DIR}/{safeName}/SKILL.md
   *   3. 读取并解析 YAML front matter，返回格式化后的技能描述
   */
  execute: async (args) => {
    const skillName = args.skillName as string;
    // path.basename() 只取路径的最后一段，像防弹衣一样防止攻击者跳出技能目录
    // 例如 basename("../../etc/passwd") → "passwd"
    const safeName = path.basename(skillName);
    const skillFile = path.join(SKILLS_DIR, safeName, "SKILL.md");

    try {
      const raw = await fs.readFile(skillFile, "utf-8");
      const { meta, body } = parseFrontMatter(raw);
      // 返回格式化的信息，Agent 可以直接理解
      return `[技能已加载: ${meta.name}]\n${meta.description}\n\n---\n\n${body}`;
    } catch {
      // 技能文件不存在或无法读取
      return `加载失败: 技能 "${skillName}" 不存在或无法读取 (查找路径: ${skillFile})`;
    }
  },
};
