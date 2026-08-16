# ui-filesystem 插件设计文档

> 状态：设计稿 + 实现基准。目标产物是一个**完全独立于 deepseek-harness 仓库**的 out-of-tree 插件，不改动 deepseek-harness 的任何基础代码。参考实现：`D:\Codes\ui-settings-skills`（settings 页双端插件模板）与仓库内 `packages/client/ui-skill`（`/` 技能检索源）、`packages/client/ui-subagent`（`@` 提及源）。

## 1. 目标与范围

在 dsh Web 对话窗口新增 `@` 触发：检索当前项目（会话 cwd）下的文件与子目录，供用户选择并在草稿中插入引用。

- **检索**：前缀匹配**只匹配文件/目录名（basename）前缀**，不匹配路径前缀（文件带路径，整串前缀匹配会产生歧义，如 `src/` 与 `test/` 都以 `s` 开头）。
- **提示项 UI**：每个元素前显文件/目录名，后显相对路径（复用 input-trigger 候选菜单的 `name` + `description` 两段式渲染）。
- **引用**：选中后把触发 token 替换为字面量 `@<相对路径> `（plain-text reference 决策，与 ui-skill 的 `/name ` 同一机制；prompt 原样携带该字面量，模型可用自身 fs 工具读取）。
- 明确不做：命令裁决（matchSpace/matchEnter）、路径式查询（`@src/` 为空结果，见 §7.3）、chip 装饰（见 §7.1）、文件内容预览、MCP 等其他文件来源。

## 2. 硬约束

1. **不改 deepseek-harness 任何基础代码**：不修改 `packages/` 任何文件，不新增 RPC 进 host 的 `rpc-map`，不改 input-trigger 管线。
2. 插件以独立 npm 包形式存在，通过 `dsh plugin --profile <name> add` + profile 自己的 `cordis.patch.yml` 挂载。
3. 数据通道走 `ctx.webServer` 自定义 HTTP 路由（无现成 RPC 可扩展——`rpc-map` 在基础代码中）。

## 3. 可行性对照表（全部在真实源码核实）

| 需求 | 结论 | 依据（deepseek-harness 现有机制） |
|---|---|---|
| `@` 触发输入管线 | ✅ 可行 | `TriggerChar = '/' \| '@'`，`@` 原生支持（`packages/client/ui-input-trigger/src/types.ts`）；ui-subagent 已是 `@` 源（`packages/client/ui-subagent/src/client/index.ts`） |
| 注册候选源 | ✅ 可行 | `InputTriggerServiceContract.registerSource(InputTriggerSource)`（`ui-input-trigger/src/client/contract.ts`）；trigger 相同 name 不同即可多组共存 |
| 前缀过滤 | ✅ 可行（客户端本地过滤） | ui-skill 同款：会话级目录缓存 + 每击键 `startsWith` 本地过滤（`ui-skill/src/client/index.ts`） |
| 菜单项「前文件名后路径」 | ✅ 可行 | 菜单渲染 `item.name` + `item.description` 两段（`ui-input-trigger/src/client/MenuView.tsx`） |
| 插入引用 | ✅ 可行 | `onPick` 返回 `{ text }` 替换 token span（plain-text 路径；同 ui-skill/ui-subagent） |
| host 侧解析会话项目根 | ✅ 可行 | `ctx.sessions.get(sessionId)` → `session.header.cwd`（绝对路径；`packages/core/session/src/index.ts` + `types.ts`；apiproxy `skills.list` 同款 stance：客户端绝不提交裸路径） |
| host 侧文件枚举 | ✅ 可行 | `ctx.fs`（`@deepseek-ai/dsh-fs`，base bundle 挂载 `dsh-fs-sandbox`）：`resolve(path)` → target，`listDir(target)` → `FsDirEntry[]`（`name`/`type`/`target`，稳定名称序） |
| host→浏览器数据通道 | ✅ 可行 | `ctx.webServer.register({ kind: 'prefix', path, handler })`（`packages/host/webserver/src/index.ts`；ui-settings-skills 已验证） |
| 菜单组标题 | ✅ 已处理（隐藏） | `slash.menu` 命名空间由 ui-input-trigger 独占注册（locale `register` 对重复 (ns, locale) 抛错），未知 key 的查找链返回原 key（`MenuView.tsx`）→ 第三方源无法本地化标题。`@` 菜单只有本插件一个组，标题行纯属噪音：插件注入一条 CSS 规则隐藏该源标题行（`[role="listbox"] [data-source="filesystem"][role="presentation"]`，标题行带 `data-source` + `role="presentation"`，loading 行无 `role` 不受影响） |
| 会话级目录缓存 | ✅ 可行 | ui-skill 的 `CatalogFetch` 模式（单飞行、abort、`connection/reset` 清空）原样复刻，仅把 RPC 换成 fetch |

