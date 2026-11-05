# Agent Note: R14-X4 共同事项执行与费用草案隔离

Status: implemented

## Problem

个人 errand 只能记录整条办完，不能表达多人分派、代办与部分完成。把执行完成直接映射为付款会制造无财务回执的已付事实。

## Decision

共同事项使用独立会话键 affairs_shared_chores_v1，复用事务台这个月页面入口。负责人和执行人分别保存；完成子项保留其余子项。费用以整数分保存，均摊余数按参与人顺序分配，所有分摊始终为草案。存储异常阻止覆盖，写回后比对读数。

财务确认通过宿主 applyFinanceCommitAction 的第二参数传事项 ID；宿主重读会话记录，作废或无金额时拒绝，使用 accounting 来源与稳定事项草稿 ID 复用原财务计划、幂等与读回。本机确认不代表实际付款。子项完成保存用户操作记录时间，区别于剧情发生时间。

## Alternatives considered

扩展个人 errand 可复用存储与动作，但其整条 done/expired 语义不能表达子项进度，且归一函数会剔除新增字段，因此采用独立记录。直接写 finance_ledger 实现更短，但违反宿主唯一财务写入口约束，故不采用。

## Consequences

十项定向测试覆盖代办与费用隔离、部分完成、逐分守恒、作废、刷新隔离、坏存储与写失败、非法输入和 HTML 转义。键登记与死导出审计通过。Chromium 131 的存储夹具页面场景通过 5 条读数，源码抽取宿主函数通过 1 项定向测试；真实 SillyTavern 会话交互仍待验证，未执行全量回归。

## Related notes

检索现有笔记后，第十四期拓展提案的 X4 与本实现部分重叠，保留其整体验收约束：[第十四期拓展](../../proposed/feature/2026-11-03-product-expansion-v14.md)。第十三期个人清单属于复用底座，本改动不替换其生命周期：[第十三期拓展](../../proposed/feature/2026-10-31-product-expansion-v13.md)。早期拓展提案只有主题交集，不改变其决定。
