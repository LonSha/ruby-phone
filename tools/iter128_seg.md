## 迭代 128 — v3.70.0 · 拓展计划 X6 第三切片：创作素材到发布草稿
- **【定位 · X6 的真实缺口（修前实测处境）】** 本仓有八个创作类 App（musicdesk / stickerdesk / soundkit / pixiv / lofter / magazine / pvdesk / doujin），各自管理素材但彼此之间没有协议层回答「从哪个素材出处选了什么、放进哪个草稿、草稿最终发给谁」。代价是素材 id 不可追溯、草稿切聊串味、同曲多份播放状态不一致。X6 的任务是在协议层把素材来源、草稿构建与幂等账本接起来。
- **【协议层 · 来源登记表 + 草稿构建】** 新增 `config/creation-pipeline.js`（纯函数，341 行，11 个 export）：`CREATION_SOURCES` 钉死 8 个来源的素材类型与 idKey；`CREATION_TARGETS` 登记 6 个发布目标及接受的素材类型；`buildCreationDraft` 校验来源/目标/类型匹配后产出 `status: 'draft'` 草稿（不落账不发布）；`verifyMaterialExists` 校验素材在来源中是否存在。
- **【第二件 · 幂等草稿账本】** `creationIdemKey` + `normalizeCreationEntry` + `normalizeCreationLedger` + `diffCreationLedger` + `applyCreationLedger`：幂等键 `<source>:<materialId>:<targetApp>`，同素材同目标只记一次；diff 判断素材被删则标记 stale；上限 150 条，随会话隔离（creation_ledger）。
- **【接线 · 诊断中心 creationFace 卡片】** `apps/diagnose/diagnose-data.js` 加 IIFE 取数面（表自检 + 账本状态 draft/published 计数），`diagnose-view.js` 加 `_creationHtml` 渲染方法与卡片（与 knowledgeBridgeFace 同范式）；`index.js` 在 `checkCalendarScheduleReminders` 内加 `_creationLedgerCache` 缓存写入块。
- **【存储键 · 会话隔离登记】** `config/storage.js` 的 CHAT_DATA_PATTERNS 加 `^creation_` 前缀；`scripts/keys-audit.mjs` 加 `creation_ledger` 键（scope: chat）。
- **【验证 · 门禁与判据真读数】** 新增套件 28 个用例（协议 7 / 草稿构建 8 / 素材校验 6 / 幂等账本 13 / 版本与导出面 2），含幂等/截断/去重/素材被删标记陈旧/跨来源不干扰/空输入防御性降级的负控制。自检函数全绿。
- **【版本升至 3.70.0（五源同源）】** manifest.json / package.json / index.js 的版本常量与公告块 / update-log.json 的 latest 与 head 与新条目一次抬齐；本文件新增本迭代段；边界文档按当版复校。