## 4. 架构总览

```
浏览器 (Web Client)                        host 进程 (dsh --profile web)
┌────────────────────────────┐            ┌───────────────────────────────────┐
│ ui-filesystem (client half) │  fetch ①   │ ui-filesystem (node half)          │
│  @ 源: InputTriggerSource   │ ─────────▶ │  inject: sessions, fs, webServer   │
│  会话级树缓存 + 本地前缀过滤 │ ◀───────── │  GET /plugin/ui-filesystem/tree    │
│  onPick → 插入 @路径        │    JSON    │   sessionId → header.cwd → 递归枚举 │
└────────────────────────────┘            └───────────────────────────────────┘
```

- **双面包**：一个 npm 包同时含 node half（`exports["."]`）与 client half（`dsh.client` manifest + `exports["./client"]`），形态与 ui-settings-skills 一致。
- **数据流**：会话出生 `warm()` 预热 → host 遍历一次（深度/条目上限，跳过 node_modules/.git/隐藏项）→ 浏览器按会话缓存 → 每次击键本地 basename 前缀过滤（大小写不敏感）→ pick 插入 `@相对路径 `。
- **备选方案（否决）**：a) 每击键请求 host 过滤——延迟高、host 压力大；b) 复用 `skills.list` RPC——域不匹配且 RPC map 在基础代码；c) 用 Connection 自定义 RPC——需改 gateway 描述符，违反硬约束。

## 5. 数据契约（wire.ts，纯类型）

```
GET /plugin/ui-filesystem/tree?sessionId=<id>
→ 200 { root: { name }, entries: [{ name, path, type: 'file'|'directory' }] }
   name = 文件/目录名；path = 相对项目根的路径（'/' 分隔）；root.name = 项目根目录名
→ 错误统一 { error: { code, message } }：
   400 missing-session / no-project-cwd / bad-request
   404 session-not-found / not-found
   405 method-not-allowed
```

- 浏览器消费端：会话级单飞行缓存；`fetch` 用缓存条目的独立 abort（reset 时终止在途请求）；失败不毒化 key（下次重试）；请求方 abort（击键被取代）提前返回 `[]`。
- 候选上限：单次查询最多返回 50 项（UI 常量，防止空查询渲染整个目录）。

## 6. 遍历语义（host 侧）

- `ctx.fs.resolve(cwd)` → 根 target；递归 `listDir`，相对路径由遍历自行累积（`'/'` 连接），不做字符串路径比较。
- 跳过：`skipPatterns`（默认 `['node_modules', '.git']`，basename 精确匹配）、`skipHidden`（默认 true，`.` 前缀）、`type !== 'file'|'directory'`（含符号链接，防御逃逸）。
- 上限：`maxDepth`（默认 6，路径段数）、`maxEntries`（默认 2000，总条目，达限即停）。
- 单目录 `listDir` 失败：跳过该子树并回调 `onError(path, error)` 记日志（提示源可部分降级，不整树失败）；`signal.aborted` 时停止继续遍历（返回已收集部分）。
- 配置：`Config`（`maxDepth`/`maxEntries`/`skipHidden`/`skipPatterns`）在 `apply(ctx, config)` 第二参数读取，非法值启动即抛（fail loud）。
- 每次请求现算，不缓存（目录内容随时变化；请求频率受击键节流与 50 项上限约束）。

## 7. 诚实边界（必须接受）

