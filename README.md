# 胜率数据台

Vite + React + ECharts 对局分析应用。支持多个游戏账号、分路统计、自定义图表、时段对比、JSON 导入导出以及 Supabase 云端同步。

## 本地运行

```bash
npm install
npm run dev
```

建议使用 Node.js 22。Vite、Oxlint 等工具安装在项目本地，请通过
`npm run dev`、`npm run lint` 等 npm scripts 调用，不要直接执行全局
`vite` 或 `oxlint`。如果出现“不是内部或外部命令”，先在项目根目录执行
`npm install`；CI 中使用 `npm ci`。

## 配置 Supabase

1. 创建 Supabase 项目。
2. 在 Supabase Dashboard 的 SQL Editor 中执行：
   `supabase/migrations/20260728_initial_schema.sql`
   已执行过初始脚本的数据库还需要执行：
   `supabase/migrations/20260730_add_match_points.sql`
3. 复制 `.env.example` 为 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. 在 Supabase Authentication 中启用 Email OTP，并按部署域名配置 Site URL。
5. 重启 Vite。

前端只能配置公开的 `anon` key。不要将 `service_role` key 写入前端或提交到仓库。

## 部署到 GitHub Pages

项目通过 `.github/workflows/ci.yml` 构建和部署。工作流会在推送到 `main`
分支后执行 lint、测试和构建，并将 `dist` 部署到 GitHub Pages。

### 1. 配置 GitHub Secrets

进入仓库的 `Settings → Secrets and variables → Actions`，添加以下
Repository secrets：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

工作流会在构建时将它们注入 Vite。`VITE_` 开头的变量会被打包进浏览器代码，
因此只能存放允许公开的 Supabase URL 和 `anon` key。

### 2. 选择正确的 Pages 发布源

进入 `Settings → Pages → Build and deployment`，将 Source 设置为
`GitHub Actions`。

不要选择 `Deploy from a branch`。否则每次推送会同时运行自定义 Vite
工作流和 GitHub 自动生成的 `pages build and deployment`；后者会直接发布
仓库源码并覆盖 `dist`，导致线上 `index.html` 请求 `/src/main.tsx` 后白屏。

### 3. 项目 Pages 地址和 Vite base

当前仓库名为 `real-time-win`，属于项目 Pages，默认访问地址是：

```text
https://yinghualuowu.github.io/real-time-win/
```

因此 `vite.config.ts` 中配置了：

```ts
base: '/real-time-win/'
```

如果仓库改名，需要同步修改 `base`。如果改用根域名或仓库名改为
`yinghualuowu.github.io`，则应将 `base` 改为 `/`。

### 4. Supabase Authentication

在 Supabase Authentication 的 URL Configuration 中配置实际部署地址。
至少添加：

```text
http://localhost:5173/
https://yinghualuowu.github.io/real-time-win/
```

如果启用自定义域名，还需要加入自定义域名，并在 GitHub
`Settings → Pages → Custom domain` 和 DNS 服务商处完成域名配置。

### 常见部署问题

- Actions 提示缺少配置：检查两个 `VITE_SUPABASE_*` Repository secrets。
- Actions 成功但页面仍请求 `/src/main.tsx`：Pages Source 仍是
  `Deploy from a branch`，改为 `GitHub Actions` 后重新运行部署工作流。
- `/assets/index-*.js` 返回 404：确认 `vite.config.ts` 的 `base` 与仓库路径一致，
  并以线上 `index.html` 当前生成的哈希文件名为准。
- 修改已推送但页面未更新：确认 `build` 和 `deploy` 两个 job 都成功，然后强制刷新
  或使用无痕窗口排除缓存。
- 自定义域名取消后页面白屏：恢复项目路径 `base: '/real-time-win/'`，并访问项目
  Pages 地址，而不是用户 Pages 根地址。

## JSON 格式

```json
{
  "schemaVersion": 2,
  "initialScore": 100,
  "winPoints": 10,
  "lossPoints": 10,
  "records": [
    {
      "id": "唯一记录ID",
      "date": "2026-07-28",
      "order": 1,
      "teamSize": 2,
      "result": 1,
      "lane": 0,
      "points": 10
    }
  ]
}
```

`lane`：`0 对抗路、1 打野、2 中路、3 发育路、4 游走`。`points` 是该场实际积分变化。旧 JSON 缺少这些字段时会自动迁移。

## 验证

```bash
npm run lint
npm test
npm run build
```
