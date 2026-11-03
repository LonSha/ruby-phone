# Agent Note: 借看手机只投影可回源的双人会话

Status: implemented

## Problem
玩家微信数据没有「对方给玩家的备注」或对方与第三人的聊天。直接翻转 unread、blocked 或 contact.remark 会制造不存在的对方手机事实；消息正文的真实字段是 content，不是 text。

## Decision
`config/other-side-view.js` 只输出与你相关的只读片段。`apps/chars/chars-app.js` 解析真实 data.chats 的会话，优先直接读 data.messages，避免调用可能迁移数据的 getMessages。视图经 App 桥取投影，使用真实 CharsView 和 chars.css 验证左右气泡及窄屏布局。

对方给玩家的备注恒 absent；玩家未读、玩家拉黑和第三人会话明确 withheld。数据不可读和未选角色分为 no-source/no-contact；ready 不是「已读取对方真实设备」，只是有依据的双人会话反向展示。入口要求已登记档案和显式点击，不会发消息或持久化投影。

## Alternatives considered
- 复用 contact.remark 能直接填满界面，但备注方向相反，不能冒充对方给玩家起的名字。
- 只调用 getMessages 可统一接口，但真实微信实例可能有懒迁移；借看不应触发写入，因此先读取已加载内存。
- 浏览器夹具仿写 App 桥能减少依赖，但会漏掉真实字段和实例接线错误；场景直接使用 CharsApp.prototype.borrowOtherSidePhone。

## Testing
`tests/system-v4119.test.mjs` 覆盖状态、来源、真实字段、零写面、源快照及真实源码变异。负控制使用异步副本生命周期，参见[隔离负控制](../../implemented/testing/2026-11-03-isolated-audit-mutants.md)。浏览器场景加载真实 CSS，并检查 elementFromPoint 命中、换行转义不泄漏和窄屏不溢出；全矩阵结论以现场日志为准。

## Consequences
宁可显示缺席，也不构造另一台没有真源的手机。当前是档案入口下的双人会话片段，不是通知栏、桌面或完整聊天列表模拟器。离开 App 即离开投影，不生成独立存档；酒馆宿主主题和真机交互仍需实机验证。

## Related notes
检索活跃笔记：第十三期拓展计划的 R13-X9 为部分重叠的原始愿景，本篇记录已实现的有源投影边界，不把完整对方设备模拟标成完成；异步副本笔记继续持有测试隔离契约。
