// dsh-feynman-sessions — feynman 启动时的环境变量：预设项、手动输入解析、赋值拼接。
//
// 为什么需要这个：环境变量只在启动进程那一刻生效，feynman 又不接受「带环境变量」的参数，
// 所以插件把 `KEY='value'` 写在命令最前面（POSIX shell 的临时赋值语法），
// 只影响这一条命令，不污染用户 shell。

import { hasControlChars } from "./parse.js";

/**
 * 勾选框里提供的常用变量。每条都在 feynman 或其底层 pi 的源码、文档里核对过含义，不做臆测：
 * - FEYNMAN_TELEMETRY=off：关闭 feynman 层的匿名使用统计（`feynman doctor` 会显示 Telemetry: off）。
 * - FEYNMAN_DEBUG=1：打印单条 CLI 诊断（例如统计发送失败的原因）。
 * - NO_COLOR=1：不输出颜色，底层交互库遵循这个通用约定。
 * - PI_IMAGE_PROTOCOL=none：不在终端里尝试内联图片；DSH 的终端是 xterm.js，不支持这类协议。
 * 需要自己填值的变量（模型、检索配额密钥、代理等）放手动输入框，README 里有对照表。
 */
export const ENV_PRESETS = [
  {
    key: "FEYNMAN_TELEMETRY",
    value: "off",
    label: { zh: "关闭匿名使用统计", en: "Disable anonymous telemetry" }
  },
  {
    key: "FEYNMAN_DEBUG",
    value: "1",
    label: { zh: "打印调试信息", en: "Print debug details" }
  },
  {
    key: "NO_COLOR",
    value: "1",
    label: { zh: "不输出颜色（日志、录屏更清楚）", en: "Disable colored output" }
  },
  {
    key: "PI_IMAGE_PROTOCOL",
    value: "none",
    label: { zh: "不尝试内联图片（DSH 终端不支持）", en: "No inline images (DSH terminal cannot show them)" }
  }
];

/** 手动输入框的上限，防止一次塞进几万字的命令把终端卡死。 */
export const MAX_ENV_LINES = 40;
export const MAX_ENV_KEY_CHARS = 64;
export const MAX_ENV_VALUE_CHARS = 1000;
export const MAX_ENV_TEXT_CHARS = 8000;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 解析手动输入的多行文本，每行一条 `KEY=VALUE`。
 * 空行与 `#` 开头的注释行跳过；同一个 KEY 出现多次时以最后一行为准。
 * @param {string} text
 * @returns {{entries: Array<{key: string, value: string}>, errors: Array<{line: number, text: string, message: string}>}}
 */
export function parseEnvText(text) {
  const raw = String(text == null ? "" : text);
  const entries = [];
  const errors = [];
  const index = new Map();
  if (raw.length > MAX_ENV_TEXT_CHARS) {
    errors.push({ line: 0, text: "", message: `env text is longer than ${MAX_ENV_TEXT_CHARS} characters` });
    return { entries, errors };
  }
  const lines = raw.split(/\r?\n/);
  let counted = 0;
  for (let line = 0; line < lines.length; line += 1) {
    const trimmed = lines[line].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    counted += 1;
    if (counted > MAX_ENV_LINES) {
      errors.push({ line: line + 1, text: trimmed, message: `more than ${MAX_ENV_LINES} entries` });
      break;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      errors.push({ line: line + 1, text: trimmed, message: "expected KEY=VALUE" });
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!KEY_PATTERN.test(key)) {
      errors.push({ line: line + 1, text: trimmed, message: `invalid variable name "${key}"` });
      continue;
    }
    if (key.length > MAX_ENV_KEY_CHARS) {
      errors.push({ line: line + 1, text: trimmed, message: `variable name is longer than ${MAX_ENV_KEY_CHARS} characters` });
      continue;
    }
    value = unwrapQuotes(value);
    if (hasControlChars(value)) {
      errors.push({ line: line + 1, text: trimmed, message: "value contains control characters" });
      continue;
    }
    if (value.length > MAX_ENV_VALUE_CHARS) {
      errors.push({ line: line + 1, text: trimmed, message: `value is longer than ${MAX_ENV_VALUE_CHARS} characters` });
      continue;
    }
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, entries.length);
      entries.push({ key, value });
    } else {
      entries[existing] = { key, value };
    }
  }
  return { entries, errors };
}

/** 去掉成对的首尾引号：'x'、"x" 都还原成 x；不成对就原样保留。 */
function unwrapQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) return value.slice(1, -1);
  return value;
}

/**
 * 把若干条赋值拼成命令前缀。值是空的也照样输出（`KEY=''`），因为"清空某个变量"
 * 本身是有意义的操作。
 * @param {Array<{key: string, value: string}>} entries
 * @returns {string} 形如 KEY='值' ANOTHER='值'，没有条目时返回空串
 */
export function buildEnvPrefix(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  return entries
    .map((entry) => {
      const key = String(entry && entry.key != null ? entry.key : "").trim();
      if (!KEY_PATTERN.test(key)) throw new Error(`invalid environment variable name "${key}"`);
      const value = String(entry && entry.value != null ? entry.value : "");
      return key + "=" + quoteValue(value);
    })
    .join(" ");
}

/** 单引号包裹值；内部单引号写成 '\''。控制字符直接拒绝。 */
function quoteValue(value) {
  const text = String(value == null ? "" : value);
  if (hasControlChars(text)) throw new Error("environment value contains control characters");
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/** 勾选框的默认状态对应的条目（只取预设表里有的键）。 */
export function entriesFromPresets(keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : []);
  return ENV_PRESETS.filter((preset) => wanted.has(preset.key)).map((preset) => ({ key: preset.key, value: preset.value }));
}

/**
 * 合并勾选项与手动输入。手动输入里出现同名的键时，手动那条优先（用户临时改一个值不用先取消勾选）。
 * @param {string[]} presetKeys
 * @param {string} text
 */
export function resolveEnv(presetKeys, text) {
  const parsed = parseEnvText(text);
  const fromPresets = entriesFromPresets(presetKeys);
  const manual = new Map(parsed.entries.map((entry) => [entry.key, entry.value]));
  const merged = fromPresets.filter((entry) => !manual.has(entry.key)).concat(parsed.entries);
  return { entries: merged, errors: parsed.errors };
}
