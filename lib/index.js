// dsh-feynman-sessions — 宿主运行时。
//
// 只做四件事：
//   1. 读 ~/.feynman/sessions 里的会话文件（只读，从不写）；
//   2. 把它们解析成结构化的列表与对话记录（解析器是纯函数，见 lib/parse.js）；
//   3. 在本机回环地址上开只读接口，供 DSH 的 Web 客户端取用；
//   4. 拼「续跑」与「开新会话」两条命令（含环境变量），交给客户端输入终端。
//
// 真正的 feynman 进程不在宿主里：客户端在右侧栏开一个终端，由那个终端里的登录 shell 启动。

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { buildResumeCommand, buildStartCommand } from "./command.js";
import { ENV_PRESETS, MAX_ENV_KEY_CHARS, MAX_ENV_LINES, MAX_ENV_VALUE_CHARS, resolveEnv } from "./env.js";
import { parseSession, toListItem } from "./parse.js";

const VERSION = "0.2.0";
const ROUTE_PREFIX = "/feynman-sessions";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 6000;
const MAX_QUERY_CHARS = 200;

const DEFAULTS = {
  sessionDir: "",
  feynmanBin: "feynman",
  limit: DEFAULT_LIMIT,
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  maxEvents: DEFAULT_MAX_EVENTS
};

export const name = "feynman-sessions";
export const inject = ["webServer"];

// ---------------------------------------------------------------------------
// 小工具

function errorWithStatus(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details && typeof details === "object") error.details = details;
  return error;
}

function json(res, statusCode, value) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

function methodAllowed(req, res, expected) {
  if (req.method === expected) return true;
  res.writeHead(405, { allow: expected, "cache-control": "no-store" });
  res.end();
  return false;
}

export function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("127.") || value.startsWith("::ffff:127.")) return true;
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(value);
}

function assertLocalReadRequest(req) {
  const remote = req.socket && req.socket.remoteAddress;
  if (!isLoopbackAddress(remote)) {
    throw errorWithStatus(403, "only local requests are allowed");
  }
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined) {
    const value = String(site);
    if (value !== "same-origin" && value !== "none") {
      throw errorWithStatus(403, "cross-site request rejected");
    }
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost;
    try {
      originHost = new URL(String(origin)).host;
    } catch (_) {
      throw errorWithStatus(403, "invalid origin");
    }
    if (originHost !== req.headers.host) throw errorWithStatus(403, "origin does not match host");
  }
}

function expandHome(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return path.join(homedir(), text.slice(2));
  return text;
}

/**
 * 「继续」按钮的现场记录。客户端每次尝试都会把结果 POST 过来，
 * 我们只追加一行 JSON，方便出问题时直接看文件，不用让用户开控制台。
 * @returns 日志文件的绝对路径。
 */
function debugLogPath() {
  const configured = expandHome(process.env.DSH_FEYNMAN_SESSIONS_LOG || "");
  if (configured) return configured;
  return path.join(homedir(), ".feynman", "dsh-feynman-sessions-debug.log");
}

async function readJsonBody(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw errorWithStatus(413, "request body is too large");
    chunks.push(chunk);
  }
  if (!total) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (_) {
    throw errorWithStatus(400, "request body must be valid JSON");
  }
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const configuredDir = expandHome(input.sessionDir);
  const root = configuredDir || path.join(homedir(), ".feynman", "sessions");
  const bin = typeof input.feynmanBin === "string" && input.feynmanBin.trim() ? input.feynmanBin.trim() : DEFAULTS.feynmanBin;
  const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.min(Math.floor(input.limit), MAX_LIMIT) : DEFAULTS.limit;
  const maxFileBytes = Number.isFinite(input.maxFileBytes) && input.maxFileBytes > 0 ? Math.floor(input.maxFileBytes) : DEFAULTS.maxFileBytes;
  const maxEvents = Number.isFinite(input.maxEvents) && input.maxEvents > 1 ? Math.floor(input.maxEvents) : DEFAULTS.maxEvents;
  return { root, bin, limit, maxFileBytes, maxEvents };
}

// ---------------------------------------------------------------------------
// 索引

class SessionIndex {
  constructor(settings) {
    this.settings = settings;
    this.entries = new Map(); // basename -> { file, path, sizeBytes, mtimeMs, record }
    this.dirState = { exists: false, error: "" };
  }

