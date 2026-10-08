#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o9_cn.py — 修判据侧的错：CONTEXT 转写判据的中文数字表容量不足。

**这不是产品缺陷，是判据自己的输入面假设过窄。**
`tests/system-v3190.test.mjs` 的 C4 拿一张写死到「十一」的表去转中文数字：

    const CN = ['零','一',...,'十','十一'];
    assert.equal(cnt[1], CN[real.length], ...)

门数本轮从 11 涨到 13 ⇒ `CN[13] === undefined` ⇒ 报 `actual '十三' expected undefined`。
**断言方向是对的（真源 13 道、文档写十三道），错的是那张表。**

修法不是退回 11 道门，而是：
  ① 表换成**生成式**（支持 0..99），容量不再是隐含假设；
  ② 加一条**容量自证**：门数超出可表示范围时必须给出可读原因，
     而不是把 `undefined` 当期望值拿去比（那是「判据把自身的表达力不足
     伪装成被测对象不一致」——本仓假绿的同族形态）。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv
REL = 'tests/system-v3190.test.mjs'

OLD = "    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一'];"
NEW = """    /* ★ [本轮修正] 中文数字表改**生成式**（支持 0..99）。
     *   原表写死到「十一」；门数本轮从 11 涨到 13 后，`CN[13]` 是 undefined，
     *   判据报 `actual '十三' expected undefined` —— 断言方向是对的（真源 13 道），
     *   错的是**表容量这个隐含假设**。这类「判据自身表达力不足伪装成被测对象不一致」
     *   正是本仓登记过的形态，故不只补格：换成生成式 + 加容量自证。 */
    const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const cnNum = (n) => {
        if (n < 10) return CN_DIGIT[n];
        if (n < 20) return '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
        if (n < 100) return CN_DIGIT[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
        return null; // 超出可表示范围：如实返回 null，由下方容量自证报出来
    };"""


def main():
    p = os.path.join(ROOT, REL)
    src = io.open(p, encoding='utf-8').read()
    assert src.count(OLD) == 1, '锚点命中数 != 1（实际 %d）' % src.count(OLD)
    out = src.replace(OLD, NEW, 1)

    # 断言处：把 CN[real.length] 换成 cnNum(real.length) + 容量自证
    old_assert = "    assert.equal(cnt[1], CN[real.length],\n        '★ 数量词与真源不一致：文档写「' + cnt[1] + '道」，真源是 ' + real.length + ' 道');"
    new_assert = """    const expectCn = cnNum(real.length);
    assert.ok(expectCn,
        '★ 判据自身容量不足：真源门数 ' + real.length + ' 超出中文数字可表示范围 ——'
        + ' 这是判据的输入面问题，不是被测对象不一致（不得拿 undefined 当期望值去比）');
    assert.equal(cnt[1], expectCn,
        '★ 数量词与真源不一致：文档写「' + cnt[1] + '道」，真源是 ' + real.length + ' 道');"""
    assert out.count(old_assert) == 1, '断言锚点命中数 != 1（实际 %d）' % out.count(old_assert)
    out = out.replace(old_assert, new_assert, 1)

    if WRITE:
        io.open(p, 'w', encoding='utf-8').write(out)
        print('[write] %s 已修正（生成式中文数字 + 容量自证）' % REL)
    else:
        print('[dry] would patch', REL)
        print(new_assert[:200])

    # 自证：新写法能表示 13 且不产生 undefined
    t = io.open(p, encoding='utf-8').read()
    assert 'cnNum(real.length)' in t, '替换未生效'
    assert 'CN[real.length]' not in t, '★ 旧写法仍在（未替换干净）'
    print('[self-check] 旧写法残留 0 处 ✓')


if __name__ == '__main__':
    main()