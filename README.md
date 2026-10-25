# @panando/dsh-feynman-sessions

给 DeepSeek Harness（DSH）加一个 **Feynman 会话台**：右侧栏多一页，列出本机 `feynman` CLI 的全部历史会话，能搜索、能看完整对话；每条会话一个「继续」按钮，点下去 DSH 在右侧栏开一个真终端、自动铺满全屏，替你把 `cd '<工作目录>' && feynman --session '<会话文件>'` 敲进去执行——于是你在 DSH 窗口里接着上次的 feynman 对话聊，feynman 的界面、工具、斜杠命令全部原样保留。同一页还有一个「开启新会话」按钮，用来在当前工作目录里从头开一个 feynman，可以顺带设好环境变量（例如关掉匿名统计）。

插件本身不启动 feynman 进程（由终端里的 shell 启动它），不写 feynman 的任何文件，也不改 DSH 本体。

## 它解决什么问题

在 DSH 的终端里手敲 `feynman --session ...` 也能用，问题是会话散在 `~/.feynman/sessions` 的一堆 JSONL 文件里，文件名是「时间戳 + 一串随机 id」，光看名字分不清哪个是哪个，想找上次那条得一个个 `cat` 开头。

这个插件把那些文件读成可读的列表和对话，并把「接着聊」变成一次点击。

## 安装

```bash
# 1) 装进当前 profile（会写 profile 的 bundles 并装依赖）
dsh plugin install @panando/dsh-feynman-sessions

# 2) 重启 DSH
```

也可以在 DSH 的插件管理器里按包名安装。装完重启，右侧栏就能看到 **Feynman 会话**。

从源码本地开发（软链，改代码刷新页面即生效）：

```bash
./scripts/link-plugin.sh dsh-feynman-sessions desktop
```

## 需要什么

| 依赖 | 说明 |
| --- | --- |
| DSH | `0.2.1-rc.2` 及以上（用到右侧栏标签注册点与终端服务） |
| `feynman` CLI | 本机已装且能在登录 shell 的 PATH 里找到；找不到就把 `feynmanBin` 配成绝对路径 |
| `dsh-better-sidebar` | 必需，它提供「往右侧栏注册一页」的能力 |
| DSH 自带右侧栏终端 | 「继续」按钮需要它；缺了按钮自动退化成「复制命令」 |

## 用起来是什么样

1. 右侧栏多一项 **Feynman 会话**。
2. 打开是列表，按最后更新时间倒序；每行显示标题、工作目录末段、模型、相对时间、消息数。
3. 顶部搜索框按标题、工作目录、模型过滤。
4. 点一行进详情：用户提问、助手回答、思考过程（折叠）、每次工具调用的参数与结果、出错标红，以及网页抓取、子代理通知这类注释。
5. 点「继续」：右侧栏开出终端标签并自动全屏，终端里出现并执行续跑命令，feynman 接上这条会话的历史。
6. 点「开启新会话」：在当前 DSH 会话的工作目录下启动一个全新的 feynman，效果等于在该目录里敲 `feynman`。
7. 顶部「启动选项」可以关掉匿名统计、降低颜色、打开调试，或手写任意 `KEY=VALUE`；这些只对用「开启新会话」启动的那一次生效，选择记在浏览器里，下次还在。
8. 退出全屏回到标签栏，终端与进程都还在；关掉标签等于结束那个 feynman 进程。

## 怎么做到的（三条关键约束）

**一、数据只在宿主读，浏览器只发 GET。** 宿主提供 `/feynman-sessions/{health,list,session,start-options}` 四条只读路由：只接受回环地址、只接受同源请求，`session` 参数只认已扫描索引里的文件名，拼完路径还要复核仍在会话目录下。浏览器拿不到任意文件读权限。

**二、命令由宿主拼，浏览器只发请求。** 两条 POST 路由：`/start` 收 `{cwd, presetKeys, envText}` 生成新会话命令；`/resume` 收 `{file, presetKeys, envText}` 生成带 `--session` 的续跑命令。两条都校验工作目录与每一行环境变量，再拼成 `cd '<目录>' && KEY='value' … 'feynman' [--session '<文件>']`。引号与转义只有一处实现（`lib/command.js`、`lib/env.js`），前端拿到的永远是一条可以直接粘贴的命令。

**三、会话格式是 pi 血统。** 每行一个 JSON 事件，类型有 `session`、`model_change`、`thinking_level_change`、`message`、`custom`、`custom_message`、`context_edit`。`message.role` 有四种：`system`（整套 preamble，跳过不显示）、`user`、`assistant`（内含 `thinking`、`text`、`toolCall`）、`toolResult`（用 `toolCallId` 回连调用）。时间戳是 ISO 字符串，解析器统一转成毫秒。

