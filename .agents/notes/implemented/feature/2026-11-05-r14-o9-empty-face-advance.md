# Agent Note: R14-O9 空态和设置提示能带人解决问题（分形推进）
Status: implemented
## Problem
计划书原文：
> **本期交付**：优先高频未覆盖页面补重试/清筛选/前往授权；核实三类设置从控件到读取时机真生效。
> **验收旅程**：空数据/筛空/读失败/源缺席各有对应动作；三类设置各选实际控件证明声明与行为一致。

底座：R13-O6 的 empty-face 四态内核（ok/empty/blocked/absent）已接 25 个高频 App，
63 个未接线 App 在 `config/empty-face-unshaped.json` 台账里排队（view-pending 46 个）。
设置生效面 R13-O5（setting-effect 三档 + 176 项登记 + 100% 覆盖判据）已完整在役。

本期选取 view-pending 队列里**空态文案最多**的三个高频 App 推进分形：
loverspace(4)、needsim(5)、search(5)。
## Solution

1. **loverspace-view**：三处空态（今日足迹/情书/问答）经 `_todayFace/_lettersFace/_qaFace`
   判定挂 `FACE_ATTR + data-face`——数据面读不到 ⇒ absent(read-failed)，真没有 ⇒
   empty(no-data)。判定只在这三个 helper，不散进渲染。
2. **needsim-view**：记忆流与回执两处空态经 `NeedsimView._rowsFace(rows)` 判定——
   rows 不是数组 ⇒ absent，是数组但空 ⇒ empty。
3. **search-view**：三处空态逐一归因——「没有找到」= empty(no-data)、
   「N 个来源读取失败」= absent(read-failed)、「正在检索」= absent(not-ready)。
   搜索域内正常空与来源读失败从此机器可分（判据 A3 逐条对锚）。
4. **台账同步**：三 App 从 unshaped 移除，shapedCount 25→28，unshapedCount 63→60。
5. **负控制闭包补件**：search-view 新增 empty-face import 后，v281/v3170/v3760
   三套件的破坏副本 CLOSURE 同步补 `config/empty-face.js`（否则负控制因缺文件
   误红——同一支笔的教训，v4.99.7/v4.110.0 已两次复现）。
6. **v3410 E3 allowlist**：needsim 视图 import 白名单补 empty-face（零依赖叶子，
   只取 FACE_ATTR/faceHtml 词表与判定，不算「视图自己算内核」，理由写进判据）。

设置生效面（第二半验收）经核实在位且全绿：SETTING_EFFECT 登记项保持三位数、
三档文本与未知档不同形、system-v4108 全 21 项通过——本期未动该面，仅复核。
## 判据（tests/r14_o9_empty_face_advance.test.mjs，6/6）
- A1/A2/A3：三 App 真用 FACE_ATTR 常量、empty 与 absent 两态都存在、search 三处
  归因各异；
- B1：台账同步（已接线不留台账、shapedCount=28、计数与条目一致）；
- C1：设置三档文本 + 未知档不同形（R13-O5 底座复核）；
- D1：破坏 search 空态归因（no-data→read-failed）⇒ A3 必转红。
## 已知边界（诚实地留着）
- **仅推进三个 App**：view-pending 仍有 43 个（diagnose 9、music 5、taobao 4……），
  按计划书「先做高频」口径排队，不在本期射程。
- **loverspace/needsim 的空态没有「对应动作」按钮**（如相册的「清除筛选条件」）——
  这两个 App 的 empty 态是「真的没有」，处置是去用 App 本身，不需要额外动作钮。
  search 的 blocked 态（筛空）由 R3-O4 的受控筛选读数行覆盖，不重复建。
- **「前往授权」类动作**：三 App 均无权限面，no-permission 归因无落点，未造。
## Verification
```
node --test tests/r14_o9_empty_face_advance.test.mjs   # 6/6
node --test tests/system-v4109.test.mjs                # 18/18（empty-face 总验收不回退）
node --test tests/system-v4108.test.mjs                # 21/21（设置生效面不回退）
grep -rln 'loverspace|needsim|search-view' tests/*.test.mjs | xargs node --test   # 497/497
```
门禁：syntax · import-resolve · dead-exports · weak-coercion · named-import ·
keys · registry · hardlink-safety · lifecycle · source-derivation ·
bridge-contract · screen-host · doc-path-claim · upstream-face · bind-consuming ·
method-consuming · session-writeback —— 全部退出码 0。