  /** 重新读目录并刷新发生变化的文件。返回按最后更新时间倒序的条目数组。 */
  async refresh() {
    let names;
    try {
      names = await fs.readdir(this.settings.root, { withFileTypes: true });
    } catch (error) {
      this.entries.clear();
      this.dirState = { exists: false, error: error && error.code ? String(error.code) : String(error && error.message || error) };
      return [];
    }
    this.dirState = { exists: true, error: "" };
    const seen = new Set();
    const results = [];
    for (const entry of names) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".jsonl")) continue;
      seen.add(entry.name);
      const fullPath = path.join(this.settings.root, entry.name);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch (_) {
        continue;
      }
      if (!stat.isFile()) continue;
      const cached = this.entries.get(entry.name);
      if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        results.push(cached);
        continue;
      }
      const loaded = await this.loadFile(entry.name, fullPath, stat);
      if (loaded) {
        this.entries.set(entry.name, loaded);
        results.push(loaded);
      }
    }
    for (const key of Array.from(this.entries.keys())) {
      if (!seen.has(key)) this.entries.delete(key);
    }
    results.sort((left, right) => (right.record.updatedAt || 0) - (left.record.updatedAt || 0));
    return results;
  }

  async loadFile(fileName, fullPath, stat) {
    let text;
    try {
      text = await fs.readFile(fullPath, "utf8");
    } catch (_) {
      return null;
    }
    const oversized = stat.size > this.settings.maxFileBytes;
    const record = parseSession(text, { maxEvents: oversized ? this.settings.maxEvents : Infinity });
    if (!record.id) record.id = fileName.replace(/\.jsonl$/, "");
    return { file: fileName, path: fullPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, oversized, record };
  }

  /** 把一条索引条目投影成列表项（含续跑命令）。 */
  listItem(entry) {
    let command = "";
    let commandError = "";
    try {
      command = buildResumeCommand({ cwd: entry.record.cwd, file: entry.path, bin: this.settings.bin });
    } catch (error) {
      commandError = String(error && error.message || error);
    }
    return toListItem(entry.record, {
      file: entry.file,
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      mtimeMs: entry.mtimeMs,
      oversized: entry.oversized,
      command,
      commandError
    });
  }
}

// ---------------------------------------------------------------------------
// 插件

