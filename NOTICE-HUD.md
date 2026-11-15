# NOTICE — TavernOS HUD 机制缝入（R21-X3 · v4.151.0）

本仓（ruby-phone）自 v4.151.0 起，将 [TavernOS HUD](https://github.com/alewwi/HUD)
（© 2026 alewwi，v23.89.33，AGPL-3.0）的**部分机制**移植进本仓。

## 涉及文件

- `apps/memory/hud-bridge-parser.js` —— HUD 块解析、现场态投影、末帧快照回喂
- `apps/memory/lonsha-bridge.js` —— 桥侧摄取面（`ingestHudFromFloor` / `refreshHudFromChat` / `buildHudSnapshotBlock`）与注入追加
- `apps/memory/memory-data.js` —— 记忆入库前的 HUD 块语义剥除
- `index.js` —— 事件面与自愈面接线

## 授权与义务

TavernOS HUD 以 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布。
其上游 `NOTICE.md` 明确要求：**若复用或改写本代码，无论手工或用 AI 辅助，
请保留本声明并署名 alewwi + 仓库地址**（https://github.com/alewwi/HUD）。

本仓遵守该要求：被移植模块（`apps/memory/hud-bridge-parser.js`）头部保留
上述署名与来源地址，本文件保留声明全文指针。本仓对移植部分同样以
AGPL-3.0 的兼容方式发布，任何人取得本仓代码即同时取得该部分的
AGPL-3.0 授权。

上游明确声明 AGPL 只覆盖其**代码**，不覆盖 `img/` 与 `docs/screens/` ——
本仓未复制上游任何图像资产，故该项边界在本仓无触及面。

## 移植范围（如实登记）

- **已落地**：M1 末帧回喂（旧块不进记忆正文 + 只回喂最后一楼快照）、
  M3 块解析与字段映射（含块内不重复开标签、推理标签掩码、实体形态识别）。
- **未落地**：上游第三条机制「差分计量」（重 build prompt 两次相减量开销）——
  本仓没有统一 prompt builder、宿主 `setExtensionPrompt` 只写不读、
  无 tokenizer，无可验证落点，故**不做、不留占位**。
  详见 `apps/memory/hud-bridge-parser.js` 文末「未落地面」。
- **移植形态**：机制级重写而非代码照抄（上游依赖 settings/i18n/DOM，
  本仓零依赖纯模块），机制判据与事故教训（提及吞正文等）逐条保留。
