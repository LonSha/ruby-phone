#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回滚 patch_o1_items.py（v1）对 tools/iter204_seg.md 的误插（锚点在 md 面上不唯一）。

【为什么留着这个脚本而不是删掉】
  它是本版一次**真实踩坑**的物证，与 `tools/patch_o1_items.py` 的档头教训互为表里：
  跨面改写不能用「人眼看着唯一」的锚点。删掉它，下一个人只能从公告里读到「锚点失配过」，
  读不到**当时错在哪一面、错成几次**。本仓对一次性脚本的惯例是留在 tools/ 下（见
  `tools/takeover_v4440_anchors.py` / `tools/patch_o2_anchor_item.py` 等）。

【当时的实测】
  裸锚点 `- 【不做面在代码上可判】`：
    · `tools/iter204_seg.md` 恰中 1 次 ⇒ 插入了 4 条；
    · `ITERATION_LOG.md` 命中 **2 次**（v4.44.0 段有一条同名开头的条目）⇒ abort；
    · `index.js` / `update-log.json` 的 items 命中 **0 次**（行首多一对引号）⇒ abort。
  脚本当场 abort（exit 2）并如实报出三个失配，未做任何静默部分替换 —— 但**已写入的
  `iter204_seg.md` 需要人工回滚**，就是本脚本。

【口径】按「本版专属内容」逐行删除误插的 4 条（不碰别处），删完自证 0 残留。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'tools/iter204_seg.md'
MARKS = ['- 【自己抓到的缺陷⑤（本版引入', '- 【门禁读数如实：本版只降自己引入的',
         '- 【公告读数不得手抄：判据条数写错即', '- 【本版四道门禁与全量回归的实测口径']


def main() -> int:
    lines = TARGET.read_text(encoding='utf-8').split('\n')
    kept = [l for l in lines if not any(l.startswith(m) for m in MARKS)]
    removed = len(lines) - len(kept)
    TARGET.write_text('\n'.join(kept), encoding='utf-8')
    t = TARGET.read_text(encoding='utf-8')
    for m in MARKS:
        assert t.count(m) == 0, f'仍有残留：{m}'
    print(f'[ok] 回滚 {removed} 条误插条目；自证 4 个标记 0 残留')
    return 0


if __name__ == '__main__':
    sys.exit(main())