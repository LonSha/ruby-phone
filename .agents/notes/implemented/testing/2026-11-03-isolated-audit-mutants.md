# Agent Note: 负控制在真源码副本中运行

Status: implemented

## Problem
v4930 与 v4940 的四个破坏探针改写真工作树。全量并发时，v4970 等读侧扫描会撞到尚未还原的探针，导致单跑绿、并发红。刷新基线无法修正这类时序污染。

## Decision
`tests/lib/audit-copy.mjs` 用真实字节复制建立独立临时树，在副本中运行副本自己的审计入口。不传 root/fixture 参数，保持真实基线比较与结构下限。生产门禁不持锁，不承担测试进程协调。复制保留 JS、MJS、JSON 与 tests 的导入边，排除隐藏目录、构建产物及依赖；finally 清理副本。同步回调使用 `withAuditCopy`；异步导入使用 `withAuditCopyAsync`，后者必须等待回调 resolve/reject 后才 finally 清理，避免并发下模块导入未完成副本已被删除。两者均不承诺任意构建任务的完整仓库镜像。

## Alternatives considered
- 跨进程读写锁能减少复制成本，但任何漏加锁的读侧或锁外写入/还原窗口仍会串味，并向生产脚本、夹具导入与基线引入额外契约。实际修补已出现这些问题，故撤销锁方案。
- 小夹具成本更低，但这些判据守的是增量基线与真实仓库结构下限；fixture 模式放宽的语义不能替代这一层。
- 硬链接快，但本环境 proot 会反向改写源树，因此必须使用 copyFileSync。

## Testing
v4930/v4940/v4970 定向并发 62 条通过；`tests/system-v4118.test.mjs` 另测副本修改不改变源字节、排除依赖、异常清理。`tests/system-v4119.test.mjs` 的 X9-H 验证 await 后副本仍在、成功与拒绝两条路径均清理，X9-F 在异步副本加载真实变异模块，用同款断言验证必红。最终整链结果以提交前 check 日志为准，定向通过不代表整链通过。

## Consequences
并发读者不再读到测试故意制造的脏源码。每个破坏探针付出一次树复制与磁盘占用，换取无需穷举所有读侧的隔离。工具不复制隐藏配置和非代码素材，不能挪作发布打包工具。

## Related notes
检索 proposed/implemented 中的 gate-lock、audit-copy 未发现既有归属；本篇接管本轮未落笔的锁方案取舍，不新增生产锁维护面。
