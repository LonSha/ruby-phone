# 参考项目上游盘点（2026-10）

> 本文件只回答一件事：**用户投喂的参考项目更新，实体是什么、本地留存落后多少。**
> 它**不**回答「该缝什么」—— 缝什么要先读出上游真源码再定（本仓纪律：**先读真源码、再决定缝什么**，
> 不照抄上游自评的路线图）。
>
> 出处：用户 2026-10-10 投喂的四条仓库链接 + 四个附件（附件原件在会话清理目录，已保底另存）。
> 本文件由 v3.46.0 顺手归档，读数一律取**实测**（`git rev-list --count` / `git diff --name-only`）。

## 一、四条上游仓库（实测）

| 仓库 | 上游 HEAD（实测） | 本地留存 | 落后提交 | 变更文件 |
| --- | --- | --- | --- | --- |
| `atonal519/ST-MyriadKnots` | `ad7bc77` 2026-10-01（tag `v0.6.3`） | `/home/user/ST-MyriadKnots` @ `a5643bc` 2026-09-13 | **46** | 120 |
| `Liuuuu54/st_bs_biotracker` | `7106c47` 2026-10-02 | `/home/user/st_bs_biotracker_latest` @ `9dbae10` 2026-09-20 | **123** | 81 |
| `AlbusKen/shujuku` | `90df4d7` 2026-10-02 | `/home/user/memory-plugin-research/shujuku` @ `8646e5c` 2026-09-10 | **159** | 485 |
| `pathetic777/st-tavern-architect` | `7fe8d0d` 2026-10-02 | **无本地留存**（本仓首次取证） | — | 全仓 6 个文件 |

读法（三条，别读错）：

1. **「落后 N 提交」不等于「有 N 处可缝」。** 这三个数字里绝大多数是发布提交、文档改动与版本号滚动；
   能落到「本仓已有机制」上的增量要靠读源码逐条对，不是靠数提交。
2. **本地留存已陈旧。** 三份留存都不是上游 HEAD，「上游已有、本仓还没有」的清单必须用最新 HEAD
   重读，不得拿留存当真源。
3. **`st-tavern-architect` 是全新项目**（不是「更新」）：本地从未留存过，故无落后量可比。
   本次取证用的是**浅克隆**，提交数未取（浅克隆的 `log --oneline | wc -l` 恒为 1，不可当读数）——
   如实登记，不猜。

### 上游变更要点（从提交标题与仓内文档抽出，**未逐行读源码**）

- **ST-MyriadKnots**：`CSE v0.5.7 → v0.6.3`。要点：Qianshi/潜识 的删除与异常处理、反复投影修复、
  时间线统一与手动修正、TauriTavern 安装文档。
- **st_bs_biotracker**：`v1.0.0 → v1.0.7`。要点：孕期阶段扩展、宫缩乏力、孕育速度滑块、
  产后恢复系数计算、TauriTavern 稳定 chat id 缓存。
- **shujuku**：填表「使用工具调用」开关迁移（移至填表模式页、四种模式通用）、原生工具调用默认关闭
  并一次性降级提示词、向量热缓存、Gemini `tool_choice` 格式兼容、桌宠走路帧与四边停靠、提示词合规声明。
  变更面集中在 `src/data/gateways/*`、`src/data/models/settings-model.ts`、
  `src/data/repositories/profile-repo.ts`、`src/data/storage/vector-index-hot-cache.ts`、
  `dist/index.bundle.js`；分支面有 `dev` / `main` / `release` / `test13.7-on-spv8.3.1`。
- **st-tavern-architect**：3D 酒馆建筑师，Dual-Agent + Three.js。`manifest.json` 的 `display_name`
  为「酒馆建筑师」、`version` 1.0.0、`js` 为 `index.js`、`loading_order` 999；
  全仓 6 个文件（`LICENSE` / `README.md` / `README_zh.md` / `index.js` / `manifest.json` / `workbench.html`）。

## 二、四个附件（实体已辨明 + 保底位置）

附件原件落在会话清理目录（`/storage/emulated/0/Download/Operit/cleanOnExit/`），已保底另存到：

