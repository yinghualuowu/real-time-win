# 胜率数据台

Vite + React + ECharts 对局分析应用。支持多个游戏账号、分路统计、自定义图表、时段对比、JSON 导入导出以及 Supabase 云端同步。

## 本地运行

```bash
npm install
npm run dev
```

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
