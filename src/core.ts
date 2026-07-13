/**
 * 核心逻辑 —— system prompt 构建、消息裁剪、对话循环
 *
 * 这是 Agent 的"大脑"部分，负责：
 *   1. 构造发送给 LLM 的系统提示词（告诉 LLM 它是谁、有哪些工具和技能）
 *   2. 管理对话历史，防止超出 LLM 的上下文长度限制
 *   3. 实现对话循环——不断向 LLM 提问、执行工具、回传结果直到得到最终回复
 */

import OpenAI from "openai";
import * as os from "node:os";
import { client, MODEL } from "./config";
import { tools } from "./tools/index";
import type { SkillMeta } from "./types";

/**
 * 对话历史最大消息条数
 *
 * 为什么是 50？
 *   - 太多 → token 消耗快，容易超上下文窗口，LLM 回复变慢
 *   - 太少 → 对话很快就会"失忆"，记不住几轮前的对话
 *   - 50 条对大多数模型（8K~128K 上下文）来说是一个平衡值
 */
const MAX_MESSAGES = 50;

/**
 * 将内部工具数组转换为 OpenAI API 要求的格式
 *
 * OpenAI 的 tool schema 格式和我们内部 Tool 接口几乎一样，
 * 只是多了一层 type: "function" 的包装。
 *
 * 为什么不在 tools 定义里直接用 API 格式？
 *   因为内部 Tool 接口多了 execute 函数，这是给 Agent 自己用的，
 *   LLM 不需要知道 execute 的存在，只需要知道工具名、描述和参数。
 *
 * @returns OpenAI Chat Completions API 可用的 tools 数组
 */
export function buildToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

/**
 * 执行一轮对话 —— 这是最核心的函数
 *
 * 工作流程（循环）：
 *   1. 把当前对话历史发给 LLM
 *   2. 检查 LLM 的回复：
 *      - "stop"      → LLM 完成了回复，打印结果后结束本轮
 *      - "tool_calls" → LLM 要求调用工具，执行工具并把结果加回对话，回到步骤 1
 *      - 其他情况     → 直接输出消息并结束
 *
 * 为什么是循环？
 *   因为 LLM 可能需要调用多个工具才能回答用户的问题。
 *   比如"帮我创建一个 React 项目并启动"，LLM 可能需要：
 *     第 1 轮：调用 bash 执行 npx create-react-app ...
 *     第 2 轮：调用 bash 执行 npm start
 *     第 3 轮：基于工具结果回答用户
 *   这个循环就是让 LLM 和工具轮流发言，直到 LLM 觉得可以了。
 *
 * @param messages      当前的对话历史（会被原地修改）
 * @param toolSchemas   OpenAI 格式的工具定义
 */
export async function runTurn(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[]
) {
  // 每次对话前先裁剪历史，防止超出上下文窗口
  trimMessages(messages);

  while (true) {
    let response: OpenAI.Chat.Completions.ChatCompletion;

    // —— 第一步：调用 LLM ——
    try {
      response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: toolSchemas,
        // tool_choice: "auto" 让 LLM 自己决定是否需要调用工具
        tool_choice: "auto",
      });
    } catch (err: any) {
      // 网络故障、API Key 无效、限流等情况
      const errMsg = err?.error?.message || err.message || String(err);
      console.log(`Agent: [API 调用失败] ${errMsg}\n`);
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;

    const { finish_reason, message } = choice;

    // —— 情况 A：LLM 完成了回复 ——
    // finish_reason === "stop" 表示 LLM 觉得已经说完了，不需要再调用工具
    if (finish_reason === "stop") {
      messages.push(message);
      console.log(`Agent: ${message.content}\n`);
      break;
    }

    // —— 情况 B：LLM 要求调用工具 ——
    // finish_reason === "tool_calls" 并且 message 里带了 tool_calls 数组
    if (finish_reason === "tool_calls" && message.tool_calls) {
      messages.push(message);

      // 逐个执行 LLM 要求的工具调用
      for (const toolCall of message.tool_calls) {
        // 查找对应的工具
        const tool = tools.find((t) => t.name === toolCall.function.name);

        if (!tool) {
          // LLM 要求的工具不存在（理论上不会发生，但以防万一）
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `错误: 未知工具 ${toolCall.function.name}`,
          });
          continue;
        }

        // 解析 LLM 传过来的参数（JSON 字符串转对象）
        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(
          `[调用工具] ${toolCall.function.name}(${JSON.stringify(args)})`
        );

        // 执行工具，获取结果
        const result = await tool.execute(args);
        console.log(`[工具结果] ${result}`);

        // 把工具结果以 "tool" 角色添加到对话历史中
        // 这样 LLM 在下一轮就能看到工具的输出
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      // 回到循环开头，让 LLM 基于工具结果继续思考
      continue;
    }

    // —— 情况 C：其他情况 ——
    // length（超长）、content_filter（内容过滤）等
    messages.push(message);
    console.log(`Agent: ${message.content || "(无响应)"}\n`);
    break;
  }
}

