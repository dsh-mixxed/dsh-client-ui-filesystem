# 发布流程（RELEASE.md）

> 本文件是 `@dsh-mixxed/dsh-client-ui-filesystem` 的**发布流程记忆**。
> 发布新版本时严格按此流程执行；遇到问题先看"注意事项"。

## 一键流程（通常 2 分钟）

```powershell
# 1. 前置检查：确保工作区干净、测试通过
git status --short          # 应为空或仅有预期改动
npm run typecheck
npm test

# 2. 升级版本号（0.1.1 → 0.1.2，或 minor/major）
npm version patch           # 自动 git commit + tag

# 3. 发布（prepack 钩子会自动重新构建 lib/，无需手动 build）
npm publish                 # 无需 2FA 验证码（token 已 bypass 2FA）

# 4. 验证
npm view @dsh-mixxed/dsh-client-ui-filesystem version
npm view @dsh-mixxed/dsh-client-ui-filesystem dist-tags

# 5. 推送 GitHub（npm version 已自动提交，推送即可）
git push origin master --tags
```

## 完整发布清单

- [ ] `git status` 干净，无未提交的杂项
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过（当前 35 个用例）
- [ ] `npm version patch|minor|major` 升级版本（同时生成 git tag）
- [ ] `npm publish`（prepack 自动 build；tarball 约 18 kB / 8 个文件）
- [ ] `npm view` 确认新版本和 `latest` 标签
- [ ] 从公共源真实安装冒烟测试：
      `npm i @dsh-mixxed/dsh-client-ui-filesystem`（临时目录）
- [ ] `git push origin master --tags`

## 发布后核对（网页）

- https://www.npmjs.com/package/@dsh-mixxed/dsh-client-ui-filesystem
  - 版本号、README 渲染正常
  - 页面显示 **Public**（不是 Private）
- GitHub 仓库 tags 与 npm 版本一致

## 注意事项（踩坑记录）

1. **包名与 scope**：`@dsh-mixxed` 是**组织**（owner 是个人账号 `dragons96999`），
   包归组织所有。发布用组织 token，`publishConfig.access: "public"` **必须保留**——
   组织 scoped 包默认私有，去掉 access 配置会发布成私有包（表现：发布"成功"但
   匿名访问 404，只有登录账号能在网页看到）。

2. **client 注册 id 必须等于 npm 包名**：改包名时须同步修改
   `scripts/build.mjs` 里的 `PKG_ID`（它用于 `/plugins/<id>/client.js` 路由和
   `__ModuleLoader__` 注册）。cordis 插件 id（`ui-filesystem`）与此无关，保持不变。

3. **发布后立即 404 是正常现象**：发布前若用 `npm view`/网页探测过包名，CDN 会
   缓存 404 响应约 5 分钟（`Cache-Control: max-age=300`），期间 `npm view`/`npm install`
   可能 404。**不是发布失败**，等缓存过期或稍后重试即可。判断发布是否成功：
   - 网页能看到包 ✓
   - 版本端点 200：`https://registry.npmjs.org/@dsh-mixxed%2Fdsh-client-ui-filesystem/0.1.1`
   - tarball 可下载（注意 scoped 包 tarball 文件名**不带 scope**）：
     `.../-/dsh-client-ui-filesystem-0.1.1.tgz`

4. **2FA**：账号已启用 2FA，但发布不需要验证码——`.npmrc` 中配置了
   bypass-2FA 的 granular token（`//registry.npmjs.org/:_authToken`）。
   若发布报 `E403 ... bypass 2fa`：去
   https://www.npmjs.com/settings/dragons96999/tokens 重新生成带
   "Bypass 2FA" 的 token，然后 `npm config set //registry.npmjs.org/:_authToken=npm_xxx`。

5. **lib/ 是构建产物**（在 .gitignore 中），发布内容由 `prepack: npm run build`
   保证新鲜，不要手动改 lib/ 下的文件。

6. **发布物**：`files: ["lib"]` + 自动包含 LICENSE、README.md、README.zh.md、
   package.json。tgz 文件（`*.tgz`）在 .gitignore 中，不会提交。

7. **README 同步**：版本号相关示例（tgz 文件名、安装命令）如随版本变化需同步
   更新 README.md 和 README.zh.md。

## 相关账号

| 项 | 值 |
|---|---|
| npm 包 | `@dsh-mixxed/dsh-client-ui-filesystem` |
| npm 组织 scope | `@dsh-mixxed` |
| npm 个人账号 | `dragons96999` |
| GitHub 仓库 | `github.com/dsh-mixxed/dsh-client-ui-filesystem` |
| 许可证 | Apache-2.0 |
