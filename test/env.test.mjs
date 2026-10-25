import test from "node:test";
import assert from "node:assert/strict";

import {
  ENV_PRESETS,
  buildEnvPrefix,
  entriesFromPresets,
  parseEnvText,
  resolveEnv
} from "../lib/env.js";

test("parseEnvText 读取 KEY=VALUE，跳过空行与注释", () => {
  const { entries, errors } = parseEnvText("\n# 注释\nNO_COLOR=1\n\nFEYNMAN_TELEMETRY = off \n");
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [
    { key: "NO_COLOR", value: "1" },
    { key: "FEYNMAN_TELEMETRY", value: "off" }
  ]);
});

test("parseEnvText 去掉成对引号，值里的空格保留", () => {
  const { entries } = parseEnvText("A='x y'\nB=\"z\"\nC=x y");
  assert.deepEqual(entries, [
    { key: "A", value: "x y" },
    { key: "B", value: "z" },
    { key: "C", value: "x y" }
  ]);
});

test("parseEnvText 同一个键以最后一行为准", () => {
  const { entries } = parseEnvText("A=1\nB=2\nA=3");
  assert.deepEqual(entries, [
    { key: "A", value: "3" },
    { key: "B", value: "2" }
  ]);
});

test("parseEnvText 拒绝非法行并报行号", () => {
  const { entries, errors } = parseEnvText("GOOD=1\nnokey\n1BAD=x\nA B=x");
  assert.equal(entries.length, 1);
  assert.equal(errors.length, 3);
  assert.deepEqual(errors.map((error) => error.line), [2, 3, 4]);
  assert.match(errors[0].message, /KEY=VALUE/);
  assert.match(errors[1].message, /invalid variable name/);
});

test("parseEnvText 拒绝超长值与超多行", () => {
  const long = parseEnvText("A=" + "x".repeat(1001));
  assert.equal(long.errors.length, 1);
  assert.match(long.errors[0].message, /longer than 1000/);

  const many = parseEnvText(Array.from({ length: 41 }, (_, index) => `K${index}=1`).join("\n"));
  assert.equal(many.errors.length, 1);
  assert.match(many.errors[0].message, /more than 40 entries/);
});

test("parseEnvText 拒绝控制字符", () => {
  const { errors } = parseEnvText("A=x\u0001y");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /control characters/);
});

test("buildEnvPrefix 单引号包裹并转义内部单引号", () => {
  assert.equal(buildEnvPrefix([]), "");
  assert.equal(buildEnvPrefix([{ key: "A", value: "1" }]), "A='1'");
  assert.equal(buildEnvPrefix([{ key: "A", value: "it's" }]), "A='it'\\''s'");
  assert.equal(buildEnvPrefix([{ key: "A", value: "" }]), "A=''");
  assert.throws(() => buildEnvPrefix([{ key: "1A", value: "x" }]), /invalid environment variable name/);
  assert.throws(() => buildEnvPrefix([{ key: "A", value: "x\u0007" }]), /control characters/);
});

test("entriesFromPresets 只保留预设表里的键", () => {
  assert.deepEqual(entriesFromPresets(["NO_COLOR", "NOPE"]), [{ key: "NO_COLOR", value: "1" }]);
  assert.deepEqual(entriesFromPresets(undefined), []);
});

test("resolveEnv 手动输入覆盖同名勾选项", () => {
  const { entries, errors } = resolveEnv(["FEYNMAN_TELEMETRY", "NO_COLOR"], "NO_COLOR=0");
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [
    { key: "FEYNMAN_TELEMETRY", value: "off" },
    { key: "NO_COLOR", value: "0" }
  ]);
});

test("预设表的每一项都有真实键名与说明", () => {
  assert.ok(ENV_PRESETS.length >= 3);
  for (const preset of ENV_PRESETS) {
    assert.match(preset.key, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(typeof preset.value, "string");
    assert.ok(preset.value.length > 0);
    assert.ok(preset.label.zh.length > 0);
    assert.ok(preset.label.en.length > 0);
  }
});
