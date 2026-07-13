/**
 * bash 工具 —— 让 Agent 执行终端命令
 *
 * 安全限制：
 *   - 超时 30 秒：防止命令卡死导致程序无响应
 *   - 缓冲区上限 1MB：防止输出过大导致内存溢出
 *
 * Windows 编码问题：
 *   中文 Windows 控制台默认用 GBK 编码输出中文，而 Node.js 按 UTF-8 读取，
 *   两套编码不匹配就会产生乱码。解决方案分两步：
 *     1. chcp 65001 → 把控制台编码临时切换到 UTF-8
 *     2. encoding: "buffer" → 拿到原始字节后再手动用 UTF-8 解码
 */

import { exec } from "node:child_process";
import type { Tool } from "../types";

export const bashTool: Tool = {
  name: "bash",
  description: "执行终端命令并返回输出。命令有 30 秒超时限制。",
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
  /**
   * 执行：运行一条终端命令并返回输出
   *
   * @param args.command  要执行的命令，例如 "ls -la" 或 "git status"
   * @returns             命令的标准输出 + 标准错误输出；失败时返回错误信息
   *
   * 关于 exec 和 spawn 的选择：
   *   这里使用 exec 而不是 spawn，因为：
   *     - 大多数 Agent 命令输出不会很大（几百行以内）
   *     - exec 的 API 更简单，回调中直接拿到完整输出
   *     - maxBuffer 限制可以防止异常情况下的内存问题
   *
   * 关于 Windows 编码的详细解释：
   *   在中文 Windows 上，cmd.exe 默认的活动代码页是 936（GBK），
   *   这意味着 dir、echo 等命令输出的中文是按 GBK 编码的字节。
   *   如果 Node.js 直接把这些字节当 UTF-8 读，就会出现乱码。
   *   所以我们在执行命令前先运行 "chcp 65001 >nul"，把代码页
   *   切成 65001（UTF-8），让后续命令都用 UTF-8 输出。
   *   同时用 encoding: "buffer" 拿原始字节，避免 exec 内部做错误的编码转换。
   */
  execute: async (args) => {
    const command = args.command as string;
    const isWindows = process.platform === "win32";
    // Windows 下先切换编码页为 UTF-8（chcp 65001），然后执行用户的命令
    // >nul 表示把 chcp 自己的输出重定向到空设备，不干扰结果
    const finalCommand = isWindows
      ? `chcp 65001 >nul && ${command}`
      : command;

    return new Promise((resolve) => {
      exec(
        finalCommand,
        // encoding: "buffer" → 回调中 stdout/stderr 是 Buffer 而非 string
        // 这样可以手动控制用什么编码来解码，避免 Node.js 用错编码
        // timeout: 30 秒后命令还没结束就强制终止
        // maxBuffer: 输出超过 1MB 也会终止，防止内存撑爆
        { timeout: 30000, maxBuffer: 1024 * 1024, encoding: "buffer" },
        (err, stdout, stderr) => {
          // 辅助函数：把 Buffer 转成 UTF-8 字符串
          const dec = (b: Buffer) => b.toString("utf8");

          if (err) {
            // err 不为 null 表示命令执行失败（退出码非 0、超时等）
            // 优先输出 stderr，如果 stderr 为空则输出 err.message
            const msg = stderr.length > 0 ? dec(stderr as Buffer) : err.message;
            resolve(`命令执行失败 (退出码 ${err.code}):\n${msg}`);
            return;
          }

          // 拼接 stdout 和 stderr（如果都有内容的话）
          // filter(Boolean) 过滤掉空字符串，避免多余的空行
          const output = [dec(stdout as Buffer), dec(stderr as Buffer)]
            .filter(Boolean)
            .join("\n");
          resolve(output || "(无输出)");
        }
      );
    });
  },
};
