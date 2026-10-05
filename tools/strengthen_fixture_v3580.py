#!/usr/bin/env python3
"""strengthen_fixture_v3580.py — [v3.58.0 · 计划 O5] 把内存夹具拉到**与真契约等价**。

【为什么必须动夹具】计划 O5 治的是「写回执与真实落盘一致」，于是各件的 `_writeJSON` 开始
**真的去看返回值**（唯一实现 config/write-receipt.js）。而 v3.34~v3.48 这十五个套件的内存夹具是：

    set: (k, v) => { box.set(k, v); },      ← 写进去了，但**不返回 true**

真 `PhoneStorage.set` 返回 Promise（成功侧等价于真），`writeReceipt` 判它成功；
夹具返回 `undefined` 则被判 `set_false`。于是夹具**比被测契约更弱**，
判据在真环境对、在夹具里红 —— 与本版治的「夹具比契约更强 ⇒ 假绿」是同一面镜子的两半，
本仓纪律只有一条：**夹具必须与契约等价**。

【改法】`set` 补 `return true`。写失败的那一面由各套件自己的 `readOnlyStorage`（set 抛错）
守，不靠夹具的返回值 —— 故加强不会削弱任何失败面判据。
注意：文件内字符串带裸引号，故一律用字面量比对，不写正则。

【用法】
    python3 tools/strengthen_fixture_v3580.py            # dry-run
    python3 tools/strengthen_fixture_v3580.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [
    'tests/system-v3340.test.mjs', 'tests/system-v3350.test.mjs', 'tests/system-v3360.test.mjs',
    'tests/system-v3370.test.mjs', 'tests/system-v3380.test.mjs', 'tests/system-v3390.test.mjs',
    'tests/system-v3400.test.mjs', 'tests/system-v3410.test.mjs', 'tests/system-v3420.test.mjs',
    'tests/system-v3430.test.mjs', 'tests/system-v3440.test.mjs', 'tests/system-v3450.test.mjs',
    'tests/system-v3460.test.mjs', 'tests/system-v3470.test.mjs', 'tests/system-v3480.test.mjs',
]
OLD = "set: (k, v) => { box.set(k, v); },"
NEW = "set: (k, v) => { box.set(k, v); return true; },"


def main():
    write = '--write' in sys.argv
    ok = 0
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        n = src.count(OLD)
        if n != 1:
            print('SKIP  %-32s 锚点命中 %d 次（应 1）' % (rel, n))
            continue
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(src.replace(OLD, NEW, 1))
            print('WRITE %-32s' % rel)
        else:
            print('DRY   %-32s' % rel)
        ok += 1
    print('--- %s：%d/%d 件%s' % ('已落盘' if write else '可落盘', ok, len(FILES),
                                  '' if write else '（未写入，加 --write 落盘）'))


if __name__ == '__main__':
    main()