**四、「继续」只能是「开终端 + 敲命令」。** DSH 创建终端的请求体只有 `{id, cols, rows, shellPath?}`，没有「带命令行启动」的字段；`shellPath` 也必须是宿主自己发现的 shell 之一，所以包一层启动脚本的办法走不通。唯一可靠的路是等终端可写之后，把命令当键盘输入写进 PTY。

由此带来三个实现细节，都是踩过的坑：

- **标签 id 叫 `tabId`**：右侧栏给我的标签清单记录是 `{sessionId, tabId, kind, contentId}`，没有 `id`，按 `id` 找新标签永远找不到。
- **全屏要等右侧栏展开**：`toggleFullscreen()` 开头有一句「没展开就直接返回」，刚 `openTab()` 完右侧栏还在开，这一下会被静默丢掉。所以先轮询到展开、确认活动标签就是它，再切。
- **可写不等于 shell 就绪**：输入通道接上时登录 shell 的启动脚本可能还在跑，抢着敲字符会被 readline 吞掉，中间留了 0.3 秒缓冲。

## 启动选项里的环境变量

「启动选项」对两个按钮都生效：「开启新会话」用它拼启动命令，「继续」和「复制命令」用它拼续跑命令。一共两层，可以叠加：

| 方式 | 作用 |
| --- | --- |
| 勾选框 | 内置四条常用变量，见下表 |
| 手动输入 | 每行一条 `KEY=VALUE`，`#` 开头的行当注释；同名变量以手写为准 |

勾选框里的四条：

| 变量 | 作用 |
| --- | --- |
| `FEYNMAN_TELEMETRY=off` | 关掉 feynman 自己的匿名使用统计 |
| `FEYNMAN_DEBUG=1` | 打印单条 CLI 诊断，例如统计发送失败的原因 |
| `NO_COLOR=1` | 不输出颜色；日志、录屏更清楚，对复制粘贴也更友好 |
| `PI_IMAGE_PROTOCOL=none` | 不尝试在终端里内联画图；DSH 的终端是 xterm.js，看不懂这类转义序列 |

值得手写进「手动输入」的变量（都来自 feynman 自带的使用手册与其底层 pi 的官方文档）：

| 用途 | 变量 | 说明 |
| --- | --- | --- |
| 关掉 pi 层遥测 | `PI_TELEMETRY=0` | 关掉底层 pi 的安装/更新统计与提供方来源标记 |
| 跳过版本检查 | `PI_SKIP_VERSION_CHECK=1` | 启动时不去 `pi.dev` 查新版本，省一次联网 |
| 当次换模型 | `FEYNMAN_MODEL=provider/model` | 等同 `--model`，只影响这一次启动 |
| 当次换思考等级 | `FEYNMAN_THINKING=max` | 等同 `--thinking` |
| 当次换服务层级 | `FEYNMAN_SERVICE_TIER=flex` | 等同 `--service-tier`；`flex` 更便宜更慢，`priority` 更高优先 |
| 换一套会话目录 | `FEYNMAN_HOME=/path/to/dir` | 改用 `<该目录>/.feynman`，适合按项目分家 |
| 放开文献检索配额 | `OPENALEX_API_KEY`、`SEMANTIC_SCHOLAR_API_KEY`、`NCBI_API_KEY`、`CROSSREF_MAILTO` | 前三个是自己的密钥，填上就不和别人挤匿名池；`CROSSREF_MAILTO` 填你的邮箱，Crossref 会把你放进更快的礼貌池 |
| 网页检索密钥 | `EXA_API_KEY`、`TAVILY_API_KEY`、`PERPLEXITY_API_KEY` | 提高网页检索的限额与稳定性 |
| 保留版式转 Markdown | `DATALAB_API_KEY` | PDF 转 Markdown 时保留原版式 |
| 走代理 | `HTTP_PROXY`、`HTTPS_PROXY` | 出网请求统一走代理 |
| 指定外部工具 | `PUPPETEER_EXECUTABLE_PATH`、`PANDOC_PATH`、`MERMAID_CLI_PATH` | 浏览器/文档转换/图表渲染的可执行文件路径；装在非标准位置时才需要 |
| 长期一点缓存 | `PI_CACHE_RETENTION=long` | 让支持的提供方把提示词缓存留更久，长任务更省钱 |
| 彻底离线 | `PI_OFFLINE=1` | 关掉自动联网（含模型目录刷新），只用手上已有的配置 |

规则与限制都是宿主校验的，前端只负责收集：

- 变量名必须是 `[A-Za-z_][A-Za-z0-9_]*`，值里不能有换行、制表符等控制字符。
- 一行最多 1000 字符，一次最多 40 条。
- 值里的空格保留；成对的单引号或双引号会被去掉。
- 写进命令时每个值是 `KEY='...'` 形式，内部单引号按 `'\''` 转义，所以值里带引号也不会把命令拆坏。
- 想让值引用 shell 里已有的变量（例如把密钥留在 shell 里），按 feynman 手册的写法写成 `"$MY_API_KEY"`；只写 `MY_API_KEY` 会把名字本身当成密钥发出去。

