import test from "node:test";
import assert from "node:assert/strict";

import { parseSession, toListItem, collapse, textOf, hasControlChars } from "../lib/parse.js";

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: "01a1620c-e541-74a2-b0f4-2d7904ef2acd",
  timestamp: 1792586331720,
  cwd: "/Users/example/AgenticProjects/MachineLearning"
});

function jsonl(events) {
  return events.map((event) => (typeof event === "string" ? event : JSON.stringify(event))).join("\n") + "\n";
}

test("解析一个完整会话：五类事件都能落到对应位置", () => {
  const text = jsonl([
    HEADER,
    { type: "model_change", id: "a1", parentId: null, timestamp: 1792586331800, provider: "cpa", modelId: "deepseek-v4.1-flash" },
    { type: "thinking_level_change", id: "a2", parentId: "a1", timestamp: 1792586331900, thinkingLevel: "max" },
    { type: "message", id: "a3", parentId: "a2", timestamp: 1792586332000, message: { role: "system", content: "", sections: { preamble: "You are Feynman…" } } },
    { type: "message", id: "a4", parentId: "a3", timestamp: 1792586333000, message: { role: "user", content: [{ type: "text", text: "帮我查一下近两年的机器学习医学论文" }] } },
    {
      type: "message",
      id: "a5",
      parentId: "a4",
      timestamp: 1792586340000,
      message: {
        role: "assistant",
        provider: "cpa",
        model: "deepseek-v4.1-flash",
        stopReason: "toolUse",
        durationMs: 7000,
        usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, reasoning: 5, totalTokens: 120, cost: { total: 0 } },
        content: [
          { type: "thinking", thinking: "先看看目录里有什么" },
          { type: "text", text: "我先列一下目录。" },
          { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls -a" } }
        ]
      }
    },
    {
      type: "message",
      id: "a6",
      parentId: "a5",
      timestamp: 1792586341000,
      message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: ".planning\nnotes\n" }], isError: false, durationMs: 12 }
    },
    { type: "custom", id: "a7", parentId: "a6", timestamp: 1792586342000, customType: "web-search-results", data: { query: "ml" } },
    { type: "custom_message", id: "a8", parentId: "a7", timestamp: 1792586343000, customType: "subagent-incremental-child-notify", content: "Workflow child completed", display: false },
    { type: "context_edit", id: "a9", parentId: "a8", timestamp: 1792586344000, targetId: "a1b2c3d4", replacement: null }
  ]);

  const record = parseSession(text);

  assert.equal(record.id, "01a1620c-e541-74a2-b0f4-2d7904ef2acd");
  assert.equal(record.cwd, "/Users/example/AgenticProjects/MachineLearning");
  assert.equal(record.version, 3);
  assert.equal(record.provider, "cpa");
  assert.equal(record.model, "deepseek-v4.1-flash");
  assert.equal(record.thinkingLevel, "max");
  assert.equal(record.createdAt, 1792586331720);
  assert.equal(record.updatedAt, 1792586344000);
  assert.equal(record.eventCount, 10);
  assert.equal(record.skippedLines, 0);
  assert.equal(record.skippedUnknownEvents, 0);
  assert.equal(record.truncated, false);
  assert.equal(record.partialTail, false);

  // system 消息被丢弃，所以是 user 1 / assistant 1 / toolResult 1 / note 3
  assert.deepEqual(record.counts, { user: 1, assistant: 1, toolResult: 1, note: 3 });
  assert.equal(record.messages.length, 5);
  assert.equal(record.messages[0].role, "user");
  assert.equal(record.messages[0].text, "帮我查一下近两年的机器学习医学论文");

  const assistant = record.messages[1];
  assert.equal(assistant.role, "assistant");
  assert.deepEqual(assistant.parts.map((part) => part.kind), ["thinking", "text", "toolCall"]);
  assert.equal(assistant.usage.totalTokens, 120);
  assert.equal(assistant.durationMs, 7000);

  // 工具结果按 toolCallId 并回了调用
  const call = assistant.parts[2];
  assert.equal(call.result, ".planning\nnotes\n");
  assert.equal(call.isError, false);
  assert.equal(call.durationMs, 12);

  assert.equal(record.messages[2].role, "note");
  assert.equal(record.messages[2].label, "web-search-results");
  assert.equal(record.messages[3].label, "subagent-incremental-child-notify");
  assert.equal(record.messages[3].text, "Workflow child completed");
  assert.equal(record.messages[4].label, "context_edit");
  assert.match(record.messages[4].text, /上下文条目被删除/);

  assert.equal(record.title, "帮我查一下近两年的机器学习医学论文");
  assert.equal(record.preview, "我先列一下目录。");
});

test("没有 model_change 时字段为空字符串，不抛错", () => {
  const record = parseSession(jsonl([HEADER, { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } }]));
  assert.equal(record.provider, "");
  assert.equal(record.model, "");
  assert.equal(record.thinkingLevel, "");
  assert.equal(record.counts.user, 1);
});

test("中间的坏行被跳过并计数，其余照常解析", () => {
  const text = jsonl([HEADER, "{这不是 JSON", { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } }]);
  const record = parseSession(text);
  assert.equal(record.skippedLines, 1);
  assert.equal(record.partialTail, false);
  assert.equal(record.counts.user, 1);
});