1. **无 chip 装饰**：plain-text 引用的装饰扫描正则 `/(^|\s)([/@])([\w-]+)/g`（`ui-conversation/src/client/input/decorations.ts`）只匹配单词字符，无法匹配含 `/` 与 `.` 的路径。故本插件**不实现 `lexicon`/`subscribeLexicon`**——插进去也扫不出来，反而可能造成部分匹配的误导装饰。`@src/index.ts` 在草稿与 prompt 中为纯文本。
2. **菜单无组标题**：`slash.menu` 命名空间由 ui-input-trigger 独占（见 §3 表格），第三方源无法本地化标题；标题行默认回退显示原始名 `filesystem`。插件注入一条 CSS 规则隐藏该行（选择器只可能命中本源标题行），`@` 菜单不再显示 `filesystem`。
3. **路径式查询无结果**：按需求只匹配 basename 前缀，`@src/` 这类含 `/` 的查询自然为空（菜单关闭）。这是需求的直接语义，不是缺陷；未来如需 IDE 式目录导航属新需求。
4. **同 basename 多文件**：候选 `name` 相同（React 列表 key 相同）。受击键过滤的同一性约束（同 basename 条目必然同时匹配/不匹配）与稳定排序保护，实践中渲染正确；控制台可能出现重复 key 警告，属 harness 菜单实现细节（ui-subagent 的同名子代理标题已存在同类情况）。
5. **树快照有界且会过期**：遍历受深度/条目上限约束，超大仓库只能提示前 N 项；树按会话缓存，会话期间文件增删不实时反映（与 ui-skill 的目录缓存同一取舍）。`connection/reset` 清缓存。
6. **大小写不敏感匹配**：`@` 检索按 basename 前缀不区分大小写（比 ui-skill 的严格区分更宽容，IDE 惯例）。
7. **符号链接不列出**：`type 'other'` 跳过（防御目录逃逸与环）。
8. **中文后 `@` 不触发（已确认接受）**：触发检测的 `boundaryOk` 用 `WORD_CHAR = /[\p{L}\p{N}_]/u`（`ui-input-trigger/src/core/detect.ts`），中文汉字属 `\p{L}`，故「请查看@index」不触发；「请查看，@index」/「hello @index」/行首 `@` 均正常。放开此规则需改 harness 的 detect.ts，用户已确认不改 harness，README 已写明使用提示。
9. **加载中为纯文字（已确认接受）**：菜单 pending 分组渲染 `t('loading')` 文字行（「正在加载…」），无动画；动画需改 harness 的 MenuView，用户已确认不改。
10. **失败自动重试一次**：实测发现实例重启窗口内首次 tree 请求可能 404（host 会话 attach 竞态），菜单会因 source-failed 静默关闭。插件在 `candidates` 内对失败自动重试一次（300ms 间隔，菜单保持 pending），仍失败则按管线规则关闭，key 不毒化。

## 8. 独立工程布局

```
ui-filesystem/                  # D:\Codes\ui-filesystem
├── package.json                # name/exports{".","./client"}/dsh.client/files
├── tsconfig.json               # 参考 ui-settings-skills 严格配置（moduleResolution: bundler）
├── vitest.config.ts            # node 环境；无 CSS 依赖
├── scripts/build.mjs           # esbuild 双产物（node ESM + client CJS 闭包工厂）
├── src/
│   ├── index.ts                # node half: Config 解析 + 路由注册
│   ├── walk.ts                 # 纯遍历器（FsReader 接口注入，可测）
│   ├── wire.ts                 # 纯类型 wire 契约（绝无运行时代码）
│   └── client/
│       └── index.ts            # client half: @ 源 + 会话缓存
└── tests/
    ├── host-walk.spec.ts       # 遍历器 + Config + 路由 handler（fake req/res）
    └── browser-plugin.client.spec.ts  # 源注册/过滤/缓存/onPick/teardown
```

依赖分发与 ui-settings-skills 相同：`@deepseek-ai/*@0.1.0-rc.6`（npm 发布版，与已装 dsh rc.6 运行时对齐）作 devDependencies，client 端仅类型导入（构建期擦除，不产生运行时外部依赖）；node half 类型导入 `dsh-session`/`dsh-fs`/`dsh-host-webserver`/`cordis`。

## 9. 挂载与验证

```sh
pnpm run typecheck && pnpm test && pnpm run build && npm pack
dsh plugin --profile <name> add ./ui-filesystem-0.1.0.tgz
# $DSH_HOME/profiles/<name>/cordis.patch.yml insert:
# - insert:
#     - id: ui-filesystem
#       name: ui-filesystem
dsh --profile <name> --dump-config   # 确认行进入组合树
```

- 测试用独立 profile + 独立端口（3080 被用户 web 实例占用 → 3800），重新验证前清残留实例。
- 插件集变更需重启 profile 才被发现（client `pkgMeta` 缓存）；以 `/plugins/ui-filesystem/client.js` 可 serve 为准，不要假设。
- 端到端验证点：`@` 弹出 filesystem 组 → basename 前缀过滤 → 前名后路径渲染 → 选中插入 `@路径 ` → 发送后 prompt 含该字面量 → 模型可读文件。
- 改名后旧路由返回 200 可能是 SPA fallback（index.html），需区分。

## 10. 里程碑

- **M1 骨架**：工程脚手架、esbuild 双产物、依赖分发（npm rc.6 对齐）、独立 profile 安装、空源挂载成功。
- **M2 提示与引用**：host 树 API + 会话缓存 + `@` 源（过滤/onPick）+ 测试全绿 + 浏览器端到端验证。
- **后续（不做）**：路径式查询、chip 装饰（需改基础代码或等 harness 支持）、目录导航。
