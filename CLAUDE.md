# CLAUDE.md — 项目记忆（给 AI 协作者）

本文件是 AI 协作者的**持久记忆**，每次会话开始应阅读。记录本项目的重要约定、发布流程与踩坑记录。

## 项目概况

- 包名：`@dsh-mixxed/dsh-client-ui-filesystem`（npm 公共源，Apache-2.0）
- 用途：dsh 客户端插件——对话窗口 `@` 触发项目文件/目录检索（out-of-tree，harness 零改动）
- 插件 id：`ui-filesystem`（cordis 插件 id，与包名无关，**保持不变**）
- 仓库：`github.com/dsh-mixxed/dsh-client-ui-filesystem`（分支 master）
- 构建产物：`lib/`（gitignore，由 `prepack: npm run build` 保证新鲜，勿手改）

## 版本发布流程（记忆）

用户要求发布新版本时，严格按此流程执行：

```powershell
# 1. 前置检查
git status --short          # 工作区干净或仅预期改动
npm run typecheck
npm test                    # 当前 35 个用例

# 2. 升版本（自动 git commit + tag）
npm version patch|minor|major

# 3. 发布（prepack 自动重新构建 lib/，无需手动 build；无需 2FA 验证码）
npm publish

# 4. 验证
npm view @dsh-mixxed/dsh-client-ui-filesystem version
npm view @dsh-mixxed/dsh-client-ui-filesystem dist-tags

# 5. 推送
git push origin master --tags
```

发布后核对：npm 网页显示 **Public**（非 Private）、版本号与 README 渲染正常、GitHub tags 与 npm 一致。

## 踩坑记录（重要！）

1. **`publishConfig.access: "public"` 必须保留**：`@dsh-mixxed` 是**组织** scope（owner 是个人账号 `dragons96999`），组织 scoped 包默认私有。去掉 access 配置会发布成私有包——表现是发布命令返回成功，但匿名访问 404，只有登录账号在网页能看到。

2. **client 注册 id 必须等于 npm 包名**：改包名时须同步 `scripts/build.mjs` 的 `PKG_ID`（用于 `/plugins/<id>/client.js` 路由与 `__ModuleLoader__` 注册）。cordis 插件 id `ui-filesystem` 不受影响。

3. **发布后 5 分钟内 404 属正常**：发布前若探测过包名，CDN 会缓存 404 约 5 分钟（`max-age=300`），期间 `npm view`/`npm install` 可能 404。**不是发布失败**。判断发布成功：
   - 网页可见 ✓
   - 版本端点 200：`https://registry.npmjs.org/@dsh-mixxed%2Fdsh-client-ui-filesystem/0.1.1`
   - tarball 可下载（scoped 包 tarball 文件名**不带 scope**）：`.../-/dsh-client-ui-filesystem-<ver>.tgz`

4. **2FA**：账号已启用 2FA，但发布无需验证码——`.npmrc` 已有 bypass-2FA granular token（`//registry.npmjs.org/:_authToken`）。若 `npm publish` 报 `E403 ... bypass 2fa`：让用户去 https://www.npmjs.com/settings/dragons96999/tokens 重新生成带 "Bypass 2FA" 的 token 并 `npm config set //registry.npmjs.org/:_authToken=npm_xxx`。

5. **发布物清单**：`files: ["lib"]` + 自动包含 LICENSE、README.md、README.zh.md、package.json（共 8 个文件，约 18 kB）。`*.tgz` 已被 gitignore。

6. **README 同步**：版本号相关示例（tgz 文件名、安装命令）若随版本变化，需同步更新 README.md 与 README.zh.md（双语一致）。

## 账号对照

| 项 | 值 |
|---|---|
| npm 组织 scope | `@dsh-mixxed` |
| npm 个人账号 | `dragons96999`（组织 owner） |
| GitHub | `github.com/dsh-mixxed/dsh-client-ui-filesystem` |
