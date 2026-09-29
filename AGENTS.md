# RubyPhone Project Instructions

## 起点动作（强制）

- 每个新任务 / 新对话开始时，在分析、规划、执行命令或改动文件**之前**，
  完整读一遍本仓的 `CONTEXT.md`（UTF-8）。
- 它是本项目的**权威真源**：项目结构、开发规则、存储约束、跨 App 行为、标签格式
  以它为准。**若与代码冲突，以代码为准，并把 `CONTEXT.md` 改过来** ——
  本仓的既定口径是「给人读的那一处不得与真源脱节」。
- 每个新任务都要重读，不要因为「上次看过」就跳过（文档会随版本变化）。
- 读不到 `CONTEXT.md` 时，**先告诉用户**再动项目文件。

## 本仓另外两处权威真源

- `package.json` 的 `scripts.check` —— **门禁道数与顺序**的唯一真源
  （`CONTEXT.md` 相关段落只是它的转写）。
- `update-log.json` + `index.js` 的 `ST_PHONE_CURRENT_UPDATE` —— 版本条目真源，
  两份由判据强制**逐字同源**。

## 提交前

```bash
npm run check    # 一次跑完全部门（语法 / 导入 / 测试 / 死导出 / 生命周期 / …）
```
门禁必须 rc 0 才能提交。全绿不是「没坏」，只是「这十一条一致性守住了」。

## 历史说明

本文件旧版标题为 "Yuzuki Phone Project Instructions"，并要求读
`C:\Users\Tienchi\Code\手机文件代码结构.txt`（原作者开发机上的路径，
在本仓与本机均不存在，属死指针）。已按本仓实际形态改写：
项目名是 RubyPhone，权威文档是仓内 `CONTEXT.md`。
