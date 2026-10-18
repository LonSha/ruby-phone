#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4l.py — [v4.28.0 · R4-X4 补丁 L] 修 v4060 两条「锁当版读数」陈旧断言

【为什么必须在本版修】这两条在 **HEAD（06dbfab）上就已经红**，实测（不是推演）：
`git worktree add /tmp/rp_head HEAD && node --test tests/system-v4060.test.mjs`
⇒ pass 10 / fail 2。成因是同一期前序两项改动了别人的账面读数，而当时全量回归被禁、
无人跑到它们：
  · B4 把消费侧面数写死成 `12 面` —— R4-X5 补 testimonyBoard（12→13）、
    本版 R4-X4 补 branchCanon（13→14）后，翻红读数只剩「数字不是 12」；
  · D2 断言 `nones.length >= 1`（「真仓此刻应有零消费面」）—— R4-X6（v4.27.0）
    把 causalChain 接进登记行后台账归零，断言当场塌。

两条都是本仓自己治过多次的**「锁当版读数」**形态（v3190 C2 的 `登记 1[0-9] 项`、
v3204 A4 的 `items.length >= 1` 是同一族）。修法照既有先例：改判**真不变量**，
不依赖任何一方的提交进度。
"""
import io
import sys

F = '/home/user/ruby-phone/tests/system-v4060.test.mjs'
WRITE = '--write' in sys.argv

OLD_B4 = (
    "    assert.ok(r.out.includes('12 面' + '（' + '消费侧' + '）'), "
    "'★ 上游现在 12 面,本版既不添消费点也不减面:' + r.out.split('\\n')[0]);\n"
)
NEW_B4 = (
    "    /* 【v4.28.0 交棒】原文把面数写死成 `12 面` —— 那是**锁当版读数**：\n"
    "     *   R4-X5 补 testimonyBoard 行（12→13）、R4-X4 补 branchCanon 行（13→14）之后，\n"
    "     *   翻红读数只剩「数字不是 12」，而这条要守的是「门如实报出真面数」。\n"
    "     *   改判真不变量：报出的数字必须等于冻读取里真有的面数（两处一致，\n"
    "     *   而不是等于某个历史数字）—— 与 v3190 C2 治掉 `登记 1[0-9] 项` 同一修法。 */\n"
    "    const faceN = Object.keys(JSON.parse(read(CACHE_REL)).faces).length;\n"
    "    assert.ok(r.out.includes(faceN + ' 面' + '（' + '消费侧' + '）'),\n"
    "        '★ 门必须如实报出冻读取真面数（' + faceN + '）:' + r.out.split('\\n')[0]);\n"
)

OLD_D2 = (
    "    const nones = Object.entries(cache.faces).filter((kw) => kw[1].consumer === 'none@0').map((kw) => kw[0])\n"
    "        .filter((f) => entries.includes(f));\n"
    "    assert.ok(nones.length >= 1, '真仓此刻应有零消费面(否则本版治的是个不存在的情形)');\n"
)
NEW_D2 = (
    "    /* 【v4.28.0 交棒】原文在此断言 `nones.length >= 1`（「真仓此刻应有零消费面」）——\n"
    "     *   那是**拿别人的提交进度当前提**：R4-X6（v4.27.0）把 causalChain 接进登记行后\n"
    "     *   台账归零，断言当场塌。与 v3.20.5 在 v3204 A4 上治掉的是同一形态\n"
    "     *   （判据守的不再是纪律，而是「本仓的跨仓消费进度停在某一版」）。\n"
    "     *   台账的实质是两件事：① 剩的每条理由必须非空、可追责；\n"
    "     *   ② 已接进登记行的面不许还留着（见下方那条）。而「零消费面这一情形\n"
    "     *   真的被处理」由 B1/B2/B3 的 ghostFace 夹具证明 —— 那条路与上游提不提交无关。\n"
    "     *   （`cache` 仍要读：台账与冻读取是**两份**来源，台账条目不必是\n"
    "     *    cache 里 none@0 的子集，这一点必须在这里点明。） */\n"
    "    assert.ok(Object.prototype.hasOwnProperty.call(cache, 'faces'),\n"
    "        '冻读取必须真在场（否则「台账与冻读取是两份来源」无从谈起）');\n"
    "    for (const face of entries) {\n"
    "        assert.ok(String(t[face]).trim().length > 0,\n"
    "            '★ 台账里 `' + face + '` 的理由为空（沉默不许存在）');\n"
    "    }\n"
)

SEGS = [(OLD_B4, NEW_B4), (OLD_D2, NEW_D2)]


def main():
    s = io.open(F, encoding='utf-8').read()
    if 'faceN' in s and 'nones' not in s:
        print('· 两条已修，跳过')
        return 0
    bad = 0
    for i, (a, b) in enumerate(SEGS):
        n = s.count(a)
        print('  段 ' + str(i + 1) + ' 锚点命中 ' + str(n) + ' 次')
        if n != 1:
            bad += 1
    if bad:
        print('!! ' + str(bad) + ' 段锚点失配，abort（文件未改）')
        return 1
    for a, b in SEGS:
        s = s.replace(a, b, 1)
    if not WRITE:
        print('--- DRY RUN（补 --write 才落盘） ---')
        return 0
    io.open(F, 'w', encoding='utf-8').write(s)
    print('--- WRITTEN L（v4060 两条陈旧断言） ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())