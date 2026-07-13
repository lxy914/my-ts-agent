import OpenAI from "openai";
import * as readline from "node:readline";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";

const client = new OpenAI({
  baseURL: process.env.USER_LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.USER_LLM_API_KEY || "",
});

const MODEL = process.env.USER_LLM_MODEL || "gpt-4o-mini";

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
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
  while (true) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolSchemas,
      tool_choice: "auto",
    });

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

async function main() {
  if (!process.env.USER_LLM_API_KEY) {
    console.error(
      "错误: 请设置环境变量 USER_LLM_API_KEY\n" +
        '  export USER_LLM_API_KEY="your-api-key"\n' +
        "  可选: USER_LLM_BASE_URL, USER_LLM_MODEL"
    );
    process.exit(1);
  }

  const toolSchemas = buildToolSchemas();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "你是一个智能助手，可以使用工具来回答问题。回答请使用中文。",
    },
  ];

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
      messages.length = 1;
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
