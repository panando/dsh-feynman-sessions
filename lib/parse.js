// dsh-feynman-sessions — 纯函数解析器。
//
// 输入：一份 feynman 会话文件的文本内容（JSONL，pi 血统的 session 格式）。
// 输出：结构化记录。这个文件不碰文件系统、不读环境变量，方便单测。
//
// 事件类型（用真实会话核对过）：
//   session               首行，含 id / timestamp / cwd / version
//   model_change          provider / modelId，取最后一条
//   thinking_level_change thinkingLevel，取最后一条
//   message               role = system | user | assistant | toolResult
//   custom                工具产生的元数据（如 web-search-results）
//   custom_message        子代理通知之类，带 display 标记
//   context_edit          上下文被裁剪，replacement 通常为 null
// 其它类型一律容错跳过并计数，不抛错。

/** 列表里的标题最多显示多少字。 */
export const MAX_TITLE_CHARS = 60;
/** 列表里的最后一段回复最多显示多少字。 */
export const MAX_PREVIEW_CHARS = 200;
/** 单条工具结果最多保留多少字，防止一个巨大的 html 把详情页撑爆。 */
export const MAX_TOOL_RESULT_CHARS = 4000;

const NEWLINE = /\r\n?/g;
const SURROGATE_SAFE_WHITESPACE = /[\s\u00a0\u3000]+/g;

/** 控制字符：写进终端命令行会破坏整行，必须在拼接命令前拒绝（含换行与制表符）。 */
export function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value == null ? "" : value));
}

/** 压成一行并截断，用于标题和预览。 */
export function collapse(text, maxChars = MAX_TITLE_CHARS) {
  const flat = String(text == null ? "" : text)
    .replace(NEWLINE, "\n")
    .replace(/^[\s\u3000]+|[\s\u3000]+$/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(SURROGATE_SAFE_WHITESPACE, " ")
    .trim();
  const chars = Array.from(flat);
  if (chars.length <= maxChars) return flat;
  return chars.slice(0, maxChars).join("").trimEnd() + "…";
}

/**
 * 把事件时间统一成毫秒数。pi 的会话文件里有的写 ISO 字符串，有的写数字，
 * 两种都得认，否则排序和「最后更新时间」会全变成 0。
 */
export function timeOf(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** 取消息内容里的纯文本（thinking 与 toolCall 不参与）。 */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
}

function boundText(value, maxChars) {
  const text = String(value == null ? "" : value);
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, clipped: false };
  return { text: chars.slice(0, maxChars).join(""), clipped: true };
}

function noteLabelOf(event) {
  if (event && typeof event.customType === "string" && event.customType) return event.customType;
  if (event && typeof event.type === "string" && event.type) return event.type;
  return "custom";
}

function noteTextOf(event) {
  const type = event.type;
  if (type === "custom_message") {
    if (typeof event.content === "string") return event.content;
    return textOf(event.content);
  }
  if (type === "context_edit") {
    const target = event.targetId ? `（目标 ${String(event.targetId).slice(0, 8)}）` : "";
    return `上下文条目被删除${target}`;
  }
  if (event.data === undefined) return "";
  try {
    const serialized = JSON.stringify(event.data);
    return serialized === undefined ? "" : serialized;
  } catch (_) {
    return "";
  }
}

/**
 * 解析一份会话文件。
 * @param {string} text 文件全文。
 * @param {{maxEvents?: number}} [options] maxEvents 表示最多解析多少条事件（超出只保留头尾）。
 * @returns {object} 结构化记录。
 */
export function parseSession(text, options = {}) {
  const raw = String(text == null ? "" : text);
  const allLines = raw.split("\n");
  // 文件末尾的换行会切出一个空串，不算一条事件。
  const lines = allLines.length && allLines[allLines.length - 1] === "" ? allLines.slice(0, -1) : allLines;
  const maxEvents = Number.isFinite(options.maxEvents) && options.maxEvents > 1 ? Math.floor(options.maxEvents) : Infinity;
  const truncated = lines.length > maxEvents;
  const selected = truncated
    ? [lines[0]].concat(lines.slice(lines.length - (maxEvents - 1)))
    : lines;

  const record = {
    id: "",
    cwd: "",
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    provider: "",
    model: "",
    thinkingLevel: "",
    counts: { user: 0, assistant: 0, toolResult: 0, note: 0 },
    messages: [],
    skippedLines: 0,
    skippedUnknownEvents: 0,
    partialTail: false,
    truncated,
    eventCount: lines.length
  };

  const pendingToolCalls = new Map();
  const lastLineIndex = lines.length - 1;
  let lineNumberInFile = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const line = selected[index];
    // selected 在截断时是「首行 + 末尾若干行」，用文件里的真实行号判断是不是最后一行。
    lineNumberInFile = truncated ? (index === 0 ? 0 : lastLineIndex - (selected.length - 1 - index)) : index;
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_) {
      record.skippedLines += 1;
      if (lineNumberInFile === lastLineIndex && !raw.endsWith("\n")) record.partialTail = true;
      continue;
    }
    if (!event || typeof event !== "object") {
      record.skippedLines += 1;
      continue;
    }
    const eventTime = timeOf(event.timestamp);
    if (eventTime > record.updatedAt) record.updatedAt = eventTime;

    switch (event.type) {
      case "session": {
        if (typeof event.id === "string" && !record.id) record.id = event.id;
        if (typeof event.cwd === "string" && !record.cwd) record.cwd = event.cwd;
        if (Number.isFinite(event.version)) record.version = event.version;
        if (eventTime && !record.createdAt) record.createdAt = eventTime;
        break;
      }
      case "model_change": {
        if (typeof event.provider === "string" && event.provider) record.provider = event.provider;
        if (typeof event.modelId === "string" && event.modelId) record.model = event.modelId;
        break;
      }
      case "thinking_level_change": {
        if (typeof event.thinkingLevel === "string" && event.thinkingLevel) record.thinkingLevel = event.thinkingLevel;
        break;
      }
      case "message": {
        absorbMessage(record, event.message, pendingToolCalls, eventTime);
        break;
      }
      case "custom":
      case "custom_message":
      case "context_edit": {
        record.counts.note += 1;
        record.messages.push({
          role: "note",
          label: noteLabelOf(event),
          text: boundText(noteTextOf(event), MAX_TOOL_RESULT_CHARS).text,
          timestamp: timeOf(event.timestamp)
        });
        break;
      }
      default: {
        record.skippedUnknownEvents += 1;
      }
    }
  }

  if (!record.updatedAt) record.updatedAt = record.createdAt;
  record.title = titleOf(record.messages);
  record.preview = previewOf(record.messages);
  return record;
}

