#!/usr/bin/env python3
"""tools/patch_v4151_entries.py — v4.150.0 的两处人工叙述入口改写（TODO 顶面 + 待办条目）

为什么需要单独一个脚本（而不是手改）：
  TODO.md 顶面那行是「机器可读前缀 + 人类叙述后缀」的形态。
  tools/gen_plan_baseline.mjs --write 只回写**版本号那一格**（这是它对
  R13-O7「--write 只写机械可算的格子」纪律的自觉），后缀叙述永远归人写。
  所以改了版本号之后叙述会与当版不符（停在上一项的 O9），必须由本脚本改。

本脚本只做两件机械事，不做判断：
  1. 把顶面「最近更新」行的**前缀**与**后缀**一起换成当版 X2 的如实叙述；
  2. 在「R21-O9 已完成…」条目之后插入 X2 的当版条目。
  两处都先断言旧文本在场（缺失即 exit 1），不猜位置、静默跳过。
"""
import sys, io

TODO = 'TODO.md'

X2_ENTRY_HEAD = '<!-- R21-X2 v4.150.0 -->'

TOP_NEW = (
    '> **最近更新：v4.150.0**（第二十一期批次 E 第一步 R21-X2：双仓剧情钟对齐校验 ——'
    '新增 `apps/memory/cross-repo-clock-alignment.js` 严格纯读内核，读手机端**有效期内已发布**的'
    '剧情钟缓存与 LonSha 对象快照，输出 `aligned` / `skewed{minutes}` / `unavailable{reason}`，'
    '**只报差异、绝不自动改写任一侧**（改写权归各仓 owner）。为把「纯读」从口号变成可判事实，'
    '先给真源补三处**只读口**（默认行为逐字不变，既有九账消费者不受影响）：'
    '① `config/world-bridge.js` 的 `readPushProbe(win, options)` 增 `publishedOnly`（短路 `stat()` / '
    '拉取型 `snapshot()` / `refresh()` 三处副作用）与 `bridgeId`（限定桥来源）；'
    '② `config/time-manager.js` 增 `peekCurrentStoryTime()`（只回有效期内缓存浅拷贝，'
    '空 / 过期 / `isReal===true`（墙钟回退）一律 `null`）；'
    '③ `config/time-source.js` 的 `storyNow(win, options)` 增 `options.readOnly`。'
    '判定以诚实优先：上游 `date + label` 若解析不出精确时分（label 形如「申时·薄暮·大雪」「清晨」），'
    '落 `unavailable` 并说明精度不足 —— **不把缺时间补成午夜、不猜时段**。'
    '判据 `tests/system-v4151.test.mjs` 12 例 A～D 四组全绿，负控制三条：'
    '（a）`publishedOnly` 下 `refresh` 与拉取型 `snapshot` 的调用计数必须为 **0**，并对比调用前后'
    '宿主序列化快照；（b）真 `TimeManager` 注入**会抛的** storage 句柄后，冷 / 有效 / 过期三态下'
    '读写计数仍为 **0**（重算即红）；（c）五源同源取下限形 `>= 4.150.0`、不写死版本号。'
    '**计划原文的「面板立刻显示偏差」已如实收窄为「面板显示可比或读不到」**：'
    '本环境无真机、无上游实时剧情钟，跨仓两侧同刻不可实证，边界归 `docs/runtime-verification-boundary.md`。'
    '抬版刻意跳过 4.149.0（该版号只出现在提交信息里、五源从未落过它），'
    '故本版 prev 取真实的 4.148.0，不伪造一条不存在的历史版本。'
    '连带面收口：`doc-path-claim` 到期自锁按设计触发 —— R21-O7 走「删净」分支（v4.146.0 已删 '
    '`apps/games/games-data.js` 与 `games-view.js`），台账按设计从未产生，本版把该条目从计划交付物'
    '台账撤出、改用 `historical_records` 登记并写明「另一条分支成立而永不需要存在」的语义。'
    '批次 E 进行中，下一项 R21-X5。'
)


