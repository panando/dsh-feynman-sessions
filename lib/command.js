// dsh-feynman-sessions — 拼一条能在终端里直接执行、接上指定会话的命令。
//
// 为什么需要这个：DSH 的终端只能「开一个 shell」，宿主不接受「顺便执行这条命令」
// 的参数，所以插件是往那个 shell 里**输入**一行命令。输入之前必须把路径转义好，
// 否则一个带空格或引号的目录名就会把整条命令拆坏。

import { hasControlChars } from "./parse.js";

/** 用单引号包一个值，内部单引号写成 '\''（POSIX shell 通用写法）。 */
export function shellQuote(value) {
  const text = String(value == null ? "" : value);
  if (hasControlChars(text)) {
    throw new Error("value contains control characters and cannot be typed into a shell");
  }
  if (text === "") return "''";
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/**
 * 生成续跑命令。
 * @param {{cwd?: string, file: string, bin?: string}} input
 *   cwd  该会话记录的工作目录（空则不改目录）。
 *   file feynman 会话文件的绝对路径。
 *   bin  feynman 可执行文件名或绝对路径，默认 feynman。
 * @returns {string} 形如 cd '/x y' && 'feynman' --session '/a/b.jsonl'
 */
export function buildResumeCommand(input) {
  const source = input && typeof input === "object" ? input : {};
  const file = String(source.file == null ? "" : source.file);
  if (!file) throw new Error("session file path is required");
  const bin = String(source.bin == null || source.bin === "" ? "feynman" : source.bin);
  const parts = [];
  const cwd = source.cwd == null ? "" : String(source.cwd);
  if (cwd) parts.push("cd " + shellQuote(cwd));
  parts.push(shellQuote(bin) + " --session " + shellQuote(file));
  return parts.join(" && ");
}