export function apply(ctx, rawConfig) {
  const settings = normalizeConfig(rawConfig);
  const index = new SessionIndex(settings);
  let refreshInFlight = null;

  async function ensureFresh() {
    // 并发请求共用一次刷新，避免同时扫目录。
    if (!refreshInFlight) {
      refreshInFlight = index.refresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!needles.length) return true;
    const haystack = [item.title, item.preview, item.cwd, item.model, item.provider, item.id, item.file]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return needles.every((needle) => haystack.includes(needle));
  }

  async function healthHandler(req, res) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalReadRequest(req);
    json(res, 200, {
      ok: true,
      version: VERSION,
      root: settings.root,
      exists: existsSync(settings.root),
      bin: settings.bin
    });
  }

  async function listHandler(req, res, url) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalReadRequest(req);
    const entries = await ensureFresh();
    const rawQuery = String(url.searchParams.get("query") || "").slice(0, MAX_QUERY_CHARS);
    const requestedLimit = Number.parseInt(String(url.searchParams.get("limit") || ""), 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : settings.limit;
    const all = entries.map((entry) => index.listItem(entry));
    const filtered = all.filter((item) => matchesQuery(item, rawQuery));
    json(res, 200, {
      ok: true,
      root: settings.root,
      exists: index.dirState.exists,
      dirError: index.dirState.error,
      total: all.length,
      matched: filtered.length,
      sessions: filtered.slice(0, limit)
    });
  }

  async function sessionHandler(req, res, url) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalReadRequest(req);
    const file = String(url.searchParams.get("file") || "").trim();
    if (!file) throw errorWithStatus(400, "file is required");
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
      throw errorWithStatus(400, "file must be a plain session file name");
    }
    const entries = await ensureFresh();
    const entry = entries.find((candidate) => candidate.file === file);
    if (!entry) throw errorWithStatus(404, "session file is not in the current index");
    // 详情请求可能命中正在被 feynman 追加的文件，重新读一遍拿最新内容。
    const fresh = await statOrNull(entry.path);
    const reloaded = fresh ? await index.loadFile(entry.file, entry.path, fresh) : null;
    const current = reloaded || entry;
    if (reloaded) index.entries.set(reloaded.file, reloaded);
    const record = current.record;
    json(res, 200, {
      ok: true,
      session: index.listItem(current),
      messages: record.messages,
      limits: { truncated: record.truncated, partialTail: record.partialTail },
      skipped: {
        lines: record.skippedLines,
        unknownEvents: record.skippedUnknownEvents
      }
    });
  }

  /** 启动选项：勾选框里能选哪些变量，以及手动输入框的上限。 */
  async function startOptionsHandler(req, res) {
    if (!methodAllowed(req, res, "GET")) return;
    assertLocalReadRequest(req);
    json(res, 200, {
      ok: true,
      presets: ENV_PRESETS.map((preset) => ({ key: preset.key, value: preset.value, label: preset.label })),
      limits: { maxLines: MAX_ENV_LINES, maxKeyChars: MAX_ENV_KEY_CHARS, maxValueChars: MAX_ENV_VALUE_CHARS }
    });
  }

  /**
   * 生成「开一个新会话」的命令。命令由宿主拼好再交给客户端输入终端，
   * 这样引号与转义只有一处实现，也便于单测覆盖。
   */
  async function startHandler(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalReadRequest(req);
    const type = String(req.headers["content-type"] || "");
    if (!type.includes("application/json")) throw errorWithStatus(415, "content-type must be application/json");
    const body = await readJsonBody(req, 32 * 1024);
    const cwd = String((body && body.cwd) || "").trim();
    const presetKeys = Array.isArray(body && body.presetKeys) ? body.presetKeys.map((key) => String(key)) : [];
    const envText = String((body && body.envText) || "");
    if (cwd && !path.isAbsolute(cwd)) throw errorWithStatus(400, "working directory must be an absolute path", { cwd });
    if (cwd && !existsSync(cwd)) throw errorWithStatus(400, "working directory does not exist", { cwd });
    const resolved = resolveEnv(presetKeys, envText);
    if (resolved.errors.length > 0) {
      throw errorWithStatus(400, "environment variables are not valid", { errors: resolved.errors });
    }
    let command;
    try {
      command = buildStartCommand({ cwd, bin: settings.bin, env: resolved.entries });
    } catch (error) {
      throw errorWithStatus(400, String((error && error.message) || error));
    }
    json(res, 200, { ok: true, command, cwd, bin: settings.bin, env: resolved.entries });
  }

  /**
   * 生成「继续某个会话」的命令。和 /start 一样由宿主拼命令，区别是带 `--session`，
   * 并把启动选项里勾选/手写的环境变量一起挂在命令前面（只影响这一条命令）。
   */
  async function resumeHandler(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalReadRequest(req);
    const type = String(req.headers["content-type"] || "");
    if (!type.includes("application/json")) throw errorWithStatus(415, "content-type must be application/json");
    const body = await readJsonBody(req, 32 * 1024);
    const file = String((body && body.file) || "").trim();
    if (!file) throw errorWithStatus(400, "session file is required");
    if (/[/\\]/.test(file) || file.startsWith(".")) {
      throw errorWithStatus(400, "file must be a plain session file name", { file });
    }
    const presetKeys = Array.isArray(body && body.presetKeys) ? body.presetKeys.map((key) => String(key)) : [];
    const envText = String((body && body.envText) || "");
    const entries = await ensureFresh();
    const entry = entries.find((candidate) => candidate.file === file);
    if (!entry) throw errorWithStatus(404, "session file is not in the current index");
    const resolved = resolveEnv(presetKeys, envText);
    if (resolved.errors.length > 0) {
      throw errorWithStatus(400, "environment variables are not valid", { errors: resolved.errors });
    }
    let command;
    try {
      command = buildResumeCommand({
        cwd: entry.record.cwd,
        file: entry.path,
        bin: settings.bin,
        env: resolved.entries
      });
    } catch (error) {
      throw errorWithStatus(400, String((error && error.message) || error));
    }
    json(res, 200, { ok: true, command, file: entry.file, bin: settings.bin, env: resolved.entries });
  }

  async function debugHandler(req, res) {
    if (!methodAllowed(req, res, "POST")) return;
    assertLocalReadRequest(req);
    const type = String(req.headers["content-type"] || "");
    if (!type.includes("application/json")) throw errorWithStatus(415, "content-type must be application/json");
    const body = await readJsonBody(req, 64 * 1024);
    const file = debugLogPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...(body || {}) })}\n`, "utf8");
    json(res, 200, { ok: true, path: file });
  }

  async function routeHandler(req, res) {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const subpath = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname;
      if (subpath === "/health") return await healthHandler(req, res);
      if (subpath === "/list") return await listHandler(req, res, url);
      if (subpath === "/session") return await sessionHandler(req, res, url);
      if (subpath === "/start-options") return await startOptionsHandler(req, res);
      if (subpath === "/start") return await startHandler(req, res);
      if (subpath === "/resume") return await resumeHandler(req, res);
      if (subpath === "/debug") return await debugHandler(req, res);
      res.writeHead(404, { "cache-control": "no-store" });
      res.end();
      return undefined;
    } catch (error) {
      json(res, (error && error.statusCode) || 500, {
        ok: false,
        error: String((error && error.message) || error),
        ...((error && error.details && typeof error.details === "object") ? error.details : {})
      });
      return undefined;
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: routeHandler }), "feynman-sessions: read-only routes");
}

async function statOrNull(target) {
  try {
    const stat = await fs.stat(target);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (_) {
    return null;
  }
}
