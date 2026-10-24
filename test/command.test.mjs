import test from "node:test";
import assert from "node:assert/strict";

import { buildResumeCommand, shellQuote } from "../lib/command.js";

test("普通路径：cd 到工作目录再接 --session", () => {
  assert.equal(
    buildResumeCommand({ cwd: "/Users/example/project", file: "/Users/example/.feynman/sessions/s1.jsonl" }),
    "cd '/Users/example/project' && 'feynman' --session '/Users/example/.feynman/sessions/s1.jsonl'"
  );
});

test("带空格与中文的路径用单引号包住", () => {
  assert.equal(
    buildResumeCommand({ cwd: "/Users/example/我的 项目", file: "/tmp/a b.jsonl", bin: "/usr/local/bin/feynman" }),
    "cd '/Users/example/我的 项目' && '/usr/local/bin/feynman' --session '/tmp/a b.jsonl'"
  );
});

test("路径里的单引号转义成 '\\''", () => {
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(
    buildResumeCommand({ cwd: "/tmp/it's here", file: "/tmp/o'brien.jsonl" }),
    "cd '/tmp/it'\\''s here' && 'feynman' --session '/tmp/o'\\''brien.jsonl'"
  );
});

test("没有 cwd 时不加 cd 前缀", () => {
  assert.equal(buildResumeCommand({ file: "/tmp/s.jsonl" }), "'feynman' --session '/tmp/s.jsonl'");
  assert.equal(buildResumeCommand({ cwd: "", file: "/tmp/s.jsonl" }), "'feynman' --session '/tmp/s.jsonl'");
});

test("默认把 feynman 当可执行名", () => {
  assert.match(buildResumeCommand({ cwd: "/tmp", file: "/tmp/s.jsonl" }), /&& 'feynman' --session/);
  assert.match(buildResumeCommand({ cwd: "/tmp", file: "/tmp/s.jsonl", bin: "" }), /&& 'feynman' --session/);
});

test("空文件路径抛错", () => {
  assert.throws(() => buildResumeCommand({}), /session file path is required/);
  assert.throws(() => buildResumeCommand(), /session file path is required/);
});

test("控制字符抛错（避免把整行命令拆坏）", () => {
  assert.throws(() => buildResumeCommand({ cwd: "/tmp", file: "/tmp/a\nb.jsonl" }), /control characters/);
  assert.throws(() => buildResumeCommand({ cwd: "/tmp/x\r", file: "/tmp/s.jsonl" }), /control characters/);
});
