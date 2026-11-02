# Agent Note: 设备使用痕迹复用采集口而不复用会话存储

Status: implemented

## Problem
R13-X6 提案称没有使用数据，但代码已有 usage-tracker 与洞察 App。旧 usage_stats_v1 随会话隔离，可进入角色备份，且按日聚合而非保留精确最后打开时刻。直接复用其存储不满足设备隐私契约。

## Decision
复用 trackerNote/trackerClose 两个既有采集出口，旁路调用 usage-pattern，不新增事件监听，不改变旧会话统计读写。设备聚合由 PhoneStorage.usagePatternStore 专口写入独立 localStorage 键，绝不落 extensionSettings/chatMetadata，也不在 enumerateKeys 中出现。不可用时拒绝保存并在设置反馈，不回退到角色存储。

默认关闭采集与展示；设置页独立分区提供开关、各 App 折叠详情、承认标记、确认清零。状态阈值为未访问 never，1–9 次 rare，10 次以上 habitual，14 天未打开 faded。承认只确认玩家已看过聚合，不改变角色态度；新打开清除该标记。墙钟由 wallNow 获取并可注入假钟，剧情时间不参与计算。只持久化次数、累计间隔与最后打开时间，不持久化访问明细或活动会话，不在重启后猜算时长。

## Alternatives considered
- 直接迁移 usage_stats_v1 省一份存储，但会把角色历史误当设备使用，并且无法恢复缺失的精确时间；不迁移，也不删除旧统计。
- 新增全局设置键并经正常 PhoneStorage.set 保存能复用备份链，但违反默认不导出的隐私要求；专口保持在本地设备域。
- 修改每个 App 原控制器添加详情会扩大改动面；当前在设置分区逐 App 展开一行摘要与详情，不侵入全部 App。各 App 自己页面的详情行仍是未实施范围，不宣称逐 App 页面已接入。

## Testing
system-v4118 直接执行状态流、清零、关闭冻结、时长上限/倒拨/重复关闭、存储异常、旧统计逐字一致、设备桶与角色枚举分离，并用真实内核变体验证 faded 判据会翻红。Chromium 的 r13-usage-pattern 场景验证开关、承认、重挂载、清零、桶不变、命中与窄屏。场景使用独立设置分区宿主，不替代完整酒馆运行时验收。

## Consequences
痕迹不会跟随角色导出、备份或跨设备迁移；当前也没有显式导出痕迹的选项，选择比默认隐私更严格的边界。时长仍是 App 切换/返回之间的间隔，单次四小时上限，并非真实前台时长。设备 localStorage 被浏览器清理会失去痕迹，角色数据不受影响。多标签同时采集不提供事务保证。

## Related notes
与[第十三期提案](../../proposed/feature/2026-10-31-product-expansion-v13.md)部分重叠：本篇修正其旧侦察结论并记录 X6 实现边界，保留提案其余项目。与[角色备份](2026-10-14-local-backup-and-restore.md)不冲突：该方案的两层枚举面不扩张到设备痕迹。X9 独立评估：现有 remark 是玩家给联系人的备注，不是对方给玩家的备注；缺真源，不制造另一台手机，不实施 X9。