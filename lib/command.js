// dsh-feynman-sessions — 拼一条能在终端里直接执行、接上指定会话的命令。
//
// 为什么需要这个：DSH 的终端只能「开一个 shell」，宿主不接受「顺便执行这条命令」
// 的参数，所以插件是往那个 shell 里**输入**一行命令。输入之前必须把路径转义好，
// 否则一个带空格或引号的目录名就会把整条命令拆坏。

import { hasControlChars } from "./parse.js";
import { buildEnvPrefix } from "./env.js";

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
 * @param {{cwd?: string, file: string, bin?: string, env?: Array<{key: string, value: string}>}} input
 *   cwd  该会话记录的工作目录（空则不改目录）。
 *   file feynman 会话文件的绝对路径。
 *   bin  feynman 可执行文件名或绝对路径，默认 feynman。
 *   env  可选，挂在命令最前面的 `KEY='value'` 赋值，只影响这一条命令。
 * @returns {string} 形如 cd '/x y' && FEYNMAN_TELEMETRY='off' 'feynman' --session '/a/b.jsonl'
 */
export function buildResumeCommand(input) {
  const source = input && typeof input === "object" ? input : {};
  const file = String(source.file == null ? "" : source.file);
  if (!file) throw new Error("session file path is required");
  const bin = String(source.bin == null || source.bin === "" ? "feynman" : source.bin);
  const prefix = buildEnvPrefix(source.env);
  const parts = [];
  const cwd = source.cwd == null ? "" : String(source.cwd);
  if (cwd) parts.push("cd " + shellQuote(cwd));
  parts.push((prefix ? prefix + " " : "") + shellQuote(bin) + " --session " + shellQuote(file));
  return parts.join(" && ");
}

/**
 * 生成「开一个新会话」的命令：切到指定目录，按需带上环境变量，然后启动 feynman。
 * 不传 `--session`，所以 feynman 自己新建一个会话。
 * @param {{cwd?: string, bin?: string, env?: Array<{key: string, value: string}>}} input
 * @returns {string} 形如 cd '/x y' && FEYNMAN_TELEMETRY='off' 'feynman'
 */
export function buildStartCommand(input) {
  const source = input && typeof input === "object" ? input : {};
  const bin = String(source.bin == null || source.bin === "" ? "feynman" : source.bin);
  const cwd = source.cwd == null ? "" : String(source.cwd);
  if (cwd && hasControlChars(cwd)) throw new Error("working directory contains control characters");
  if (cwd && !cwd.startsWith("/")) throw new Error("working directory must be an absolute path");
  const prefix = buildEnvPrefix(source.env);
  const parts = [];
  if (cwd) parts.push("cd " + shellQuote(cwd));
  parts.push((prefix ? prefix + " " : "") + shellQuote(bin));
  return parts.join(" && ");
}
