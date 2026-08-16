# ui-filesystem

[English](README.md) · **中文**

一个 dsh 插件：在对话窗口输入 `@` 时，检索当前项目（会话工作目录）下的文件与子目录，选中后插入 `@路径` 引用，发送时 prompt 原样携带，模型可用自身 fs 工具读取。

完全独立于 deepseek-harness 仓库的 out-of-tree 插件（harness 源码零改动）：与 ui-skill 的 `/` 走同一条 input-trigger 管线（与 ui-subagent 的 `@` 提及并存为第二个菜单分组），项目树通过插件自己的 HTTP 路由（`ctx.webServer`）提供。

## 安装

1. 从 npm 安装插件（已发布为 `@dsh-mixxed/dsh-client-ui-filesystem`）：

   ```sh
   dsh plugin --profile web add @dsh-mixxed/dsh-client-ui-filesystem
   ```

   包声明了 `dsh.bundle`（包内自带 `cordis.patch.yml`），因此 `dsh plugin add` 会自动把它追加进 profile 的 `dsh.profile.bundles` 层栈，下次启动自动挂载——**无需手动编辑 cordis.patch.yml**。

   从旧版本（未声明 bundle）升级：请删除 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 中旧的 `ui-filesystem` 挂载行——bundle 层现在会提供它，两者并存会挂载两次。

2. **重启 profile**（新增插件的发现需要重启），打开任意会话，输入 `@` 即可看到 filesystem 分组。

### 源码构建（开发 / 离线）

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
npm pack          # 生成 dsh-mixxed-dsh-client-ui-filesystem-<version>.tgz
dsh plugin --profile web add ./dsh-mixxed-dsh-client-ui-filesystem-<version>.tgz
```

## 功能特性

- **`@` 触发检索**：与 ui-skill 的 `/` 技能检索同一管线（`ui-input-trigger`），与 ui-subagent 的 `@` 提及并存（菜单中两个分组）。
- **前缀匹配**：检索只匹配**文件/目录名（basename）前缀**，不匹配路径前缀——`@index` 命中 `src/index.ts` 与 `test/index.ts`，`@src/` 无结果（路径式查询不是本插件语义）。
- **提示项 UI**：每个候选前显文件/目录名，后显相对路径（如 `index.ts  src/index.ts`）。
- **引用**：选中后把 `@` token 替换为 `@相对路径 ` 字面量，发送时 prompt 原样携带，模型可用自身 fs 工具读取。
- **按会话缓存**：每个会话只向 host 请求一次项目树，击键过滤在本地进行；`connection/reset` 后自动重建。
- **有界遍历**：跳过 `node_modules` / `.git` / 隐藏项（可配置），默认最深 6 层、最多 2000 条；符号链接不列出。
- **失败自动重试**：树请求失败（如实例刚重启、host 会话尚未就绪）会自动重试一次，菜单保持「正在加载…」状态，不会瞬间消失。

## 使用提示（已知限制，harness 行为）

- **`@` 的触发位置**：`@` 必须位于行首、空白或标点之后。中文汉字后直接跟 `@` 不会触发（如「请查看@index」无效；「请查看，@index」有效）——触发检测把汉字视为单词字符，该规则在 harness 的 `ui-input-trigger` 中，本插件按约定不改 harness。行内引用建议在 `@` 前加空格或标点。
- **加载中状态**：项目树首次加载期间，菜单立即弹出并显示「正在加载…」文字行（菜单组件的既有行为，无动画；动画需改 harness 菜单组件，本插件不改）。
- **无 chip 装饰**：`@路径` 在草稿中不渲染为 chip（装饰扫描只支持单词字符名，见 DESIGN.md §7.1）。
- **菜单无分组标题**：harness 菜单会为每个源渲染一行原始名标题（`slash.menu` 字典由 harness 独占）；`@` 菜单只有本插件一个分组，插件注入一条 CSS 规则隐藏该标题行。
- 已知限制详情：`DESIGN.md` §7。

## 验证

```sh
dsh --profile <name> --dump-config | Select-String ui-filesystem
```

组合后的配置包含 `ui-filesystem` 行，且 `$DSH_HOME/profiles/<name>/package.json` 的 `dsh.profile.bundles` 中列出了 `@dsh-mixxed/dsh-client-ui-filesystem`（由 `dsh plugin add` 自动追加）。

重启后：`@` 弹出 filesystem 分组（前名后路径）→ basename 前缀过滤 → 选中插入 `@路径 ` → 发送后模型可读该文件。

## 配置（可选）

在 profile 自己的 `cordis.patch.yml` 中调整遍历边界——用户层在 bundle 层之后应用，按 id 定位的补丁会覆盖 bundle 挂载行：

```yaml
- id: ui-filesystem
  name: "@dsh-mixxed/dsh-client-ui-filesystem"
  config:
    maxDepth: 6          # 最大路径深度（默认 6）
    maxEntries: 2000     # 总条目上限（默认 2000）
    skipHidden: true     # 跳过点开头条目（默认 true）
    skipPatterns:        # 按 basename 精确跳过的目录/文件（默认 node_modules、.git）
      - node_modules
      - .git
```

## 许可证

[Apache-2.0](LICENSE)
