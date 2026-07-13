/**
 * 配置文件 —— OpenAI 客户端实例和全局常量
 *
 * 所有配置项从环境变量加载，方便在不同环境（开发/生产）之间切换而无需修改代码。
 *
 * 环境变量说明：
 *   USER_LLM_API_KEY  — （必需）你的大模型 API 密钥，没有它程序会拒绝启动
 *   USER_LLM_BASE_URL — （可选）API 地址，默认指向 OpenAI 官方
 *   USER_LLM_MODEL    — （可选）模型名称，默认 gpt-4o-mini（性价比高）
 *   USER_SKILLS_DIR   — （可选）技能文件存放目录，默认当前目录下的 ./skills
 *
 * 使用示例（写在 .env 文件里）：
 *   USER_LLM_API_KEY=sk-xxxx
 *   USER_LLM_BASE_URL=https://api.deepseek.com/v1
 *   USER_LLM_MODEL=deepseek-chat
 */

import OpenAI from "openai";
import * as path from "node:path";

/**
 * OpenAI 兼容的客户端实例
 *
 * 所有与大模型的通信都通过这个 client 发起。
 * 只要你的 API 地址兼容 OpenAI 格式，就可以直接使用。
 */
export const client = new OpenAI({
  baseURL: process.env.USER_LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.USER_LLM_API_KEY || "",
});

/** 当前使用的模型名称，直接传给 API 的 model 参数 */
export const MODEL = process.env.USER_LLM_MODEL || "gpt-4o-mini";

/**
 * 技能文件根目录
 *
 * 程序启动时会扫描这个目录下的所有子文件夹，每个子文件夹代表一个技能。
 * 例如 skills/code-review/SKILL.md 对应一个名为 "code-review" 的技能。
 */
export const SKILLS_DIR =
  process.env.USER_SKILLS_DIR || path.resolve("./skills");
