# v4.140.0 批次 3 时间轴收口：朋友圈两引擎改走剧情钟

日期：2026-11-10
范围：`apps/moments/moments-living-social-ecosystem.js`、`apps/moments/npc-social-graph-dynamic-moments.js`、`phone/domain-engines-mount.js`、`index.js`

## Problem

v4.139.0 的白名单里，这两个文件被**如实登记**为「story 档待收口」：

> `timestamp` 是**内容时间轴**，按口径应走 storyNow —— 本轮如实登记为 story 档待收口，
> 不宣称已收口。收口指改走 time-source；本批只做到「每处都说得出为什么」。

登记的七处裸 `Date.now()` 全部是「这条动态 / 这条评论发生在什么时候」，
会渲染成用户可见的时间文案。而 `config/time-source.js` 的 `FIELD_CLOCKS.timestamp = 'story'`
是闭集判定：用户能看见的时刻属于剧情钟。两者矛盾 —— 剧情里写着 2044 年，
朋友圈却显示本机日期，且**不报错**。

`FIELD_CLOCK_WHY.timestamp` 的原话是「一条消息在角色世界里发生的时刻（双轨制的剧情侧）」。
所以这不是「谁忘了改」，而是**登记过的欠债到期未还**。

## Decision

### 1. 用 `storyNowWallFallback`，不用 `storyNow`

`storyNow(win)` 读不到时给 `ms: null`（纪律：绝不补墙钟）。但 `timestamp` 在这两个引擎里
是**必填数字字段**：`getFeed` 按它排序，UI 按它算「多久前」。用 `null` 会让排序与相对时间
直接崩掉。

故走 `storyNowWallFallback(win).ms` —— 本仓**唯一允许的显式降级出口**：读不到时退回墙钟，
并把 `degraded` / `reason` 带回来，使「哪个引擎在什么条件下用了墙钟」成为可答的问题。
**这是有意的降级，不是漏改**，理由写在两个文件各自的头注里。

### 2. `id` 保持墙钟

`postMoment` 的 `id` 是 `moment_<ts>_<rand>`。它是**幂等键**（去重 + 排序稳定），
不渲染给用户看，按 `FIELD_CLOCK_WHY` 的「随机 id」归 wall 档。
若跟着剧情钟走，剧情回拨后新动态会与旧动态撞 id。

### 3. 相对偏移必须建在同一个钟上

`- 3600*2000`（种子动态）、`+500`（自动回复）、`+5000`（rival 评论）都是相对偏移。
混用两个钟的后果是具体的：回复会排到评论**前面**（`getFeed` 按 timestamp 排序）。

### 4. 宿主注入面：挂在引擎容器上，不用闭包

`bindDomainEngines(handle, host)` 是**另一个函数**，拿不到 `mountDomainEngines` 的 `deps`。
故在 `mountDomainEngines` 里把宿主存到 `handle.engine.__win`，供分派函数取用。
`bindDomainEngines` 的 `host` 参数语义是「宿主 UI」（`{virtualPhone, shell}`），
不含 `timeManager` 所在的 window，不能拿它替代。

## 本版自己抓到的两个缺陷

### ① 判据绕过了装配层（E3 全绿但故障仍在）

首版判据 E3 直接 `createMomentsLivingEcosystem(undefined, fakeWin)` 并显式传 `win`。
它只能证明「引擎愿意用 win」。**负控制实测**：把 `phone/domain-engines-mount.js` 里
那行透传删掉（`createMomentsLivingEcosystem()`），E3 **照样 26/26 全绿** ——
而真实故障恰恰发生在装配层：引擎有能力、装配没接上。

故补 **E4**，从 `mountDomainEngines` 这个真实入口进。同样做负控制：
删掉透传后 E4 精确报出「★ 装配层没把 win 交给 moments 引擎」，实际值 `1794318758578`
（墙钟）对期望值 `2361259800000`（2044 剧情钟）。

### ② `bindDomainEngines` 里的一处 ReferenceError

E4 写完后立刻抓到：`handle.onMomentReactions` 里写了 `deps.win`，但那个作用域**没有 `deps`**
（它是 `mountDomainEngines` 的形参）。抛 `ReferenceError` 后被 `catch` 吞成 `lastError`，
于是 `onMomentReactions` **静默返回空数组** —— 朋友圈点赞永远是 0，且不报错。

这个 bug 在本版之前**不可能被发现**：`onMomentReactions` 有单测（`r22_domain_engines_wiring`），
但它测的是「不抛错、返回数组」，空数组也算通过。是「从装配层入口测 + 断言内容」才暴露的。

## Alternatives

**否决 A：把 `timestamp` 改成允许 `null`。**
改的是数据结构契约，波及 `getFeed` 排序、UI 相对时间、以及任何 `new Date(timestamp)` 的调用点。
而且 `null` 让「不知道」和「零」混在一起，正是本仓 `numOrNull` 那条纪律要防的形态。

**否决 B：让引擎自己去摸 `window`，不传 `win`。**
`apps/` 下直接读全局 `window` 会让判据环境（纯 Node）走不同分支，
于是「测试里绿、真机里不对」。宿主必须由装配层显式传入，这是全仓既有口径
（`readTimeManager` 的注释写着「宿主注入方式与全仓一致」）。

**否决 C：把 `id` 也改成剧情钟。**
见 Decision 2。剧情回拨会撞 id，而 id 撞了是**静默**的去重失败。

**否决 D：只改 `postMoment`，`addComment` 留墙钟。**
半收口比不收更糟：同一条动态的 `timestamp` 与评论的 `timestamp` 来自两个钟，
排序结果在剧情回拨后完全错乱，且没有任何读数会报出来。

**否决 E：放宽 E2 判据（允许白名单为空时跳过）。**
判据不许恒绿。E1 明确写着「白名单必须落盘：缺省放行等于没有判据」。

## Consequences

- 白名单两条登记改写为收口后的真实理由（`npc` 那条明确写「已无裸 `Date.now()`」，
  并注明保留条目只为记录收口轨迹与回滚点）。
- 全仓读数按既有工具重算，零手抄：导入条数 1400 → 1402、`index_lines` 14484 → 14488、
  方法账本行号 `postMoment` 33 → 60 / `likeMoment` 52 → 82（条目集合不变）。
- 测试数 6344 → 6346（新增 E3/E4）。
- **未验证**：真机 SillyTavern 下宿主 `timeManager` 的实际取值时序、剧情回拨后的排序表现、
  以及真机视觉上的时间文案。本轮结论只覆盖仓库内全量套件与审计工具。
  这句话也写进了用户可见的 4.140.0 更新说明里。
- **交棒**：`apps/moments/moments-dynamic-interaction-network.js` 仍在白名单里登记为
  「引擎内部流水与幂等键」，理由写的是「若将来把它接进用户可见文案，必须改走 storyNow」。
  下次动朋友圈 UI 时应先核对这条是否已到期。
