/**
 * 技能系统 —— 解析 SKILL.md 文件并扫描技能目录
 *
 * 什么是技能？
 *   技能是一段写给 LLM 看的"专业指令"，比如"如何进行代码审查"、"如何写单元测试"。
 *   每个技能就是一个文件夹，里面必须有一个 SKILL.md 文件。
 *
 * 文件结构示例：
 *   skills/
 *     code-review/
 *       SKILL.md     ← 技能文件（YAML front matter + Markdown 正文）
 *     write-tests/
 *       SKILL.md
 *
 * SKILL.md 文件格式：
 *   ---
 *   name: 技能名称          ← YAML front matter（元信息）
 *   description: 技能描述
 *   ---
 *   这里是技能的详细指令...  ← 正文（纯 Markdown，会直接喂给 LLM）
 */

import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { SKILLS_DIR } from "./config";
import type { SkillMeta } from "./types";

/**
 * 解析 SKILL.md 文件，分离出 YAML 元信息和正文内容
 *
 * 处理流程：
 *   1. 把 Windows 换行符（\r\n）统一转成 Unix 换行符（\n）
 *   2. 用正则匹配 --- 包裹的 YAML 区域
 *   3. 在 YAML 区域中提取 name 和 description 字段
 *   4. 返回元信息和去除了 YAML 区域的正文内容
 *
 * 兼容性说明：
 *   如果文件没有 YAML front matter（比如纯 Markdown），也不会报错，
 *   会返回空的元信息，把整个文件内容当作正文。
 *
 * @param raw  SKILL.md 文件的原始文本内容
 * @returns    meta: 技能名称和描述   body: 正文指令内容
 */
export function parseFrontMatter(raw: string): { meta: SkillMeta; body: string } {
  // 统一换行符，兼容 Windows 的 \r\n
  const normalized = raw.replace(/\r\n/g, "\n");

  // 匹配 --- ... --- 区域。([\s\S]*?) 是非贪婪匹配所有字符（包括换行）
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    // 没有 YAML 区域，整个文件当作正文
    return { meta: { name: "", description: "" }, body: normalized };
  }

  const yamlBlock = match[1];  // YAML 区域的内容（不含 ---）
  const body = match[2];       // 正文内容（YAML 之后的部分）

  // 用正则从 YAML 区域中提取字段（简单的逐行匹配，不需要完整 YAML 解析器）
  const nameMatch = yamlBlock.match(/^name:\s*(.+)$/m);
  const descMatch = yamlBlock.match(/^description:\s*(.+)$/m);

  return {
    meta: {
      name: nameMatch ? nameMatch[1].trim() : "",
      description: descMatch ? descMatch[1].trim() : "",
    },
    body: body.trim(),
  };
}

/**
 * 扫描技能目录，收集所有可用技能的元信息
 *
 * 工作流程：
 *   1. 检查 SKILLS_DIR 目录是否存在，不存在直接返回空数组
 *   2. 遍历目录下的所有子文件夹
 *   3. 在每个子文件夹中查找 SKILL.md 文件
 *   4. 解析 SKILL.md 的 YAML front matter，提取 name 和 description
 *   5. 读取失败的子文件夹会被跳过，不影响其他技能
 *
 * 性能说明：
 *   这个函数只在程序启动时调用一次，结果会被缓存到变量中。
 *
 * @returns  所有已安装技能的元信息数组
 */
export async function listSkills(): Promise<SkillMeta[]> {
  // 技能目录不存在，直接返回空数组
  if (!existsSync(SKILLS_DIR)) return [];

  // readdir 的 withFileTypes: true 可以避免为每个条目再做一次 stat 调用
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const results: SkillMeta[] = [];

  for (const entry of entries) {
    // 只关心子目录，跳过普通文件
    if (!entry.isDirectory()) continue;

    // 构造 SKILL.md 的完整路径
    const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");

    try {
      const raw = await fs.readFile(skillFile, "utf-8");
      const { meta } = parseFrontMatter(raw);
      results.push(meta);
    } catch {
      // 文件不存在或无权限读取 → 跳过这个技能，继续下一个
    }
  }

  return results;
}