test("末尾写到一半的行标记为 partialTail", () => {
  const text = HEADER + "\n" + '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"半截';
  const record = parseSession(text);
  assert.equal(record.partialTail, true);
  assert.equal(record.skippedLines, 1);
  assert.equal(record.counts.user, 0);
});

test("空文件不炸，标题与预览有兜底", () => {
  const record = parseSession("");
  assert.equal(record.eventCount, 0);
  assert.equal(record.messages.length, 0);
  assert.equal(record.title, "（没有用户提问）");
  assert.equal(record.preview, "");
  assert.equal(record.id, "");
});

test("只有首行时元数据齐、消息为空", () => {
  const record = parseSession(HEADER + "\n");
  assert.equal(record.id, "01a1620c-e541-74a2-b0f4-2d7904ef2acd");
  assert.equal(record.createdAt, 1792586331720);
  assert.equal(record.updatedAt, 1792586331720);
  assert.equal(record.messages.length, 0);
});

test("未知事件类型只计数，不影响其它字段", () => {
  const record = parseSession(jsonl([HEADER, { type: "something_new", id: "x" }, { type: "another", id: "y" }]));
  assert.equal(record.skippedUnknownEvents, 2);
  assert.equal(record.messages.length, 0);
});

test("找不到对应调用的工具结果单独成条，信息不丢", () => {
  const text = jsonl([
    HEADER,
    { type: "message", message: { role: "toolResult", toolCallId: "call_zzz", toolName: "read", content: [{ type: "text", text: "文件内容" }], isError: true, durationMs: 3 } }
  ]);
  const record = parseSession(text);
  assert.equal(record.counts.toolResult, 1);
  assert.equal(record.messages.length, 1);
  assert.equal(record.messages[0].role, "toolResult");
  assert.equal(record.messages[0].name, "read");
  assert.equal(record.messages[0].isError, true);
});

test("超长标题与预览被截断并加省略号", () => {
  const long = "机器学习".repeat(120); // 480 字，超过标题 60 与预览 200 两个上限
  const record = parseSession(
    jsonl([
      HEADER,
      { type: "message", message: { role: "user", content: [{ type: "text", text: long }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: long }] } }
    ])
  );
  assert.equal(Array.from(record.title).length, 61); // 60 字 + 省略号
  assert.ok(record.title.endsWith("…"));
  assert.equal(Array.from(record.preview).length, 201);
});

test("超出 maxEvents 时只保留头尾并标记 truncated", () => {
  const events = [HEADER];
  for (let index = 0; index < 40; index += 1) {
    events.push({ type: "message", timestamp: 1000 + index, message: { role: "user", content: [{ type: "text", text: "第 " + index + " 条" }] } });
  }
  const record = parseSession(jsonl(events), { maxEvents: 5 });
  assert.equal(record.truncated, true);
  assert.equal(record.eventCount, 41);
  assert.equal(record.id, "01a1620c-e541-74a2-b0f4-2d7904ef2acd");
  assert.equal(record.counts.user, 4); // 首行 + 末尾 4 条
  assert.equal(record.messages[0].text, "第 36 条");
  assert.equal(record.messages[3].text, "第 39 条");
});

test("ISO 字符串时间戳也能解析成毫秒", () => {
  const text = jsonl([
    { type: "session", version: 3, id: "iso", timestamp: "2026-10-19T04:59:06.234Z" },
    { type: "message", timestamp: "2026-10-19T06:49:28.511Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }
  ]);
  const record = parseSession(text);
  assert.equal(record.createdAt, Date.parse("2026-10-19T04:59:06.234Z"));
  assert.equal(record.updatedAt, Date.parse("2026-10-19T06:49:28.511Z"));
  assert.equal(record.messages[0].timestamp, Date.parse("2026-10-19T06:49:28.511Z"));
});

test("cwd 缺失时留空字符串", () => {
  const record = parseSession(jsonl([{ type: "session", version: 3, id: "no-cwd" }]));
  assert.equal(record.cwd, "");
  assert.equal(record.id, "no-cwd");
});

test("toListItem 不泄漏 messages", () => {
  const record = parseSession(jsonl([HEADER, { type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } }]));
  const item = toListItem(record, { file: "a.jsonl", sizeBytes: 12 });
  assert.equal(item.title, "hello");
  assert.equal(item.file, "a.jsonl");
  assert.equal(item.sizeBytes, 12);
  assert.equal("messages" in item, false);
});

test("collapse 压平换行与多余空白", () => {
  assert.equal(collapse("  第一行\n\n第二行\t第三行  "), "第一行 第二行 第三行");
});

test("textOf 只取 text 部分", () => {
  assert.equal(textOf([{ type: "thinking", thinking: "想" }, { type: "text", text: "说" }]), "说");
  assert.equal(textOf("直接是字符串"), "直接是字符串");
  assert.equal(textOf(null), "");
});

test("hasControlChars 识别换行与 NUL", () => {
  assert.equal(hasControlChars("正常路径"), false);
  assert.equal(hasControlChars("a\nb"), true);
  assert.equal(hasControlChars("a\u0000b"), true);
});