function absorbMessage(record, message, pendingToolCalls, fallbackTimestamp) {
  if (!message || typeof message !== "object") {
    record.skippedLines += 1;
    return;
  }
  const role = message.role;
  const timestamp = timeOf(message.timestamp) || (Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : 0);
  if (role === "system") {
    // 系统提示词（含整套 preamble）体积大且没人看，直接丢。
    return;
  }
  if (role === "user") {
    const text = textOf(message.content).trim();
    if (!text) return;
    record.counts.user += 1;
    record.messages.push({ role: "user", text, timestamp });
    return;
  }
  if (role === "assistant") {
    const parts = [];
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) {
        parts.push({ kind: "thinking", text: part.thinking });
      } else if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        parts.push({ kind: "text", text: part.text });
      } else if (part.type === "toolCall") {
        const call = {
          kind: "toolCall",
          id: typeof part.id === "string" ? part.id : "",
          name: typeof part.name === "string" ? part.name : "",
          arguments: part.arguments,
          result: null,
          isError: false,
          durationMs: null
        };
        parts.push(call);
        if (call.id) pendingToolCalls.set(call.id, call);
      }
    }
    if (!parts.length) return;
    record.counts.assistant += 1;
    record.messages.push({
      role: "assistant",
      parts,
      model: typeof message.model === "string" ? message.model : "",
      provider: typeof message.provider === "string" ? message.provider : "",
      usage: normalizeUsage(message.usage),
      stopReason: typeof message.stopReason === "string" ? message.stopReason : "",
      durationMs: Number.isFinite(message.durationMs) ? message.durationMs : null,
      timestamp
    });
    return;
  }
  if (role === "toolResult") {
    record.counts.toolResult += 1;
    const text = textOf(message.content);
    const call = pendingToolCalls.get(message.toolCallId);
    const bounded = boundText(text, MAX_TOOL_RESULT_CHARS);
    if (call) {
      pendingToolCalls.delete(message.toolCallId);
      call.result = bounded.text;
      call.resultClipped = bounded.clipped;
      call.isError = message.isError === true;
      call.durationMs = Number.isFinite(message.durationMs) ? message.durationMs : null;
      return;
    }
    // 找不到对应调用（被截断或格式不同）时单独成条，不丢信息。
    record.messages.push({
      role: "toolResult",
      toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : "",
      name: typeof message.toolName === "string" ? message.toolName : "",
      text: bounded.text,
      isError: message.isError === true,
      durationMs: Number.isFinite(message.durationMs) ? message.durationMs : null,
      timestamp
    });
    return;
  }
  record.skippedUnknownEvents += 1;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const pick = (value) => (Number.isFinite(value) ? value : 0);
  const normalized = {
    input: pick(usage.input),
    output: pick(usage.output),
    cacheRead: pick(usage.cacheRead),
    cacheWrite: pick(usage.cacheWrite),
    reasoning: pick(usage.reasoning),
    totalTokens: pick(usage.totalTokens)
  };
  if (!normalized.totalTokens && !normalized.input && !normalized.output) return null;
  return normalized;
}

function titleOf(messages) {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const title = collapse(message.text, MAX_TITLE_CHARS);
    if (title) return title;
  }
  return "（没有用户提问）";
}

function previewOf(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.kind !== "text") continue;
      const preview = collapse(part.text, MAX_PREVIEW_CHARS);
      if (preview) return preview;
    }
  }
  return "";
}

/** 列表用的轻量投影：不带 messages。 */
export function toListItem(record, extra = {}) {
  return {
    id: record.id,
    cwd: record.cwd,
    title: record.title,
    preview: record.preview,
    provider: record.provider,
    model: record.model,
    thinkingLevel: record.thinkingLevel,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    counts: record.counts,
    eventCount: record.eventCount,
    truncated: record.truncated,
    partialTail: record.partialTail,
    ...extra
  };
}
