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

const post = fakeRes();
await handler({ method: "POST", url: "/feynman-sessions/list", headers: {}, socket: { remoteAddress: "127.0.0.1" } }, post);
console.log("POST ->", post.statusCode, post.headers.allow);

console.log("loopback:", isLoopbackAddress("127.0.0.1"), isLoopbackAddress("::1"), isLoopbackAddress("10.0.0.5"));
