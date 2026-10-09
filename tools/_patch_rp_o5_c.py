#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o5_c.py — R-O5 第三刀：v3600 变异锚点判据交棒。

为什么必须改（不是"顺手改判据"）：
  v3600 的 D1/D6 把**索引阶段让出的原形状**写成了 3 行字面量
  （`await this._yieldTurn();` + `}` + 阶段二注释行）。R-O5 在该点**新增**了
  「索引片间受理作废」分支（默认关），让出点位置不变、让出次数不变，
  但那段字面量的形状合法地变了 ⇒ 锚点 0 命中。

  这正是本仓「判据交棒」的标准动作：**行为未变，形状变了 ⇒ 改锚点，不是改实现**。
  若反过来（为保住锚点而不加分支），那是把「测试字面量」当成了产品契约。

判据保留的能力：D1 的破坏意图是「删掉建索引阶段的让出」。交棒后它删的是
同一句 `await this._yieldTurn();`（恰中 1 次 · 在索引循环体内），判别力不变；
D6 另补一条「开关仍在」的读数，防有人把新分支整块摘掉而套件不自知。

纪律：锚点逐字相符且恰中 1 次；只写一个文件；默认 dry-run。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/system-v3600.test.mjs'
WRITE = '--write' in sys.argv
NL = chr(10)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


def main():
    src = rd(REL)

    A1 = ("const A_STAGE1 = ['            await this._yieldTurn();', '        }',"
          " '        /* ══ 阶段二：分片比中（检查点原位，片后让出） ══ */'].join(NL);" + NL
          + "const A_STAGE1_X = ['        }',"
          " '        /* ══ 阶段二：分片比中（检查点原位，片后让出） ══ */'].join(NL);" + NL)
    A1_NEW = ("/* [v3.75.0 + R-O5 交棒] 索引让出点仍是同一句；它在索引循环体内、且其后紧跟"
              "「索引片间受理作废」分支（默认关）。" + NL
              + " *   为什么不再把 `}` 与阶段二注释一起当锚点：形状变了（合法地多了一个分支），"
              + "判据要钉的是**让出本身**，不是它周围有几行。" + NL
              + " *   判别力不变：删掉这句后「第一次进度回调前不得再有计时器跑过」照样转红（D1）。 */" + NL
              + "const A_STAGE1 = \"            await this._yieldTurn();\";" + NL
              + "const A_STAGE1_X = '';" + NL)
    src = once(src, A1, A1_NEW, 'A_STAGE1')

    A2 = "    assert.ok(raw.includes(A_STAGE1), '真仓建索引让出仍在');" + NL
    A2_NEW = ("    assert.ok(raw.includes(A_STAGE1), '真仓建索引让出仍在');" + NL
              + "    /* [v3.75.0 + R-O5] 新增分支必须也在（防有人把整块摘掉而套件不自知）：" + NL
              + "     *   只钉「开关在场」这一条字符串 —— 分支的行为面由新套件 v3760 守。 */" + NL
              + "    assert.ok(raw.includes('const cancelIndex = opts.cancelIndex === true;'),"
              + " '真仓索引阶段受理作废的开关仍在');" + NL)
    src = once(src, A2, A2_NEW, 'D6')

    assert 'A_STAGE1_X = ' in src and 'cancelIndex = opts.cancelIndex' in src
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('target = ' + REL)
        return 0
    wr(REL, src)
    print('--- WRITTEN --- ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())