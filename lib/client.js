// dsh-feynman-sessions — 浏览器侧（Web 客户端）。
//
// 一个右侧栏面板，管住 ~/.feynman/sessions 里的会话：
//   · 列表、搜索、看完整对话（只读，数据来自本机宿主路由）；
//   · 每条会话一个「继续」按钮：在 DSH 自己的右侧栏开一个真终端，
//     自动全屏，并把 `cd '<工作目录>' && feynman --session '<会话文件>'` 输进去。
//
// 为什么是「开终端 + 输入命令」而不是插件直接跑 feynman：
//   DSH 的终端宿主只接受「开一个 shell」的参数（create 的请求体里没有命令行字段），
//   也没有任何「带命令启动」的官方口子；唯一可靠的办法是把命令当成键盘输入送进 PTY。
//   这样 feynman 的 TUI、交互、工具确认全部原样保留，插件也不去解析它的输出协议。
//
// 本文件按 dsh-client-modules 的 lazy-CJS 模型编写：顶层只注册 factory，
// 副作用全部留在 factory 闭包内，由 apply() 在 materialize 时触发。

window.__ModuleLoader__.load({
  id: '@panando/dsh-feynman-sessions',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var R = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;
    var useRef = React.useRef;

    var PKG = '@panando/dsh-feynman-sessions';
    var VERSION = '0.1.0';
    var TAB_ID = 'dsh-feynman-sessions';
    var ROUTE = '/feynman-sessions';
    var STYLE_ID = PKG + '/style';
    var GLOBAL_KEY = '__dshFeynmanSessions';
    var LOCALE_NS = 'dsh-feynman-sessions';
    var MAX_MESSAGES = 400;
    var TERMINAL_TAB_KIND = 'terminal';

    // ------------------------------------------------------------------
    // 一、文案
    // ------------------------------------------------------------------

    var MESSAGES = {
      zh: {
        tabTitle: 'Feynman 会话',
        tabDescription: '浏览 feynman CLI 的会话，一键在终端里续跑',
        listTitle: 'Feynman 会话',
        searchPlaceholder: '搜索标题、目录、模型…',
        refresh: '刷新',
        loading: '正在读取…',
        empty: '还没有会话',
        emptyHint: '在终端里跑一次 feynman 就会出现在这里。',
        missingDir: '找不到会话目录',
        countLabel: '共 {total} 条，显示 {shown} 条',
        filteredLabel: '匹配 {matched} / {total} 条',
        continue: '继续',
        continuing: '正在开终端…',
        copyCommand: '复制命令',
        copied: '命令已复制',
        back: '返回列表',
        detailTitle: '会话详情',
        loadFailed: '读取失败',
        retry: '重试',
        messagesMore: '后面还有 {rest} 条消息，为保持流畅只渲染前 {shown} 条。',
        truncated: '这个文件很大，只解析了开头与结尾部分事件。',
        partialTail: '文件末尾有一段写了一半的内容，已跳过。',
        notesCount: '注释 {count} 条',
        thinking: '思考过程',
        toolCall: '工具调用',
        toolResult: '结果',
        toolError: '出错',
        args: '参数',
        noCwd: '（没有记录工作目录）',
        terminalOpened: '终端已打开，正在启动 feynman…',
        terminalDone: '已把续跑命令送进终端。',
        terminalNoService: '这个 DSH 客户端没有可用的终端服务，只能复制命令。',
        terminalNoSidebar: '右侧栏服务不可用，无法打开终端。',
        terminalNoSession: '先在左侧选中一个 DSH 会话，再点「继续」。',
        terminalOpenFailed: '打开终端标签失败',
        terminalTimeout: '终端打开超时，可以把下面的命令手动粘进去。',
        terminalNotWritable: '终端还没就绪，可以把下面的命令手动粘进去。',
        terminalLimit: '终端标签数量到上限了，先关掉不用的终端再试。',
        terminalFailed: '终端进程启动失败',
        terminalFullscreenSkipped: '已打开终端，但没能自动全屏（可以手动点标签上的全屏按钮）。',
        commandHint: '命令',
        fileGone: '会话文件已经不在了',
        copyFailed: '复制失败，请手动选中命令',
        hint: '点「继续」会在右侧栏开一个终端，自动全屏并接上这次会话。'
      },
      en: {
        tabTitle: 'Feynman Sessions',
        tabDescription: 'Browse feynman CLI sessions and resume them in a terminal',
        listTitle: 'Feynman Sessions',
        searchPlaceholder: 'Search title, folder, model…',
        refresh: 'Refresh',
        loading: 'Reading…',
        empty: 'No sessions yet',
        emptyHint: 'Run feynman once in a terminal and it shows up here.',
        missingDir: 'Session folder not found',
        countLabel: '{total} total, {shown} shown',
        filteredLabel: '{matched} of {total} matched',
        continue: 'Continue',
        continuing: 'Opening terminal…',
        copyCommand: 'Copy command',
        copied: 'Command copied',
        back: 'Back to list',
        detailTitle: 'Session',
        loadFailed: 'Failed to read',
        retry: 'Retry',
        messagesMore: '{rest} more messages; rendering the first {shown}.',
        truncated: 'This file is large; only the head and tail events were parsed.',
        partialTail: 'A half-written line at the end of the file was skipped.',
        notesCount: '{count} notes',
        thinking: 'Thinking',
        toolCall: 'Tool call',
        toolResult: 'Result',
        toolError: 'Error',
        args: 'Arguments',
        noCwd: '(no working directory recorded)',
        terminalOpened: 'Terminal opened, starting feynman…',
        terminalDone: 'Resume command sent to the terminal.',
        terminalNoService: 'This DSH client has no terminal service; you can only copy the command.',
        terminalNoSidebar: 'Right sidebar service unavailable; cannot open a terminal.',
        terminalNoSession: 'Select a DSH session on the left, then press Continue.',
        terminalOpenFailed: 'Could not open a terminal tab',
        terminalTimeout: 'Opening the terminal timed out; paste the command below.',
        terminalNotWritable: 'The terminal is not ready; paste the command below.',
        terminalLimit: 'Terminal tab limit reached; close one first.',
        terminalFailed: 'The terminal process failed to start',
        terminalFullscreenSkipped: 'Terminal opened, but fullscreen could not be applied (use the tab control).',
        commandHint: 'Command',
        fileGone: 'The session file is gone',
        copyFailed: 'Copy failed; select the command manually',
        hint: 'Continue opens a terminal in the right sidebar, goes fullscreen, and resumes this session.'
      }
    };

    // ------------------------------------------------------------------
    // 二、小工具
    // ------------------------------------------------------------------

    /** 可选服务：缺了返回 null，绝不抛错。 */
    function safeGet(ctx, name) {
      if (!ctx || typeof ctx.get !== 'function') return null;
      try {
        var service = ctx.get(name);
        return service || null;
      } catch (err) {
        return null;
      }
    }

    /**
     * 等某个客户端服务就绪。客户端插件的装载顺序不由我们决定，
     * 直接 ctx.get 有可能拿到 undefined（此时放弃注册就再也不会有面板了）。
     */
    function waitForService(ctx, name, timeoutMs, onReady) {
      var deadline = Date.now() + timeoutMs;
      var cancelled = false;
      function attempt() {
        if (cancelled) return;
        var service = safeGet(ctx, name);
        if (service) {
          onReady(service);
          return;
        }
        if (Date.now() >= deadline) {
          onReady(null);
          return;
        }
        setTimeout(attempt, 120);
      }
      attempt();
      return function cancel() {
        cancelled = true;
      };
    }

    function interpolate(template, values) {
      return String(template).replace(/\{(\w+)\}/g, function (match, key) {
        return values && values[key] !== undefined ? String(values[key]) : match;
      });
    }

    function formatRelative(ms, lang) {
      if (!ms) return '';
      var delta = Date.now() - ms;
      if (delta < 0) delta = 0;
      var minute = 60 * 1000;
      var hour = 60 * minute;
      var day = 24 * hour;
      var zh = lang === 'zh';
      if (delta < minute) return zh ? '刚刚' : 'just now';
      if (delta < hour) {
        var minutes = Math.floor(delta / minute);
        return zh ? minutes + ' 分钟前' : minutes + 'm ago';
      }
      if (delta < day) {
        var hours = Math.floor(delta / hour);
        return zh ? hours + ' 小时前' : hours + 'h ago';
      }
      if (delta < 30 * day) {
        var days = Math.floor(delta / day);
        return zh ? days + ' 天前' : days + 'd ago';
      }
      var date = new Date(ms);
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    function pad2(value) {
      return value < 10 ? '0' + value : String(value);
    }

    function tailOfPath(value) {
      var text = String(value || '');
      if (!text) return '';
      var parts = text.split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : text;
    }

    function formatTokens(usage) {
      if (!usage || !usage.totalTokens) return '';
      var total = usage.totalTokens;
      if (total >= 1000) return (total / 1000).toFixed(total >= 10000 ? 0 : 1) + 'k';
      return String(total);
    }

    function formatDuration(ms) {
      if (!ms && ms !== 0) return '';
      if (ms < 1000) return ms + 'ms';
      return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
    }

    function clip(value, max) {
      var text = String(value == null ? '' : value);
      if (text.length <= max) return text;
      return text.slice(0, max) + '…';
    }

    function jsonText(value, max) {
      if (value === undefined) return '';
      var text;
      try {
        text = JSON.stringify(value, null, 2);
      } catch (err) {
        text = String(value);
      }
      return clip(text, max);
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (err) {
        /* 落到下面的兜底 */
      }
      try {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(area);
        return ok !== false;
      } catch (err) {
        return false;
      }
    }

    function delay(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** 轮询直到 read() 返回真值或超时。返回 {value} 或 {timeout:true}。 */
    async function pollUntil(read, timeoutMs, intervalMs) {
      var deadline = Date.now() + timeoutMs;
      var step = intervalMs || 100;
      for (;;) {
        var value;
        try {
          value = read();
        } catch (err) {
          value = undefined;
        }
        if (value) return { value: value };
        if (Date.now() >= deadline) return { timeout: true };
        await delay(step);
      }
    }

    async function fetchJson(pathname, signal) {
      var response = await fetch(ROUTE + pathname, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: signal
      });
      var payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        payload = null;
      }
      if (!response.ok) {
        var message = payload && payload.error ? String(payload.error) : 'HTTP ' + response.status;
        var failure = new Error(message);
        failure.status = response.status;
        failure.payload = payload;
        throw failure;
      }
      return payload || {};
    }

    // ------------------------------------------------------------------
    // 三、终端编排：点「继续」之后的全部动作
    // ------------------------------------------------------------------

    var TERMINAL_LIMIT_PATTERN = /limit|maximum|too many/i;

    function tabList(sidebar) {
      try {
        if (sidebar && sidebar.openTabs && typeof sidebar.openTabs.getSnapshot === 'function') {
          var snapshot = sidebar.openTabs.getSnapshot();
          return Array.isArray(snapshot) ? snapshot : [];
        }
      } catch (err) {
        /* 没有在屏会话时这里会抛，忽略 */
      }
      return [];
    }

    function tabKindOf(tab) {
      if (!tab || typeof tab !== 'object') return '';
      return String(tab.kind || tab.type || '');
    }

    /** 右栏标签记录的 id 字段叫 tabId；容错地兼容只给 id 的版本。 */
    function tabIdOf(tab) {
      if (!tab || typeof tab !== 'object') return '';
      var id = tab.tabId || tab.id || '';
      return typeof id === 'string' ? id : '';
    }

    /** 从 betterSidebar 传进来的 scope 里取 DSH 会话 id。 */
    function sessionIdOfScope(scope) {
      if (scope && typeof scope.sessionId === 'string' && scope.sessionId) return scope.sessionId;
      return '';
    }

    /**
     * 右栏展开之后再切全屏。openTab 是异步落位的：刚调用完 isExpanded() 还是 false，
     * 此时 toggleFullscreen 会静默返回（它内部就有一句 !isExpanded() 直接 return）。
     * @returns 是否真的切过全屏（已经处于全屏时返回 false，不算失败）
     */
    async function expandFullscreen(sidebar, tabId) {
      if (typeof sidebar.toggleFullscreen !== 'function' || typeof sidebar.commandTarget !== 'function') return false;
      var ready = await pollUntil(function () {
        if (typeof sidebar.isExpanded === 'function' && sidebar.isExpanded() !== true) return null;
        if (tabId && typeof sidebar.active === 'function' && typeof sidebar.focus === 'function') {
          var active = null;
          try {
            active = sidebar.active();
          } catch (err) {
            active = null;
          }
          var activeId = tabIdOf(active);
          if (activeId && activeId !== tabId) {
            try {
              sidebar.focus(tabId);
            } catch (err) {
              /* 忽略：下一轮再试 */
            }
            return null;
          }
        }
        return { target: sidebar.commandTarget(null) || null };
      }, 2500, 100);
      if (ready.timeout || !ready.value || !ready.value.target) return false;
      sidebar.toggleFullscreen(ready.value.target);
      return true;
    }

    /**
     * 开终端 → 等它出现 → 全屏 → 等可写 → 输入命令。
     * @returns {{ok:true, terminalId:string|null, fullscreen:boolean}|{ok:false, code:string, message:string, command?:string}}
     */
    async function openSessionTerminal(ctx, session, options) {
      var settings = options || {};
      var command = settings.command || '';
      var onStage = typeof settings.onStage === 'function' ? settings.onStage : function () {};
      var sessionId = settings.sessionId || '';

      var sidebar = safeGet(ctx, 'sidebarRight');
      if (!sidebar || typeof sidebar.openTab !== 'function') {
        return { ok: false, code: 'noSidebar', message: 'right sidebar service unavailable' };
      }
      var terminals = safeGet(ctx, 'webTerminals');
      if (!terminals || typeof terminals.view !== 'function') {
        return { ok: false, code: 'noTerminalService', message: 'terminal service unavailable' };
      }
      if (!sessionId) return { ok: false, code: 'noSession', message: 'no session on screen' };
      if (!command) return { ok: false, code: 'noCommand', message: 'command is empty' };

      onStage('opening');
      var before = {};
      tabList(sidebar).forEach(function (existing) {
        var known = tabIdOf(existing);
        if (known) before[known] = true;
      });

      try {
        sidebar.openTab(TERMINAL_TAB_KIND, { params: {} });
      } catch (err) {
        var text = String((err && err.message) || err);
        return { ok: false, code: TERMINAL_LIMIT_PATTERN.test(text) ? 'terminalLimit' : 'openFailed', message: text, command: command };
      }

      var found = await pollUntil(function () {
        var tabs = tabList(sidebar);
        for (var index = tabs.length - 1; index >= 0; index -= 1) {
          var candidate = tabs[index];
          var candidateId = tabIdOf(candidate);
          if (!candidateId || before[candidateId]) continue;
          var kind = tabKindOf(candidate);
          if (kind && kind !== TERMINAL_TAB_KIND) continue;
          return candidate;
        }
        return null;
      }, 5000, 100);
      if (found.timeout) return { ok: false, code: 'timeout', message: 'terminal tab did not appear', command: command };

      var tab = found.value;
      var tabId = tabIdOf(tab);
      if (!tabId) return { ok: false, code: 'timeout', message: 'terminal tab has no id', command: command };

      onStage('fullscreen');
      var fullscreen = false;
      try {
        fullscreen = await expandFullscreen(sidebar, tabId);
      } catch (err) {
        fullscreen = false;
      }

      onStage('typing');
      var contentId = (tab && tab.contentId) || tabId;
      var view = terminals.view(sessionId, tabId, contentId);
      // 终端正文挂载后 view 才会连接并变成可写；正文可能还没渲染，这里主动 mount 一次，
      // 它是幂等的（重复 mount 只会重连，不会多开进程）。
      try {
        if (typeof view.mount === 'function') view.mount();
      } catch (err) {
        /* 忽略：下面还有可写轮询兜底 */
      }

      var writable = await pollUntil(function () {
        var state = typeof view.state === 'object' && view.state && typeof view.state.getSnapshot === 'function'
          ? view.state.getSnapshot()
          : null;
        return state && state.writable === true ? state : null;
      }, 8000, 120);
      if (writable.timeout) return { ok: false, code: 'notWritable', message: 'terminal never became writable', command: command, terminalId: view.id || null };

      // 可写只说明输入通道接上了，登录 shell 自己的启动脚本可能还在跑；
      // 这时候抢着敲字符，字符会被 readline 的初始化吞掉，所以先等一小段。
      await delay(300);

      try {
        view.write(command + '\r');
      } catch (err) {
        return { ok: false, code: 'writeFailed', message: String((err && err.message) || err), command: command, terminalId: view.id || null };
      }

      await delay(400);
      var after = null;
      try {
        after = typeof view.state.getSnapshot === 'function' ? view.state.getSnapshot() : null;
      } catch (err) {
        after = null;
      }
      if (after && after.phase === 'failed') {
        return { ok: false, code: 'failed', message: String(after.error || 'terminal failed'), command: command, terminalId: view.id || null };
      }
      return { ok: true, terminalId: view.id || null, fullscreen: fullscreen };
    }

    // ------------------------------------------------------------------
    // 四、样式
    // ------------------------------------------------------------------

    var CSS = [
      '[data-dsh-feynman-sessions]{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:inherit}',
      '[data-dsh-feynman-sessions] *{box-sizing:border-box}',
      '[data-dsh-feynman-sessions] .fs-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-border,rgba(127,127,127,.22));flex:0 0 auto}',
      '[data-dsh-feynman-sessions] .fs-title{font-weight:600;font-size:13px;white-space:nowrap}',
      '[data-dsh-feynman-sessions] .fs-count{color:var(--dsw-text-secondary,rgba(127,127,127,.9));font-size:11px;white-space:nowrap}',
      '[data-dsh-feynman-sessions] .fs-search{flex:1 1 auto;min-width:60px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-border,rgba(127,127,127,.3));background:var(--dsw-surface-secondary,rgba(127,127,127,.08));color:inherit;font:inherit;outline:none}',
      '[data-dsh-feynman-sessions] .fs-search:focus{border-color:var(--dsw-accent,#4c8dff)}',
      '[data-dsh-feynman-sessions] .fs-btn{appearance:none;border:1px solid var(--dsw-border,rgba(127,127,127,.3));background:var(--dsw-surface-secondary,rgba(127,127,127,.08));color:inherit;font:inherit;padding:3px 9px;border-radius:6px;cursor:pointer;white-space:nowrap}',
      '[data-dsh-feynman-sessions] .fs-btn:hover{border-color:var(--dsw-accent,#4c8dff)}',
      '[data-dsh-feynman-sessions] .fs-btn[disabled]{opacity:.55;cursor:default}',
      '[data-dsh-feynman-sessions] .fs-primary{background:var(--dsw-accent,#4c8dff);border-color:transparent;color:#fff;font-weight:600}',
      '[data-dsh-feynman-sessions] .fs-body{flex:1 1 auto;min-height:0;overflow:auto}',
      '[data-dsh-feynman-sessions] .fs-row{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--dsw-border,rgba(127,127,127,.14));cursor:pointer}',
      '[data-dsh-feynman-sessions] .fs-row:hover{background:var(--dsw-surface-hover,rgba(127,127,127,.08))}',
      '[data-dsh-feynman-sessions] .fs-row[data-selected="true"]{background:var(--dsw-surface-selected,rgba(76,141,255,.12))}',
      '[data-dsh-feynman-sessions] .fs-row-main{flex:1 1 auto;min-width:0}',
      '[data-dsh-feynman-sessions] .fs-row-title{font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}',
      '[data-dsh-feynman-sessions] .fs-row-meta{margin-top:2px;color:var(--dsw-text-secondary,rgba(127,127,127,.9));font-size:11px;display:flex;flex-wrap:wrap;gap:6px}',
      '[data-dsh-feynman-sessions] .fs-dot{opacity:.5}',
      '[data-dsh-feynman-sessions] .fs-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px}',
      '[data-dsh-feynman-sessions] .fs-empty{padding:24px 16px;color:var(--dsw-text-secondary,rgba(127,127,127,.9));text-align:center;line-height:1.6}',
      '[data-dsh-feynman-sessions] .fs-notice{margin:8px 10px;padding:7px 9px;border-radius:6px;border:1px solid var(--dsw-border,rgba(127,127,127,.3));background:var(--dsw-surface-secondary,rgba(127,127,127,.08));line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '[data-dsh-feynman-sessions] .fs-notice[data-kind="error"]{border-color:rgba(220,80,80,.6);background:rgba(220,80,80,.1)}',
      '[data-dsh-feynman-sessions] .fs-notice-command{margin-top:6px;padding:6px;border-radius:4px;background:rgba(0,0,0,.18);font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px;user-select:text;white-space:pre-wrap;word-break:break-all}',
      '[data-dsh-feynman-sessions] .fs-detail-head{position:sticky;top:0;z-index:2;background:var(--dsw-surface-panel,inherit);padding:8px 10px;border-bottom:1px solid var(--dsw-border,rgba(127,127,127,.22))}',
      '[data-dsh-feynman-sessions] .fs-detail-title{font-weight:600;line-height:1.4;word-break:break-word}',
      '[data-dsh-feynman-sessions] .fs-actions{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}',
      '[data-dsh-feynman-sessions] .fs-messages{padding:6px 10px 24px;display:flex;flex-direction:column;gap:10px}',
      '[data-dsh-feynman-sessions] .fs-msg{border:1px solid var(--dsw-border,rgba(127,127,127,.18));border-radius:8px;padding:8px 10px;background:var(--dsw-surface-card,rgba(127,127,127,.04));line-height:1.6;word-break:break-word}',
      '[data-dsh-feynman-sessions] .fs-msg[data-role="user"]{background:var(--dsw-surface-selected,rgba(76,141,255,.1));border-color:rgba(76,141,255,.35)}',
      '[data-dsh-feynman-sessions] .fs-msg[data-role="note"]{border-style:dashed;color:var(--dsw-text-secondary,rgba(127,127,127,.95));font-size:11px;padding:5px 8px}',
      '[data-dsh-feynman-sessions] .fs-msg-head{display:flex;gap:8px;align-items:baseline;font-size:11px;color:var(--dsw-text-secondary,rgba(127,127,127,.9));margin-bottom:4px}',
      '[data-dsh-feynman-sessions] .fs-role{font-weight:600;color:inherit}',
      '[data-dsh-feynman-sessions] .fs-text{white-space:pre-wrap}',
      '[data-dsh-feynman-sessions] details.fs-fold{margin-top:6px;border-left:2px solid var(--dsw-border,rgba(127,127,127,.3));padding-left:8px}',
      '[data-dsh-feynman-sessions] details.fs-fold>summary{cursor:pointer;color:var(--dsw-text-secondary,rgba(127,127,127,.95));font-size:11px;user-select:none}',
      '[data-dsh-feynman-sessions] .fs-pre{margin:4px 0 0;padding:6px;border-radius:4px;background:rgba(0,0,0,.16);overflow:auto;max-height:280px;font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px;white-space:pre-wrap;word-break:break-word}',
      '[data-dsh-feynman-sessions] .fs-tool{margin-top:6px;border:1px solid var(--dsw-border,rgba(127,127,127,.25));border-radius:6px;padding:6px 8px}',
      '[data-dsh-feynman-sessions] .fs-tool[data-error="true"]{border-color:rgba(220,80,80,.6)}',
      '[data-dsh-feynman-sessions] .fs-tool-name{font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px;font-weight:600}',
      '[data-dsh-feynman-sessions] .fs-badge{display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;font-size:10px;background:rgba(220,80,80,.2)}',
      '[data-dsh-feynman-sessions] .fs-icon{display:inline-flex;align-items:center;justify-content:center}',
      '[data-dsh-feynman-sessions] .fs-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    ].join('\n');

    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-plugin', PKG);
      style.setAttribute('data-plugin-css', PKG);
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // 五、组件
    // ------------------------------------------------------------------

    function TabIcon(size) {
      var unit = size || 14;
      return R(
        'svg',
        { width: unit, height: unit, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', className: 'fs-icon' },
        R('path', { d: 'M8 1.6 9.4 6l4.4 1.4L9.4 8.8 8 13.2 6.6 8.8 2.2 7.4 6.6 6Z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
        R('circle', { cx: '12.6', cy: '3.4', r: '1.1', fill: 'currentColor' })
      );
    }

    function MessageBlock(props) {
      var message = props.message;
      var t = props.t;
      var lang = props.lang;
      if (message.role === 'user') {
        return R(
          'div',
          { className: 'fs-msg', 'data-role': 'user' },
          R('div', { className: 'fs-msg-head' }, R('span', { className: 'fs-role' }, 'You'), R('span', {}, formatRelative(message.timestamp, lang))),
          R('div', { className: 'fs-text' }, message.text)
        );
      }
      if (message.role === 'note') {
        return R(
          'div',
          { className: 'fs-msg', 'data-role': 'note' },
          R('div', { className: 'fs-msg-head' }, R('span', { className: 'fs-role' }, message.label || 'note'), R('span', {}, formatRelative(message.timestamp, lang))),
          message.text ? R('div', { className: 'fs-pre' }, message.text) : null
        );
      }
      if (message.role === 'toolResult') {
        return R(
          'div',
          { className: 'fs-msg', 'data-role': 'tool', 'data-error': message.isError ? 'true' : 'false' },
          R(
            'div',
            { className: 'fs-msg-head' },
            R('span', { className: 'fs-role fs-mono' }, message.name || 'tool'),
            R('span', {}, t('toolResult')),
            message.isError ? R('span', { className: 'fs-badge' }, t('toolError')) : null
          ),
          R('pre', { className: 'fs-pre' }, message.text)
        );
      }
      var parts = Array.isArray(message.parts) ? message.parts : [];
      var meta = [];
      if (message.model) meta.push(message.model);
      if (message.durationMs) meta.push(formatDuration(message.durationMs));
      if (message.usage) {
        var tokens = formatTokens(message.usage);
        if (tokens) meta.push(tokens + ' tok');
      }
      return R(
        'div',
        { className: 'fs-msg', 'data-role': 'assistant' },
        R(
          'div',
          { className: 'fs-msg-head' },
          R('span', { className: 'fs-role' }, 'Feynman'),
          meta.length ? R('span', {}, meta.join(' · ')) : null,
          R('span', {}, formatRelative(message.timestamp, lang))
        ),
        parts.map(function (part, index) {
          if (part.kind === 'text') return R('div', { className: 'fs-text', key: 't' + index }, part.text);
          if (part.kind === 'thinking') {
            return R(
              'details',
              { className: 'fs-fold', key: 'k' + index },
              R('summary', {}, t('thinking')),
              R('div', { className: 'fs-text' }, part.text)
            );
          }
          if (part.kind === 'toolCall') {
            var args = jsonText(part.arguments, 2400);
            return R(
              'div',
              { className: 'fs-tool', key: 'c' + index, 'data-error': part.isError ? 'true' : 'false' },
              R(
                'div',
                { className: 'fs-msg-head' },
                R('span', { className: 'fs-tool-name' }, part.name || 'tool'),
                part.durationMs ? R('span', {}, formatDuration(part.durationMs)) : null,
                part.isError ? R('span', { className: 'fs-badge' }, t('toolError')) : null
              ),
              args
                ? R('details', { className: 'fs-fold' }, R('summary', {}, t('args')), R('pre', { className: 'fs-pre' }, args))
                : null,
              part.result !== null && part.result !== undefined
                ? R('details', { className: 'fs-fold' }, R('summary', {}, t('toolResult')), R('pre', { className: 'fs-pre' }, part.result))
                : null
            );
          }
          return null;
        })
      );
    }

    function Panel(props) {
      var ctx = props.ctx;
      var scope = props.scope;
      var visible = props.visible !== false;
      var t = props.translate;
      var getLang = props.getLang;

      var lang = getLang();
      var sessionId = sessionIdOfScope(scope);

      var listState = useState({ status: 'idle', error: '', data: null });
      var setListState = listState[1];
      var listSnapshot = listState[0];
      var queryState = useState('');
      var query = queryState[0];
      var setQuery = queryState[1];
      var selectedState = useState(null);
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var detailState = useState({ status: 'idle', file: '', data: null, error: '' });
      var setDetailState = detailState[1];
      var detail = detailState[0];
      var noticeState = useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];
      var busyState = useState('');
      var busy = busyState[0];
      var setBusy = busyState[1];
      var reloadToken = useState(0);
      var bumpReload = reloadToken[1];
      var scrollRef = useRef(null);

      // 列表加载（查询变化时防抖 220ms）
      useEffect(function () {
        if (!visible) return undefined;
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () {
          setListState(function (previous) {
            return { status: previous.data ? 'refreshing' : 'loading', error: '', data: previous.data };
          });
          var search = query.trim() ? '?query=' + encodeURIComponent(query.trim()) : '';
          fetchJson('/list' + search, controller ? controller.signal : undefined)
            .then(function (data) {
              setListState({ status: 'ready', error: '', data: data });
            })
            .catch(function (error) {
              if (error && error.name === 'AbortError') return;
              setListState(function (previous) {
                return { status: previous.data ? 'ready' : 'error', error: String((error && error.message) || error), data: previous.data };
              });
            });
        }, 220);
        return function () {
          clearTimeout(timer);
          if (controller) controller.abort();
        };
      }, [visible, query, props.reload]);

      // 详情加载
      useEffect(function () {
        if (!selected) {
          setDetailState({ status: 'idle', file: '', data: null, error: '' });
          return undefined;
        }
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        setDetailState({ status: 'loading', file: selected, data: null, error: '' });
        fetchJson('/session?file=' + encodeURIComponent(selected), controller ? controller.signal : undefined)
          .then(function (data) {
            setDetailState({ status: 'ready', file: selected, data: data, error: '' });
          })
          .catch(function (error) {
            if (error && error.name === 'AbortError') return;
            setDetailState({ status: 'error', file: selected, data: null, error: String((error && error.message) || error) });
          });
        return function () {
          if (controller) controller.abort();
        };
      }, [selected, props.reload]);

      var sessions = (listSnapshot.data && Array.isArray(listSnapshot.data.sessions)) ? listSnapshot.data.sessions : [];
      var total = listSnapshot.data && typeof listSnapshot.data.total === 'number' ? listSnapshot.data.total : 0;
      var matched = listSnapshot.data && typeof listSnapshot.data.matched === 'number' ? listSnapshot.data.matched : sessions.length;

      async function continueSession(session) {
        if (!session || busy) return;
        setBusy(session.file);
        setNotice({ kind: 'info', text: t('continuing') });
        var result;
        try {
          result = await openSessionTerminal(ctx, session, {
            command: session.command,
            sessionId: sessionId,
            onStage: function (stage) {
              if (stage === 'typing') setNotice({ kind: 'info', text: t('terminalOpened') });
            }
          });
        } catch (error) {
          result = { ok: false, code: 'exception', message: String((error && error.message) || error), command: session.command };
        }
        setBusy('');
        if (result) {
          try {
            window.__dshFeynmanSessions.lastContinue = result;
          } catch (err) {
            /* 忽略：只是诊断用 */
          }
        }
        if (result.ok) {
          setNotice({ kind: 'info', text: result.fullscreen ? t('terminalDone') : t('terminalDone') + ' ' + t('terminalFullscreenSkipped') });
          return;
        }
        var text = t('loadFailed');
        if (result.code === 'noSidebar') text = t('terminalNoSidebar');
        else if (result.code === 'noTerminalService') text = t('terminalNoService');
        else if (result.code === 'noSession') text = t('terminalNoSession');
        else if (result.code === 'terminalLimit') text = t('terminalLimit');
        else if (result.code === 'timeout') text = t('terminalTimeout');
        else if (result.code === 'notWritable') text = t('terminalNotWritable');
        else if (result.code === 'failed') text = t('terminalFailed');
        else if (result.code === 'openFailed') text = t('terminalOpenFailed') + (result.message ? '：' + result.message : '');
        else text = t('terminalFailed') + (result.message ? '：' + result.message : '');
        setNotice({ kind: 'error', text: text, command: result.command || session.command });
      }

      async function copyCommand(session) {
        var ok = await copyText(session.command || '');
        setNotice({ kind: ok ? 'info' : 'error', text: ok ? t('copied') : t('copyFailed'), command: ok ? '' : (session.command || '') });
      }

      // ---- 列表视图 ----
      function renderList() {
        if (listSnapshot.status === 'loading' && !sessions.length) {
          return R('div', { className: 'fs-empty' }, t('loading'));
        }
        if (listSnapshot.status === 'error') {
          return R(
            'div',
            { className: 'fs-empty' },
            R('div', {}, t('loadFailed') + '：' + listSnapshot.error),
            R('div', { style: { marginTop: 8 } }, R('button', { className: 'fs-btn', type: 'button', onClick: function () { bumpReload(function (value) { return value + 1; }); } }, t('retry')))
          );
        }
        if (!sessions.length) {
          var missing = listSnapshot.data && listSnapshot.data.exists === false;
          return R(
            'div',
            { className: 'fs-empty' },
            R('div', { style: { fontWeight: 600 } }, missing ? t('missingDir') : t('empty')),
            R('div', { className: 'fs-mono', style: { marginTop: 6, userSelect: 'text' } }, missing ? String(listSnapshot.data.root || '') : ''),
            R('div', { style: { marginTop: 8 } }, t('emptyHint'))
          );
        }
        return R(
          'div',
          { className: 'fs-list' },
          sessions.map(function (session) {
            var meta = [];
            if (session.cwd) meta.push(tailOfPath(session.cwd));
            if (session.model) meta.push(session.model);
            if (session.updatedAt) meta.push(formatRelative(session.updatedAt, lang));
            var counts = session.counts || {};
            var activity = (counts.user || 0) + (counts.assistant || 0);
            if (activity) meta.push(activity + (lang === 'zh' ? ' 轮消息' : ' msgs'));
            var running = busy === session.file;
            return R(
              'div',
              {
                key: session.file,
                className: 'fs-row',
                'data-selected': selected === session.file ? 'true' : 'false',
                role: 'button',
                tabIndex: 0,
                onClick: function () { setSelected(session.file); },
                onKeyDown: function (event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(session.file);
                  }
                }
              },
              R(
                'div',
                { className: 'fs-row-main' },
                R('div', { className: 'fs-row-title' }, session.title || session.file),
                R(
                  'div',
                  { className: 'fs-row-meta' },
                  meta.map(function (piece, index) {
                    return R('span', { key: 'm' + index }, index ? R('span', { className: 'fs-dot' }, ' · ') : null, piece);
                  })
                )
              ),
              R(
                'button',
                {
                  type: 'button',
                  className: 'fs-btn fs-primary',
                  disabled: running || !session.command,
                  title: session.command || '',
                  onClick: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    void continueSession(session);
                  }
                },
                running ? t('continuing') : t('continue')
              )
            );
          })
        );
      }

      // ---- 详情视图 ----
      function renderDetail() {
        var data = detail.status === 'ready' ? detail.data : null;
        var session = data ? data.session : null;
        var head = R(
          'div',
          { className: 'fs-detail-head' },
          R(
            'div',
            { className: 'fs-actions' },
            R('button', { type: 'button', className: 'fs-btn', onClick: function () { setSelected(null); } }, '← ' + t('back')),
            R(
              'button',
              {
                type: 'button',
                className: 'fs-btn fs-primary',
                disabled: !!busy || !(session && session.command),
                onClick: function () { if (session) void continueSession(session); }
              },
              busy ? t('continuing') : t('continue')
            ),
            R('button', { type: 'button', className: 'fs-btn', disabled: !(session && session.command), onClick: function () { if (session) void copyCommand(session); } }, t('copyCommand'))
          ),
          session
            ? R(
              'div',
              { style: { marginTop: 8 } },
              R('div', { className: 'fs-detail-title' }, session.title || session.file),
              R(
                'div',
                { className: 'fs-row-meta' },
                R('span', { className: 'fs-mono' }, session.cwd || t('noCwd')),
                session.model ? R('span', {}, R('span', { className: 'fs-dot' }, ' · '), session.model) : null,
                session.updatedAt ? R('span', {}, R('span', { className: 'fs-dot' }, ' · '), formatRelative(session.updatedAt, lang)) : null
              )
            )
            : null
        );

        if (detail.status === 'loading') {
          return R('div', null, head, R('div', { className: 'fs-empty' }, t('loading')));
        }
        if (detail.status === 'error') {
          return R(
            'div',
            null,
            head,
            R('div', { className: 'fs-empty' }, t('loadFailed') + '：' + detail.error)
          );
        }
        if (!data) return R('div', null, head, R('div', { className: 'fs-empty' }, t('loading')));

        var messages = Array.isArray(data.messages) ? data.messages : [];
        var shown = messages.slice(0, MAX_MESSAGES);
        var rest = messages.length - shown.length;
        var warnings = [];
        if (data.session && data.session.truncated) warnings.push(t('truncated'));
        if (data.session && data.session.partialTail) warnings.push(t('partialTail'));

        return R(
          'div',
          null,
          head,
          warnings.length
            ? R('div', { className: 'fs-notice' }, warnings.join(' '))
            : null,
          rest > 0
            ? R('div', { className: 'fs-notice' }, interpolate(t('messagesMore'), { rest: rest, shown: shown.length }))
            : null,
          R(
            'div',
            { className: 'fs-messages' },
            shown.map(function (message, index) {
              return R(MessageBlock, { key: 'msg' + index, message: message, t: t, lang: lang });
            })
          )
        );
      }

      var countText = '';
      if (listSnapshot.data) {
        countText = query.trim()
          ? interpolate(t('filteredLabel'), { matched: matched, total: total })
          : interpolate(t('countLabel'), { total: total, shown: sessions.length });
      }

      return R(
        'div',
        { 'data-dsh-feynman-sessions': 'true' },
        R(
          'div',
          { className: 'fs-toolbar' },
          R('span', { className: 'fs-title' }, t('listTitle')),
          selected ? null : R('input', {
            className: 'fs-search',
            type: 'search',
            value: query,
            placeholder: t('searchPlaceholder'),
            onChange: function (event) { setQuery(event.target.value); }
          }),
          R('span', { className: 'fs-count' }, countText),
          selected
            ? null
            : R(
              'button',
              {
                type: 'button',
                className: 'fs-btn',
                disabled: listSnapshot.status === 'loading',
                onClick: function () { bumpReload(function (value) { return value + 1; }); }
              },
              t('refresh')
            )
        ),
        notice
          ? R(
            'div',
            { className: 'fs-notice', 'data-kind': notice.kind === 'error' ? 'error' : 'info', role: 'status' },
            notice.text,
            notice.command
              ? R(
                'div',
                null,
                R('div', { className: 'fs-mono', style: { marginTop: 6, opacity: 0.8 } }, t('commandHint')),
                R('div', { className: 'fs-notice-command' }, notice.command)
              )
              : null,
            R(
              'div',
              { style: { marginTop: 6 } },
              R('button', { type: 'button', className: 'fs-btn', onClick: function () { setNotice(null); } }, 'OK')
            )
          )
          : null,
        R('div', { className: 'fs-body', ref: scrollRef }, selected ? renderDetail() : R('div', null, renderList(), R('div', { className: 'fs-empty', style: { paddingTop: 8, fontSize: 11 } }, t('hint'))))
      );
    }

    // ------------------------------------------------------------------
    // 六、装载
    // ------------------------------------------------------------------

    function apply(ctx) {
      installStyles();
      var langRef = 'zh';
      var translate = function (key) {
        var table = MESSAGES[langRef] || MESSAGES.zh;
        return table[key] !== undefined ? table[key] : (MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key);
      };
      try {
        if (ctx && ctx.locale) {
          ctx.locale.register(LOCALE_NS, { zh: MESSAGES.zh, en: MESSAGES.en });
          var bound = ctx.locale.bind(LOCALE_NS);
          if (typeof bound === 'function') translate = bound;
          var snapshot = typeof ctx.locale.getSnapshot === 'function' ? ctx.locale.getSnapshot() : null;
          var active = snapshot && (snapshot.active || snapshot.locale || snapshot.language || snapshot);
          langRef = String(active || 'zh').toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
          if (typeof ctx.locale.subscribe === 'function') {
            ctx.locale.subscribe(function () {
              var current = ctx.locale.getSnapshot();
              var value = current && (current.active || current.locale || current.language || current);
              langRef = String(value || 'zh').toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
            });
          }
        }
      } catch (err) {
        /* 语言服务缺失时用中文兜底 */
      }

      function getLang() {
        return langRef;
      }

      function warn(message) {
        try {
          if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[feynman-sessions] ' + message);
        } catch (err) {
          /* 忽略 */
        }
      }

      var descriptor = {
        id: TAB_ID,
        title: function () { return translate('tabTitle'); },
        description: function () { return translate('tabDescription'); },
        icon: function (size) { return TabIcon(size); },
        order: 60,
        component: function (tabProps) {
          return R(Panel, {
            ctx: ctx,
            scope: tabProps && tabProps.scope,
            visible: tabProps ? tabProps.visible : true,
            reload: tabProps && tabProps.reload,
            translate: translate,
            getLang: getLang
          });
        }
      };

      ctx.effect(function () {
        var unregister = null;
        var cancel = waitForService(ctx, 'betterSidebar', 8000, function (service) {
          if (!service || typeof service.registerTab !== 'function') {
            warn('betterSidebar service is unavailable; the panel will not be registered');
            return;
          }
          unregister = service.registerTab(descriptor);
        });
        return function () {
          cancel();
          if (typeof unregister === 'function') unregister();
        };
      }, 'feynman-sessions: sidebar tab');

      // 排查与真机验证用的全局句柄（只读 + 打开面板）。
      try {
        window[GLOBAL_KEY] = {
          version: VERSION,
          tabId: TAB_ID,
          open: function () {
            try {
              var right = safeGet(ctx, 'sidebarRight');
              if (right && typeof right.openTab === 'function') {
                right.openTab(TAB_ID, {});
                return true;
              }
            } catch (err) {
              /* 落到 betterSidebar */
            }
            var sidebar = safeGet(ctx, 'betterSidebar');
            if (!sidebar || typeof sidebar.openTab !== 'function') return false;
            try {
              sidebar.openTab({ type: TAB_ID });
              return true;
            } catch (err) {
              return false;
            }
          },
          list: async function (query) {
            return fetchJson('/list' + (query ? '?query=' + encodeURIComponent(query) : ''));
          },
          session: async function (file) {
            return fetchJson('/session?file=' + encodeURIComponent(file));
          },
          services: function () {
            return {
              betterSidebar: !!safeGet(ctx, 'betterSidebar'),
              sidebarRight: !!safeGet(ctx, 'sidebarRight'),
              webTerminals: !!safeGet(ctx, 'webTerminals')
            };
          }
        };
      } catch (err) {
        /* 忽略 */
      }
    }

    exports.apply = apply;
    exports.inject = ['locale'];
    exports.__internals = { MESSAGES: MESSAGES, openSessionTerminal: openSessionTerminal, PKG: PKG, VERSION: VERSION };
    return module.exports;
  }
});