def main() -> int:
    with io.open(TODO, encoding='utf-8') as f:
        text = f.read()

    lines = text.split('\n')
    # 1. 定位并整体替换顶面「最近更新」行（前缀+后缀一起换）
    idx = None
    for i, ln in enumerate(lines):
        if ln.startswith('> **最近更新：v'):
            idx = i
            break
    if idx is None:
        print('[patch_v4151_entries] 找不到 TODO.md 顶面「最近更新」行（不猜位置）', file=sys.stderr)
        return 1
    old_top = lines[idx]
    if 'v4.150.0' not in old_top:
        print('[patch_v4151_entries] 顶面版本号不是 4.150.0，'
              '请先跑 tools/gen_plan_baseline.mjs --write', file=sys.stderr)
        return 1
    lines[idx] = TOP_NEW
    print('[patch_v4151_entries] 顶面叙述已改写：%d 字符 -> %d 字符'
          % (len(old_top), len(TOP_NEW)))

    text = '\n'.join(lines)

    # 2. 在 R21-O9 条目行之后插入 X2 条目
    if X2_ENTRY_HEAD in text:
        print('[patch_v4151_entries] X2 条目已在场，跳过插入（幂等）')
    else:
        anchor = None
        for ln in text.split('\n'):
            if ln.startswith('- R21-O9 已完成源码与定点验证'):
                anchor = ln
                break
        if anchor is None:
            print('[patch_v4151_entries] 找不到 R21-O9 待办条目行（不猜位置）', file=sys.stderr)
            return 1
        entry = X2_ENTRY_HEAD + '\n' + X2_ENTRY_LINE + '\n'
        text = text.replace(anchor + '\n', anchor + '\n' + entry, 1)
        print('[patch_v4151_entries] X2 待办条目已插入（%d 字符）' % len(X2_ENTRY_LINE))

    with io.open(TODO, 'w', encoding='utf-8') as f:
        f.write(text)
    print('[patch_v4151_entries] 写入完成：' + TODO)
    return 0


X2_ENTRY_LINE = (
    '- R21-X2 已完成源码与定点验证：双仓剧情钟对齐校验 —— 新增 '
    '`apps/memory/cross-repo-clock-alignment.js` **严格纯读**内核：'
    '`clockFace(clock)` 归一入参（`date`/`storyDate`、`time`/`storyTime`/`label`、`precision`、'
    '`timestamp`），`label`-only 且 `precision` 不在 `[\'minute\',\'second\',\'exact\']` 时返回 '
    '`{ display, ms: null }` 明确不可比；`parseClockToTimestamp()` 要求**日期与精确时分同时可解析**，'
    '用 `setUTCFullYear` + `setUTCHours` 并**回读校验**（避开 `2/29`、月底进位把无效日期算成有效）；'
    '阈值经 `config/num-gate.js` 的 `numOrNull` 归一（不新造数值口径），未舍入的 `minutes` 参与判定、'
    '返回时 `toFixed(2)`。三态由事实唯一决定：`memory-bridge-absent`（无桥）/ '
    '`memory-no-snapshot`（有桥无快照）/ `memory-clock-absent`（有快照无钟）/ `unavailable`（精度不足）。'
    '**纯读硬证据**：手机侧只走 `storyNow(w, { readOnly: true })`（→ `peekCurrentStoryTime`），'
    '记忆侧只走 `readPushProbe(w, { publishedOnly: true, bridgeId: LONSHA_BRIDGE_ID })`，'
    '故判据能用**调用计数守卫**证明 `refresh` / 拉取型 `snapshot` / storage 读写一次都没发生。'
    '判据取空闲号 v4151（规格未指定号；`tests/cheat-1108.test.mjs` 注释里曾把该号登记为「未来可能占用」，'
    '本版实占并如实留痕），12 例 A～D 四组全绿含三条负控制。'
    '**未验证**：真机跨仓两侧同刻读数（本环境无上游实时剧情钟）；面板可见文案的真机呈现。'
    '边界见 `docs/runtime-verification-boundary.md`。计划原文「面板立刻显示偏差」如实收窄为'
    '「面板显示可比或读不到」。'
)


if __name__ == '__main__':
    sys.exit(main())
