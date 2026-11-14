# Agent Note: R21-X2 双仓剧情钟对齐校验

Status: implemented

## Problem

RubyPhone 与 LonSha Memory Bridge 各自持有剧情时间，但设置页此前不能判断两端读数是否可比。上游 `clock` 快照的 `date` 与 `label` 可能只表达日期和时段；把缺失的精确时间补成午夜会伪造偏差或伪报一致。既有通用桥探针为兼容拉取型桥可调用 `stat()`、`snapshot()` 或 `refresh()`，手机 `getCurrentStoryTime()` 也会在缓存过期时重算，因此它们不满足此读数的严格纯读要求。

## Decision

R21-X2 在设置页显示三态对齐读数：`aligned`、`skewed`、`unavailable`。校验只报告差异，不改写任一侧。手机端通过 `storyNow(win, { readOnly: true })` 读取有效期内已发布的剧情缓存；缓存缺失、过期或为墙钟回退时返回不可用，不重算、不读取存储、不拉 WorldAxis。`TimeManager.peekCurrentStoryTime()` 仅返回缓存的浅拷贝。

记忆侧复用 `readPushProbe` 与 `readPushField` 唯一桥真源，但通过 `{ publishedOnly: true, bridgeId: LONSHA_BRIDGE_ID }` 限定为已发布的 LonSha 对象快照。该模式不调用拉取型 `snapshot()`、`stat()` 或 `refresh()`；通用默认行为维持兼容。只接受可解析的精确时分；日期加模糊 `label`（如“上午”）不推测成某个分钟，返回带原因的 `unavailable`。有双方文本时用统一 UTC 坐标解析，避免把手机本地时区毫秒与插件无时区文本直接相减。

## Alternatives considered

调用 `getCurrentStoryTime()` 并复用通用桥探针可立即显示较新读数，也无需扩展公共探针；但两者可能重算或触发桥回调，与“查看不改变被查看系统”的验收冲突。给时段标签映射固定小时也能产出数字，但映射在上游没有承诺，且同一“下午”无法证明双方偏差分钟数，因此不采用。

## Consequences

冷缓存或模糊精度会增加 `unavailable` 的出现，但不会制造午夜、墙钟或推测时段。通用 `readPushProbe` 默认语义不变；严格只读由显式选项启用。真实导入的 `system-v4151` 覆盖日期与精确时分解析、无效日期、三态及方向、阈值弱类型、label 精度、纯读调用计数、缓存过期、无桥和无数据。存档对象的序列化前后相等作为合成宿主不变证据；真机宿主和跨插件实时交互未在本地执行。

## Related notes

R21 的整体目标、X1 至 X9 的顺序与验收仍由[第二十一期拓展计划](../../proposed/feature/2026-11-11-product-expansion-v21.md)承载；本记录补充 X2 已落地的数据来源、精度及纯读边界，不替换其余项目。