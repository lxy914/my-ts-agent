/**
 * Simple Agent — 基于 OpenAI 兼容 API 的命令行 AI 助手
 *
 * 支持：
 *   - 7 个内置工具（时间、计算、文件读写、编辑、Shell、技能加载）
 *   - 可扩展的技能系统（SKILL.md）
 *   - REPL 交互式对话
 *   - 命令行参数初始问题
 *
 * 启动方式：
 *   # 交互模式
 *   npx ts-node src/index.ts
 *
 *   # 带上初始问题
 *   npx ts-node src/index.ts "帮我创建一个 Hello World HTML 页面"
 *
 *   # 编译后运行
 *   npm run build && node dist/index.js
 */

import "dotenv/config";
import * as readline from "node:readline";
import OpenAI from "openai";
import { listSkills } from "./skills";
import { buildToolSchemas, buildSystemPrompt, runTurn } from "./core";

/**
 * 程序主入口
 *
 * 整个程序的启动流程：
 *   1. 检查 API Key 是否配置（没配置就直接退出，提示用户）
 *   2. 扫描技能目录，获取所有已安装技能
 *   3. 构建 system prompt 和工具 schema
 *   4. 创建 REPL 交互界面
 *   5. 如果有命令行参数，先执行一次初始对话
 *   6. 进入交互循环，逐轮处理用户输入
 */
async function main() {
  // —— 第一步：检查环境变量 ——
  // 没有 API Key 什么也做不了，这里做一个友好的前置检查
  if (!process.env.USER_LLM_API_KEY) {
    console.error(
      "错误: 请设置环境变量 USER_LLM_API_KEY\n" +
        '  export USER_LLM_API_KEY="your-api-key"\n' +
        "  可选: USER_LLM_BASE_URL, USER_LLM_MODEL"
    );
    process.exit(1);
  }

  // —— 第二步：预加载技能 ——
  // 启动时一次性扫描所有技能，这样 system prompt 里可以直接列出可用技能
  // 后续对话中使用 clear 命令时，会重新生成 system prompt（刷新日期时间），
  // 但技能列表不会重新扫描（启动时只扫一次，因为技能文件通常不会在运行中变化）
  const installedSkills = await listSkills();

  // —— 第三步：构建对话所需的初始数据 ——
  const toolSchemas = buildToolSchemas();

  /**
   * 重置消息列表为仅含 system prompt
   *
   * 这是一个闭包，内部引用了 installedSkills。
   * 在程序启动时创建 system prompt，以及用户执行 clear 命令时都会调用它。
   * clear 时重新调用会生成包含最新日期时间的 system prompt。
   */
  function resetMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [{ role: "system", content: buildSystemPrompt(installedSkills) }];
  }

  let messages = resetMessages();

  // —— 第四步：创建 REPL 界面 ——
  // REPL = Read（读取用户输入）、Eval（调用 LLM 处理）、Print（打印结果）、Loop（循环）
  const rl = readline.createInterface({
    input: process.stdin,   // 从哪里读输入 → 键盘
    output: process.stdout,  // 把提示输出到哪里 → 屏幕
  });

  console.log(
    'Agent 已启动，输入你的问题（输入 "exit" 或 "quit" 退出，输入 "clear" 清空对话）\n'
  );

  /**
   * 异步等待用户输入一行
   *
   * rl.question 本身是回调风格的，这里用 Promise 包装一下，
   * 这样在 async/await 风格的代码中写起来更自然。
   */
  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question("用户: ", resolve));

  // —— 第五步：处理命令行参数的初始问题 ——
  // 如果用户在启动时给了参数，比如：
  //   node dist/index.js "帮我写一个冒泡排序"
  // 那么 argv 就是 ["node", "dist/index.js", "帮我写一个冒泡排序"]
  // slice(2) 跳过前两个（node 路径和脚本路径），join(" ") 把剩余参数拼成一句话
  const initMessage = process.argv.slice(2).join(" ");
  if (initMessage) {
    messages.push({ role: "user", content: initMessage });
    await runTurn(messages, toolSchemas);
  }

  // —— 第六步：交互循环 ——
  // 这是程序的主循环，会一直运行直到用户输入 exit/quit
  while (true) {
    const input = await ask();

    // exit / quit → 退出程序
    if (["exit", "quit"].includes(input.toLowerCase())) {
      console.log("再见！");
      break;
    }

    // clear → 清空对话历史
    // 重新生成 system prompt，这样日期时间也会更新
    // 如果用户是在第二天继续对话，这一点很重要
    if (input.toLowerCase() === "clear") {
      messages = resetMessages();
      console.log("对话已清空\n");
      continue;
    }

    // 空输入（只按了回车）→ 跳过，继续等待
    if (!input.trim()) continue;

    // 正常输入 → 添加用户消息，交给 runTurn 处理
    messages.push({ role: "user", content: input });
    await runTurn(messages, toolSchemas);
  }

  // 关闭 readline 接口，释放资源
  rl.close();
}

// 启动程序
// catch 捕获所有未处理的异步异常，防止程序悄悄崩溃
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
