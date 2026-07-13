import "dotenv/config";
import OpenAI from "openai";
import * as readline from "node:readline";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";

const client = new OpenAI({
  baseURL: process.env.USER_LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.USER_LLM_API_KEY || "",
});

const MODEL = process.env.USER_LLM_MODEL || "gpt-4o-mini";
const SKILLS_DIR = process.env.USER_SKILLS_DIR || path.resolve("./skills");

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface SkillMeta {
  name: string;
  description: string;
}

function parseFrontMatter(raw: string): { meta: SkillMeta; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { meta: { name: "", description: "" }, body: normalized };
  }
  const yamlBlock = match[1];
  const body = match[2];

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

async function listSkills(): Promise<SkillMeta[]> {
  if (!existsSync(SKILLS_DIR)) return [];

  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const results: SkillMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    try {
      const raw = await fs.readFile(skillFile, "utf-8");
      const { meta } = parseFrontMatter(raw);
      results.push(meta);
    } catch {
      // skip unreadable skills
    }
  }
  return results;
}

const tools: Tool[] = [
  {
    name: "get_current_time",
    description: "获取当前日期和时间",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      return new Date().toISOString();
    },
  },
  {
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
    execute: async (args) => {
      const expr = args.expression as string;
      const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, "");
      const result = Function(`"use strict"; return (${sanitized})`)();
      return String(result);
    },
  },
  {
    name: "read",
    description:
      "读取文件内容。支持指定起始行和读取行数来分段读取大文件。",
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
    execute: async (args) => {
      const filePath = args.filePath as string;
      const offset = (args.offset as number) || 1;
      const limit = (args.limit as number) || 200;

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const start = Math.max(0, offset - 1);
        const end = Math.min(lines.length, start + limit);
        const result = lines
          .slice(start, end)
          .map((line, i) => `${start + i + 1}: ${line}`)
          .join("\n");
        return result || "(文件为空)";
      } catch (err: any) {
        return `读取失败: ${err.message}`;
      }
    },
  },
  {
    name: "write",
    description:
      "将内容写入文件。如果文件不存在则创建，已存在则覆盖。",
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
    execute: async (args) => {
      const filePath = args.filePath as string;
      const content = args.content as string;

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return `写入成功: ${filePath}`;
      } catch (err: any) {
        return `写入失败: ${err.message}`;
      }
    },
  },
  {
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
    execute: async (args) => {
      const filePath = args.filePath as string;
      const oldStr = args.oldString as string;
      const newStr = args.newString as string;

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const count = content.split(oldStr).length - 1;
        if (count === 0) {
          return `编辑失败: 未找到要替换的文本`;
        }
        if (count > 1) {
          return `编辑失败: 匹配到 ${count} 处，请提供更多上下文使其唯一`;
        }
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(filePath, updated, "utf-8");
        return `编辑成功: ${filePath}`;
      } catch (err: any) {
        return `编辑失败: ${err.message}`;
      }
    },
  },
  {
    name: "bash",
    description:
      "执行终端命令并返回输出。命令有 30 秒超时限制。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的 shell 命令",
        },
      },
      required: ["command"],
    },
    execute: async (args) => {
      const command = args.command as string;
      return new Promise((resolve) => {
        exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            resolve(`命令执行失败 (退出码 ${err.code}):\n${stderr || err.message}`);
            return;
          }
          const output = [stdout, stderr].filter(Boolean).join("\n");
          resolve(output || "(无输出)");
        });
      });
    },
  },
  {
    name: "load_skill",
    description:
      "加载指定技能的完整说明文档。调用后将获取该技能的详细工作流程和指令，Agent 应该在后续对话中遵循这些指令。",
    parameters: {
      type: "object",
      properties: {
        skillName: {
          type: "string",
          description: "技能名称，由 list_skills 返回的结果中获取",
        },
      },
      required: ["skillName"],
    },
    execute: async (args) => {
      const skillName = args.skillName as string;
      const safeName = path.basename(skillName);
      const skillFile = path.join(SKILLS_DIR, safeName, "SKILL.md");
      try {
        const raw = await fs.readFile(skillFile, "utf-8");
        const { meta, body } = parseFrontMatter(raw);
        return `[技能已加载: ${meta.name}]\n${meta.description}\n\n---\n\n${body}`;
      } catch {
        return `加载失败: 技能 "${skillName}" 不存在或无法读取 (查找路径: ${skillFile})`;
      }
    },
  },
];

function buildToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

async function runTurn(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[]
) {
  trimMessages(messages);

  while (true) {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: toolSchemas,
        tool_choice: "auto",
      });
    } catch (err: any) {
      const errMsg = err?.error?.message || err.message || String(err);
      console.log(`Agent: [API 调用失败] ${errMsg}\n`);
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;

    const { finish_reason, message } = choice;

    if (finish_reason === "stop") {
      messages.push(message);
      console.log(`Agent: ${message.content}\n`);
      break;
    }

    if (finish_reason === "tool_calls" && message.tool_calls) {
      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const tool = tools.find((t) => t.name === toolCall.function.name);
        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `错误: 未知工具 ${toolCall.function.name}`,
          });
          continue;
        }

        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(
          `[调用工具] ${toolCall.function.name}(${JSON.stringify(args)})`
        );

        const result = await tool.execute(args);
        console.log(`[工具结果] ${result}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      continue;
    }

    messages.push(message);
    console.log(`Agent: ${message.content || "(无响应)"}\n`);
    break;
  }
}

function buildSystemPrompt(skills: SkillMeta[]): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
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
  const arch = os.arch();
  const hostname = os.hostname();
  const homeDir = os.homedir();
  const cwd = process.cwd();

  const skillLines = skills.length > 0
    ? skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
    : "(无可用技能)";

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

const MAX_MESSAGES = 50;

function trimMessages(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
  if (messages.length <= MAX_MESSAGES) return;
  const systemMsg = messages[0];
  const keep = messages.slice(-(MAX_MESSAGES - 1));
  messages.length = 0;
  messages.push(systemMsg, ...keep);
}

async function main() {
  if (!process.env.USER_LLM_API_KEY) {
    console.error(
      "错误: 请设置环境变量 USER_LLM_API_KEY\n" +
        '  export USER_LLM_API_KEY="your-api-key"\n' +
        "  可选: USER_LLM_BASE_URL, USER_LLM_MODEL"
    );
    process.exit(1);
  }

  const installedSkills = await listSkills();

  function resetMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [{ role: "system", content: buildSystemPrompt(installedSkills) }];
  }

  const toolSchemas = buildToolSchemas();
  let messages = resetMessages();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Agent 已启动，输入你的问题（输入 "exit" 或 "quit" 退出，输入 "clear" 清空对话）\n');

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question("用户: ", resolve));

  const initMessage = process.argv.slice(2).join(" ");
  if (initMessage) {
    messages.push({ role: "user", content: initMessage });
    await runTurn(messages, toolSchemas);
  }

  while (true) {
    const input = await ask();
    if (["exit", "quit"].includes(input.toLowerCase())) {
      console.log("再见！");
      break;
    }
    if (input.toLowerCase() === "clear") {
      messages = resetMessages();
      console.log("对话已清空\n");
      continue;
    }
    if (!input.trim()) continue;

    messages.push({ role: "user", content: input });
    await runTurn(messages, toolSchemas);
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
