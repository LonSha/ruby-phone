# Agent Note: 跨页面输入缓冲的未确认回执

Status: implemented (real-host acceptance deferred)

## Problem
聊天、朋友圈、日记和日程的未提交输入原本多依赖页面或实例状态。数据 owner 的返回值多数只表示内存条目已修改，PhoneStorage 的异步写入也可能吞掉错误，因此不能把条目 ID、布尔值或 Promise 完成直接当作持久化成功。

## Decision
DOM 适配层复用编辑缓冲键和会话栅栏，以会话与目标槽区分草稿，恢复由用户选择。缓冲写入后回读同一键，并明确提示回读不代表持久落盘。业务保存没有可靠确认时，调用点传未成功回执，保留缓冲；只有实际成功回执且提交文字与缓冲逐字相同时才能清理。

## Alternatives considered
- 根据 owner 返回的条目或布尔值清理：交互简洁，但这些值不证明存储写入完成，可能丢掉唯一草稿。
- 继续复用创作台的单槽纯函数：接口已有，但四个页面需要独立目标和 DOM 事件，且纯函数层不得引入 DOM 副作用。

## Testing
最新 `node --test tests/edit-buffer-*.test.mjs tests/system-v4170.test.mjs` 为 **62/62 通过**。其中聊天、朋友圈、日记新建/编辑、日程新建/编辑都有真实 handler 行为测试，覆盖失败后修改重试复用同一记录、在途重复提交被忽略、确认期间继续输入不清空也不导航，以及确认返回前切换聊天或离开页面的情况。11 道相关静态门通过：syntax、import-resolve、dead-exports、bind-consuming、method-consuming、lifecycle、keys、source-derivation、named-import、session-writeback、weak-coercion；`git diff --check` 也通过。DOM 替身和服务端桩不能证明真实宿主持久化。

## Related notes
[第十四期优化计划](../../proposed/architecture/2026-11-03-product-optimization-v14.md) 的 R14-O4 与本记录部分重叠，计划仍保留全部验收；[第四期优化计划](../../proposed/architecture/2026-10-15-product-optimization-v4.md) 的编辑缓冲是已有底座，不由本记录替代。其余关键词命中的历史第三、八、九期计划是独立计划，不作合并。

## Consequences
四个页面的提交路径使用 `confirmEditOwner`：写入 owner 快照，调用宿主保存并读回聊天文件；读取不匹配、宿主吞错或会话切换不能视为成功。日程新建在确认后才创建关联约定，失败后修改重试的 handler 测试确认复用备忘并使用最终内容；群投票转交及真实宿主持久化幂等仍需验证。日记编辑已补在途互斥。本地 SillyTavern（1.19.0）可访问，但没有打开的聊天，也没有注入 RubyPhone，因此真实用户会话的读回与页面重开尚未验证。按用户决定，真实宿主验收延后到整期收口统一执行；在此之前 O4 不宣称真实宿主验收通过。
