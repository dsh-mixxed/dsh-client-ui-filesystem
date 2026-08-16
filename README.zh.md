# ui-filesystem

一个 dsh 插件：在对话窗口输入 `@` 时，检索当前项目（会话工作目录）下的文件与子目录，选中后插入 `@路径` 引用，发送时 prompt 原样携带，模型可用自身 fs 工具读取。

完全独立于 deepseek-harness 仓库的 out-of-tree 插件（harness 源码零改动）：与 ui-skill 的 `/` 走同一条 input-trigger 管线（与 ui-subagent 的 `@` 提及并存为第二个菜单分组），项目树通过插件自己的 HTTP 路由（`ctx.webServer`）提供。

## Features

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
- **菜单分组标题**：显示原始名 `filesystem`。
- 已知限制详情：`DESIGN.md` §7。

## Install

1. 构建并打包：

   ```sh
   pnpm install
   pnpm run typecheck
   pnpm test
   pnpm run build
   npm pack          # dsh-mixxed-dsh-client-ui-filesystem-0.1.1.tgz
   ```

2. 安装进 profile：

   ```sh
   dsh plugin --profile web add ./dsh-mixxed-dsh-client-ui-filesystem-0.1.1.tgz
   ```

   （或从 profile 目录：`corepack pnpm add ./dsh-mixxed-dsh-client-ui-filesystem-0.1.1.tgz --dir <profile-dir>`）

   （或发布到 npm 后：`corepack pnpm add @dsh-mixxed/dsh-client-ui-filesystem --dir <profile-dir>`）

3. 在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 挂载：

   ```yaml
   - insert:
       - id: ui-filesystem
         name: @dsh-mixxed/dsh-client-ui-filesystem
   ```

4. **重启 profile**（新增插件的发现需要重启），打开任意会话，输入 `@` 即可看到 filesystem 分组。

## Verify

```sh
dsh --profile <name> --dump-config | Select-String ui-filesystem
```

重启后：`@` 弹出 filesystem 分组（前名后路径）→ basename 前缀过滤 → 选中插入 `@路径 ` → 发送后模型可读该文件。

## Config（可选）

在 profile 的 `cordis.patch.yml` 挂载行配置遍历边界：

```yaml
- insert:
    - id: ui-filesystem
      name: ui-filesystem
      config:
        maxDepth: 6          # 最大路径深度（默认 6）
        maxEntries: 2000     # 总条目上限（默认 2000）
        skipHidden: true     # 跳过点开头条目（默认 true）
        skipPatterns:        # 按 basename 精确跳过的目录/文件（默认 node_modules、.git）
          - node_modules
          - .git
```

## License

[Apache-2.0](LICENSE)
