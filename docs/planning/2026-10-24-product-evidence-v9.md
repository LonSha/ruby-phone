# RubyPhone 第九期计划证据与边界

## Current baseline

- 仓库：`ruby-phone`，分支 `main`。
- 当前代码基线：`v4.57.0 / 7ae54a8`；旧 V8 提案中的 `v4.55.0 / 514461a` 仅作历史参考。
- 当前真实产品规模：`config/apps.js` 登记 89 个 App；已有事情接力、动作回执、恢复、工作包、主题包、创作者包和跨仓记忆桥。
- 真实产品主轴：把 App 集合变成可连续使用、可逆、可恢复、可审阅、可塑造的本地手机媒介。

## Plan links

- 优化提升：[`2026-10-24-product-optimization-v9.md`](../../.agents/notes/proposed/architecture/2026-10-24-product-optimization-v9.md)，R9-O1 至 R9-O9。
- 拓展创新：[`2026-10-24-product-expansion-v9.md`](../../.agents/notes/proposed/feature/2026-10-24-product-expansion-v9.md)，R9-X1 至 R9-X9。

## Non-goals

守卫、审计、版本、键台账和纯重构不独立占产品项；它们只为相应功能提供最小证据。不得建立万能全局状态中心，不得复制各 App 正文，不得执行远程/任意代码，不得把角色提案直接当成已完成动作。

## Delivery rule

每项按六个切片推进：业务 owner、跨 App 接线、原生 UI、会话隔离持久化、恢复/撤销、真实宿主/窄屏/长会话验收。只有六片都存在才结项；单个配置、单个 App、单个测试或静态审计不能代表完成。