## 配置

写在 profile 的 `cordis.patch.yml` 里本条目下：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `sessionDir` | `~/.feynman/sessions` | 会话目录；也认 `$FEYNMAN_HOME/sessions` |
| `feynmanBin` | `feynman` | 写进续跑命令的可执行名；PATH 找不到就填绝对路径 |
| `limit` | `200` | 列表最多返回多少条 |
| `maxFileBytes` | `8388608` | 单文件最多读多少字节，超出只解析头尾 |
| `maxEvents` | `6000` | 单文件最多解析多少事件，超出截断并在详情里标注 |

## 失败时会怎样

| 情况 | 表现 |
| --- | --- |
| 没有终端服务或右侧栏服务 | 「继续」退化成「复制命令」，并说明原因 |
| 终端标签 5 秒内没出现 | 提示超时，并把命令显示出来供手动粘贴 |
| 终端 8 秒内不可写 | 同上 |
| 命令写进终端后没有回显 | 提示「命令没被终端接收」，并把命令显示出来供手动粘贴 |
| 终端数量到上限 | 提示先关掉不用的终端 |
| 当前没选中 DSH 会话 | 提示先在左侧选中一个会话 |
| 会话目录不存在 | 列表空状态并显示当前配置路径 |
| 全屏切换失败 | 只是不全屏，续跑照常进行 |
| 工作目录不存在或不是绝对路径 | 「开启新会话」拒绝执行，并指出是目录问题 |
| 环境变量写错 | 「开启新会话」拒绝执行，并给出出错的行号与原因 |

## 已知限制

- **不写 feynman 的会话文件**：只读浏览；「继续」与「开启新会话」都是把命令交给终端，文件由 feynman 自己维护。
- **不把 feynman 会话变成 DSH 原生会话**：那样会丢掉 feynman 的 TUI 交互（人工确认、斜杠命令、子代理面板）。
- **终端标签跟着 DSH 会话走**：切到别的 DSH 会话看不到它，切回来还在。
- **每点一次「继续」或「开启新会话」新增一个终端标签**：宿主有数量上限，超了会明确提示。
- **PATH 依赖**：桌面 App 的登录 shell 若没有 nvm 的 bin 目录，`feynman` 会找不到，此时配 `feynmanBin` 为绝对路径。
- **启动选项是浏览器级记忆**：同一台机器同一个浏览器共享一份，不按 DSH 会话区分。

## 开发

```bash
npm run check     # node --check 五个入口
npm test          # 36 个纯函数单测（解析器 + 命令拼接 + 环境变量）
npm run probe     # 假 ctx 加假 req/res 直接打真实路由，不依赖 DSH 进程
```

真机自检：在 DSH 页面控制台里

```js
__dshFeynmanSessions.services()                  // 三个服务是否就位
__dshFeynmanSessions.open()                      // 打开会话台标签
await __dshFeynmanSessions.list()                // 直接看列表数据
await __dshFeynmanSessions.session('<文件名>')   // 看详情数据
__dshFeynmanSessions.lastContinue                // 上一次点「继续」停在哪一步
```

### 排错

每次点「继续」都会往 `~/.feynman/dsh-feynman-sessions-debug.log` 追加一行，含：

- `result`：成功与否、失败码（`timeout` / `notWritable` / `writeDropped` / `failed` 等）、实际执行的命令；
- `sidebar.screenSessionId`：右侧栏当时绑定的 DSH 会话；
- `sidebar.adopted`：本面板所属会话的右栏状态是否已就绪；
- `sidebar.tabs`：右栏当前所有标签（含终端标签）；
- `openVia`：这次用的是 `openTabIn` 还是退回 `openTab`。

日志路径可用环境变量 `DSH_FEYNMAN_SESSIONS_LOG` 改。日志只写本机，不发往任何地方。

## 文件

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主：扫描、缓存、四条只读路由、开新会话的 POST 路由 |
| `lib/parse.js` | 纯函数解析器（可单测） |
| `lib/command.js` | 纯函数命令拼接与 shell 转义（续跑命令、新会话命令） |
| `lib/env.js` | 纯函数环境变量：预设表、`KEY=VALUE` 解析与校验 |
| `lib/client.js` | Web 客户端：会话台面板、启动选项、终端编排 |
| `test/` | 解析器、命令拼接、环境变量的单元测试 |
| `tools/probe-host.mjs` | 不依赖 DSH 进程的宿主路由探针 |
| `cordis.patch.yml` | bundle 声明：把本插件插进全局树 |

## 许可

MIT