`/home/user/refupd-2026/attachments/`

| 文件（保底名） | 字节 | md5 | 实体 |
| --- | --- | --- | --- |
| `心之壁-认知隔离-普适9.29-思维链增项.json` | 12152 | `cf31dad3c3bb031812d2d9f6a901f77a` | **世界书**（顶层只有 `entries`，2 条：反全知通用层、切勿打开预设可增添版块） |
| `生理孕育状态面板-角色卡.json` | 308600 | `a2e1c32f14db7a4193d4e5f731a06aa1` | **角色卡**（`chara_card_v3` / `spec_version` 3.0；`name` = 生理孕育状态面板；`character_book.entries` 18 条；`first_mes` 1818 字符；`mes_example` 为空） |
| `瑟瑟小手机-V1.100.json` | 1727553 | `5c3f5532706c53acdbb691562fe52ff1` | **ST 脚本**（`type` = `script`；`content` 1424755 字符；`export_with` = data+button） |
| `色色灵感状态栏-V3.800.json` | 5014369 | `fd14c8ec2e0c52f54dea5460aa7768c5` | **ST 脚本**（`type` = `script`；`content` 3887227 字符；同上 `export_with`） |

**同目录另有未被点名的余件**（一个 94100 字节、一个 53314 字节、三个 7~8KB 的 `.json`、
一个 4838 字节 `.txt`、两个 10552 字节 `pasted_text`、一个 `.nomedia`）—— 是否属于同一批
**待用户确认**，本文件不为它们下结论。

## 三、这批更新**不能**说明的东西（诚实登记）

| 想从这份盘点得出 | 本文件能不能给 | 为什么 |
| --- | --- | --- |
| 「上游有哪些机制、本仓缺哪些」 | **不能** | 本文件只记了 HEAD / 落后量 / 提交标题要点；机制清单要逐行读上游源码 |
| 「上游 HEAD 之后不会再变」 | **不能** | 读数是 2026-10-01/02 的快照，上游随时会再提交 |
| 「四个附件与四条仓库是同批配套」 | **不能** | 附件与仓库的对应关系未经用户确认（附件实体已辨明，配套关系未辨） |
| 「落后 159 提交 ⇒ 缝 159 处」 | **不能** | 提交数含大量发布/文档/版本号滚动，不是可缝面计数 |

## 四、变更面（按目录聚合，实测 `diff --name-only`）

这一节只给**路径**，不给判断 —— 让下一版能直接照着读源码。

- **ST-MyriadKnots**（120 文件）：`src/v3/` 30 个、`src/ui/` 19 个、`tests/` 一批 `v3-*.test.mjs`。
  新增件里有 `src/v3/qianshi-domain.js`、`qianshi-schema.js`、`public-qianshi-bridge.js`、
  `chat-branch-inheritance.js`、`preparation-diagnostic.js`、`time-annual-setting.js`、
  `src/storage-management.js`、`src/tauri-backend.js`、`src/ui/font-scale.js`；
  文档 `docs/qianshi-backend.md` / `tauritavern.md` / `troubleshooting.md`。
- **st_bs_biotracker**（81 文件）：`docs/mechanics/` 全套 10 篇（`cycles-and-conception.md`、
  `pregnancy-and-labor.md`、`tracking-and-state.md`、`wardrobe-and-skills.md`、`tool-reference.md` 等）、
  `scripts/fetus_sprite.js`、`scripts/state_migration.js`，以及一批 `tests/*.test.mjs`。
  ★ 这套 `docs/mechanics/` 是**机制文档**，读它比读源码快 —— 但结论仍以源码为准。
- **shujuku**（485 文件）：`src/service/` 150、`src/presentation-v2/` 103、`src/presentation/` 30、
  `src/shared/` 13、`src/data/` 7，配套测试同规模；新增 `src/data/gateways/pristine-fetch.ts`、
  `src/presentation-v2/assets/desk-pet/*`（走路帧与表情位图）。变更面**远大于**另两仓。
- **st-tavern-architect**：全仓 6 文件，无「变更面」可言（首次取证）。

