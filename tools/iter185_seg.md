## 迭代 185 — v4.26.0 · 第四期 R4-X5 角色信息差与证词对照
# 占位：下列条目由 tools/bump_v4260.py 写入 ITERATION_LOG.md 与本版 update-log 条目
- 【版本升至 4.26.0（五源同源）：第四期 R4-X5 角色信息差与证词对照】
- 【新增 config/perspective-contrast-contract.js：六态分形（插件不在场 / 面不在场 / 本机读不出 / 没给看谁 / 真读数无内容 / 读到）；并排对照 onlyLeft / onlyRight / shared / misledSide 原样透传，**不合成信息差分数**；证词面四态 supported / contested / undecided / withdrawn 与未裁决三档 ambiguous / below-threshold / transmittal-only 逐格端出；身份四面闸（未揭穿视图挡掉 revealed、homonym 与 unspecified 照常可见）；作者与角色模式显式闸；窄屏逐人切换版式；禁用键深度扫描（百分比 / 置信度一族）】
- 【本版自己抓到的缺陷形态：修前实测「名面已在、手机侧零消费」——上游视角卡面 v3.323.0 与证词面 v3.343.0 早已交付，而 apps/chars 下 grep perspective 零命中；且证词面**上游交付时漏登外供表**，故本版走「三处同批」补齐：上游表行 / 本仓登记行 / 本门标签】
- 【本版自己抓到的缺陷形态：登记行 keySites 的 token 初版写 engine.testimonyBoard，而真源里变量名是 eng.testimonyBoard —— 登记面自己给出错读数（v299 的 chars vs characters 同族），由 tests/system-v3190 的 A2 当场转红】
- 【交棒改写：新增 apps/chars/chars-perspective.js 接线件（取数 + 模式闸 + 版式，只搬不重算）；chars-app.js 增九个 perspective 出口与生成侧模式闸块；chars-view.js 增对照卡与三个显式选择控件；chars.css 增四个样式类与窄屏媒体查询；配置默认值只加一个字段 perspectiveMode，**不新增 storage 键**】
- 【交棒改写：scripts/bridge-contract-audit.mjs 新增 J19（证词面真源四出口 + 产品侧消费点下限 1）与门禁标签；config/crossrepo-registry.js 新增登记行 lonsha.testimonyBoard（since 取上游 producer_version 同口径）；tests/audit/upstream_face_cache.json 按 R9 纪律显式刷新至上游补登记后的提交态】
- 【运行时验证边界：本版接线为真跑（真契约件 + 真接线件 + 假存储走完整旅程），但真实 SillyTavern 宿主里的点击流与真实模型的生成上下文**未跑** —— 角色模式「不把全知正文塞入角色生成上下文」这一条在实现上由内核函数截断保证并有判据守住，其**在真实宿主上的最终效果待实机复核**；登记入 docs/runtime-verification-boundary.md】
- 【本版新增判据 tests/system-v4260.test.mjs，五组覆盖口径 / 内核行为 / 接线行为 / 负控制 / 版本锚】
- 【不做（计划原文三条）：不再造知识权限规则（权限一律沿上游格位语义）；不新增好感度算法；不以一票多数裁真相（四态与三档原样端出，谁也不投谁的票）】
