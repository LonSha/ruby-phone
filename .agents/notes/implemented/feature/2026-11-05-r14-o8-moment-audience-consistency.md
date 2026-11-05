# Agent Note: R14-O8 朋友圈发布前后同一份可见规则
Status: implemented
## Problem
计划书原文（`.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md`）：
> **本期交付**：先核对并收敛实际发送与读取规则，再补已发内容的逐人结果；不让预览和
> 实际两套算法分叉。
> **验收旅程**：公开/指定可见/屏蔽三类规则及id同名边界逐项对拍；编辑规则刷新结果，
> 读不出明确降级不装成已验证。

底座：`config/audience-projection.js`（R13-X5）做发布前预览，`wechat-data` 的
`normalizeMomentVisibility` / `canContactViewMoment` 是读取真源。缺口两处：

### 缺口一：已发内容没有「谁能看到」
发布页有投影预览（`_renderAudiencePreview`），但已发的动态只有点赞/评论弹窗——
发布之后规则变成黑盒，玩家无从核对「我发的这条到底谁能看见」。

### 缺口二：已发规则不能改
`wechat-data` 没有任何改已发动态可见性的写口。规则发错了只能删了重发。

### 缺口三：预览与实际的口径靠「逐字对齐」维持，没有判据守着
两套实现（audience-projection 纯函数 vs wechat-data 方法）是**两份代码**，
谁改了一边就会分叉，且没有任何测试盯着它们结论一致。
## Solution

1. **数据层写口**（`apps/wechat/wechat-data.js`）：新增
   `updateMomentVisibility(momentId, visibility)` —— id 定位、归一复用
   `normalizeMomentVisibility` 口径（别名闭集 hidden→exclude / only→include、
   名单去重）、写回 `moment.visibility`、`saveData` 落盘、返回 `{ ok, reason }`，
   不存在的动态如实拒绝不装成功。
2. **已发详情「谁能看到」**（`apps/wechat/moments-view.js`）：操作弹窗对**本人的
   动态**多出第三项「谁能看到」→ `showMomentAudienceDetail(momentId)` 弹层，
   逐人结论**直接消费真源 `canContactViewMoment`** —— 不用预览内核另算一遍，
   从结构上保证「详情页=实际规则」，预览/实际两套算法无处分叉。规则读不出时真源
   按 public 处理，界面如实标注。
3. **编辑规则**：详情弹层的「编辑规则」→ `showMomentVisibilityPickerForMoment`，
   复用发布选择器交互，确认时走 `updateMomentVisibility` 写回真源并**当场重开
   详情**（结果即时刷新）。
## 判据（tests/r14_o8_audience_consistency.test.mjs，6/6）
- A 对拍：预览内核 `projectAudienceForContact` vs 真源 `canContactViewMoment`，
  公开/仅给谁看/不给谁看 × 名册（含 **id 同名边界**：两个 Beta 不同 id，id 命中
  次序不同结论必须不同）逐人结论必须一致。
- B1/B2 编辑刷新：`hidden` 别名收敛为 exclude 立刻生效、`only` 收敛为 include 仅
  名单 id 可见（同名者不可见）、不存在的动态 `{ok:false, reason:'not-found'}`。
- C 接线：弹窗入口、`_isOwnMoment` 门控、详情消费真源、编辑回写四个锚点在位。
- D 负控制：破坏真源 exclude 分支（结论取反）⇒ 对拍必转红；破坏
  `updateMomentVisibility` 写回 ⇒ B1 必转红。副本树用**递归解析相对 import 的
  闭包复制**（同 r14_o6 的 mkTree 思路），不手写文件清单。
## 已知边界（诚实地留着）
- **编辑规则借道 `pendingMomentVisibility`**：复用发布选择器意味着编辑期间这个
  字段被临时占用（确认/关闭后恢复原值）。若未来发布流程并发使用该字段，需要
  独立状态位。
- **详情弹层无分页/搜索**：名册很大时逐人列表全量铺出。投影面板（发布预览）
  同样如此，属既有交互形态，本期不动。
- **弹层样式复用 class 前缀 `moment-audience-*`**，样式表若后续清理需同步。
## Verification
```
node --test tests/r14_o8_audience_consistency.test.mjs   # 6/6
grep -rln 'moments-view|wechat-data' tests/*.test.mjs | xargs node --test   # 293/293，0 fail
```
门禁：syntax · import-resolve · dead-exports · weak-coercion · named-import ·
keys · registry · hardlink-safety · lifecycle · source-derivation ·
bridge-contract · screen-host · doc-path-claim（4135 处，0 落空）· upstream-face ·
bind-consuming · method-consuming · session-writeback —— 全部退出码 0。
