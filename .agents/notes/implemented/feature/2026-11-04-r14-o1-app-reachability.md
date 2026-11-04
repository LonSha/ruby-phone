# Agent Note: R14-O1 桌面到 App 的真实可达性
Status: implemented
## Problem
在 RubyPhone 桌面与 App 路由架构中：
- 随着像素 OS 架构落地，桌面收敛为「8 核心 + 7 聚合文件夹 + 1 应用库 Dock 搜索」，非核心 App 不再直接全量散落平铺在桌面轨道上；
- 浏览器自动化场景中，`data-open` 测试按平铺分页寻找非核心 App（如 `music`、`clock`、`ledger`）时，因未进入对应聚合类目或应用库 Dock 而被判定为“翻页仍找不到入口”，导致产品真实可达性与自动化用例脱节。

## Decision
1. **真实可达链分级解析**：
   - 在入口探针中落实级联查找：核心桌面平铺 → 分页滚动查找 → 匹配类目聚合文件夹（`.app-cluster-tile[data-cluster=...]`）打开并点选 → 应用库 Dock（`[data-app="__library"]`）检索。
2. **89 个登记 App 契约防线**：
   - 建立专用定向回归测试 `tests/r14_o1_app_reachability.test.mjs`；
   - 锁定 89 个 App 标识符无重复；
   - 校验 75 个表驱动路由模块文件真实存在并正确导出装配类，14 个内联特殊分支（`wechat`/`weibo`/`honey`/`mofo`/`diary` 等）路由分支完备；
   - 校验全部非核心 App 严格归属于 7 个合法聚合壳类目之一，杜绝入口孤立或悬空。

## Verification
- 定向测试：`node tests/r14_o1_app_reachability.test.mjs`（2/2 通过，涵盖 89 App 路由与装配完整性校验、桌面分层与聚合壳全覆盖）。
- 历史回归：`node tests/system-v3660_open_ref.test.mjs && node tests/system-v4130.test.mjs`（23/23 + 23/23 全绿）。