/**
 * 构建系统提示词（system prompt）
 *
 * System prompt 是发给 LLM 的第一条消息，用于设定 Agent 的"人设"和行为规范。
 * 它包含了：
 *   - 当前环境信息（日期、操作系统等）——让 LLM 知道自己在什么环境中运行
 *   - 可用技能列表 —— 只有名称和描述，具体内容在调用 load_skill 时加载
 *   - 行为准则 —— 回答语言、工具使用策略等约束
 *
 * 为什么环境信息很重要？
 *   比如 LLM 需要执行 Shell 命令时，它需要知道当前是 Windows 还是 Linux，
 *   这样才能给出正确的命令（dir vs ls、\\ vs /）。
 *
 * @param skills  已安装技能的元信息列表
 * @returns       完整的 system prompt 字符串
 */
export function buildSystemPrompt(skills: SkillMeta[]): string {
  // —— 收集环境信息 ——
  const now = new Date();
  // 中文格式的日期，例如 "2025年07月13日 星期日"
  const dateStr = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  // 24 小时制时间，例如 "15:30:45"
  const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });

  // 操作系统名称映射表
  const platform = os.platform();
  const platformNames: Record<string, string> = {
    aix: "AIX",
    darwin: "macOS",
    freebsd: "FreeBSD",
    linux: "Linux",
    openbsd: "OpenBSD",
    sunos: "Solaris",
    win32: "Windows",
  };
  const osName = platformNames[platform] || platform;
  const arch = os.arch();       // CPU 架构：x64、arm64 等
  const hostname = os.hostname(); // 主机名
  const homeDir = os.homedir();   // 用户主目录（如 /home/user）
  const cwd = process.cwd();      // 当前工作目录

  // —— 拼接技能列表 ——
  const skillLines =
    skills.length > 0
      ? skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
      : "(无可用技能)";

  // —— 构建完整的 system prompt ——
  // 用数组 + join 而不是硬拼接字符串，代码更清晰易维护
  return [
    "你是一个智能助手 Agent，可以使用工具来完成任务。\n",
    "### 环境信息",
    `- 日期: ${dateStr}`,
    `- 时间: ${timeStr}`,
    `- 操作系统: ${osName} (${arch})`,
    `- 主机名: ${hostname}`,
    `- 用户目录: ${homeDir}`,
    `- 工作目录: ${cwd}\n`,
    "### 可用技能",
    "以下是已安装的技能，当用户需求匹配时直接调用 load_skill 加载:",
    skillLines + "\n",
    "### 行为准则",
    "- 回答使用中文",
    "- 使用工具前先思考是否必要",
    "- 不确定时主动询问用户",
    "- 遇到错误时给出清晰的说明和解决建议\n",
    "### 技能使用方式",
    "当用户的需求匹配某个可用技能时，直接调用 load_skill('<技能名>') 加载指令，然后严格遵循技能文档完成任务。无需先调用 list_skills。",
  ].join("\n");
}

/**
 * 裁剪对话历史，防止超出 LLM 上下文窗口
 *
 * 策略说明：
 *   保留 system prompt（第一条消息）不变，再保留最近 MAX_MESSAGES-1 条消息。
 *   被裁剪掉的是中间"老了"的对话，因为它们对当前回复的参考价值最低。
 *
 * 为什么原地修改数组而不是返回新数组？
 *   历史消息数组在 runTurn 和 main 之间是共享的引用，
 *   原地修改可以避免多处持有不同数组引用导致状态不一致。
 *
 * @param messages  对话历史数组（会被原地修改）
 */
export function trimMessages(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
  // 还没超过上限，不需要裁剪
  if (messages.length <= MAX_MESSAGES) return;

  // 取出 system prompt（永远是第一条消息）
  const systemMsg = messages[0];
  // 保留最近的消息（总共 MAX_MESSAGES-1 条，留一条位置给 system prompt）
  const keep = messages.slice(-(MAX_MESSAGES - 1));

  // 清空原数组，然后重新放入 system prompt + 保留的消息
  // 这样对外部持有的引用是透明的
  messages.length = 0;
  messages.push(systemMsg, ...keep);
}
