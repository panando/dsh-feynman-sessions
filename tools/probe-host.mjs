// 用假 ctx + 假 req/res 直接调用宿主路由，验证只读接口对真实 ~/.feynman/sessions 可用。
// 用法：node tools/probe-host.mjs
import { apply, isLoopbackAddress } from "../lib/index.js";

let handler;
const ctx = {
  effect(fn) {
    fn();
  },
  webServer: {
    register(route) {
      handler = route.handler;
      return () => {};
    }
  }
};
apply(ctx, {});

function fakeRes() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(body) {
      this.writableEnded = true;
      if (body) chunks.push(String(body));
      this.body = chunks.join("");
    }
  };
}

async function call(pathname) {
  const res = fakeRes();
  const req = {
    method: "GET",
    url: pathname,
    headers: { host: "127.0.0.1:38917", "sec-fetch-site": "same-origin" },
    socket: { remoteAddress: "127.0.0.1" }
  };
  await handler(req, res);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

/** 模拟浏览器发 POST（带 JSON 请求体与 same-origin 头）。 */
async function post(pathname, body) {
  const res = fakeRes();
  const text = JSON.stringify(body || {});
  const req = {
    method: "POST",
    url: pathname,
    headers: {
      host: "127.0.0.1:38917",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text))
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(text);
  };
  await handler(req, res);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

const health = await call("/feynman-sessions/health");
console.log("health", health.status, JSON.stringify(health.data));

const list = await call("/feynman-sessions/list");
console.log("list", list.status, "total=", list.data.total, "matched=", list.data.matched);
const first = list.data.sessions[0];
console.log(
  "first:",
  JSON.stringify({ title: first.title, cwd: first.cwd, model: first.model, counts: first.counts, updatedAt: first.updatedAt, command: first.command }, null, 1)
);

const detail = await call("/feynman-sessions/session?file=" + encodeURIComponent(first.file));
console.log("session", detail.status, "messages=", detail.data.messages.length, "skipped=", JSON.stringify(detail.data.skipped));
console.log(
  "roles:",
  detail.data.messages
    .slice(0, 6)
    .map((message) => message.role + ":" + (message.parts ? message.parts.map((part) => part.kind).join("+") : message.label || ""))
    .join(" | ")
);

const search = await call("/feynman-sessions/list?query=" + encodeURIComponent("机器学习"));
console.log("search 机器学习 ->", search.data.matched, "/", search.data.total);

const bad = await call("/feynman-sessions/session?file=../x.jsonl");
console.log("traversal ->", bad.status, bad.data.error);

const missing = await call("/feynman-sessions/session?file=nope.jsonl");
console.log("missing ->", missing.status, missing.data.error);

const postList = fakeRes();
await handler({ method: "POST", url: "/feynman-sessions/list", headers: {}, socket: { remoteAddress: "127.0.0.1" } }, postList);
console.log("POST ->", postList.statusCode, postList.headers.allow);

console.log("loopback:", isLoopbackAddress("127.0.0.1"), isLoopbackAddress("::1"), isLoopbackAddress("10.0.0.5"));

const options = await call("/feynman-sessions/start-options");
console.log("start-options", options.status, "presets=", options.data.presets.map((item) => item.key).join(","), "react=", options.data.limits && options.data.limits.react);

const started = await post("/feynman-sessions/start", {
  cwd: "/Users/panando/AgenticProjects/DSH",
  presetKeys: ["FEYNMAN_TELEMETRY"],
  envText: "FOO=bar"
});
console.log("start", started.status, JSON.stringify({ cwd: started.data.cwd, command: started.data.command, env: started.data.env }));

const startedDefault = await post("/feynman-sessions/start", { cwd: "/tmp" });
console.log("start(no env)", startedDefault.status, startedDefault.data.command);

const badEnv = await post("/feynman-sessions/start", { cwd: "/tmp", envText: "nokey\n1BAD=x" });
console.log("start(bad env) ->", badEnv.status, badEnv.data.error, JSON.stringify(badEnv.data.errors));

const badCwd = await post("/feynman-sessions/start", { cwd: "relative/path" });
console.log("start(bad cwd) ->", badCwd.status, badCwd.data.error);

const resumed = await post("/feynman-sessions/resume", {
  file: first.file,
  presetKeys: ["FEYNMAN_TELEMETRY", "NO_COLOR"],
  envText: "FEYNMAN_THINKING=max"
});
console.log("resume", resumed.status, resumed.data.command);
console.log("resume env:", JSON.stringify(resumed.data.env));

const resumedPlain = await post("/feynman-sessions/resume", { file: first.file });
console.log("resume(no env)", resumedPlain.status, resumedPlain.data.command);

const resumeUnknown = await post("/feynman-sessions/resume", { file: "nope.jsonl" });
console.log("resume(unknown) ->", resumeUnknown.status, resumeUnknown.data.error);

const resumeTraversal = await post("/feynman-sessions/resume", { file: "../x.jsonl" });
console.log("resume(traversal) ->", resumeTraversal.status, resumeTraversal.data.error);

const postUnknown = await post("/feynman-sessions/nope", {});
console.log("POST unknown ->", postUnknown.status, postUnknown.data ? postUnknown.data.error : "(empty body)");
